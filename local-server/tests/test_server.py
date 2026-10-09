"""Server tests. Run from local-server/:   .venv/bin/python -m unittest discover -s tests -v   (Windows: .venv\\Scripts\\python)

Transcription is replaced by a fake so the tests are fast and need no model download. Set
LECTURE_SCRIBE_TEST_WHISPER=1 to also run one test with the real Whisper model (downloads it if missing).
"""
import json
import math
import os
import struct
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


def make_wav(path, seconds=2.0, freq=440, rate=16000):
    """A short generated sine tone (no recordings are ever needed for tests)."""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(int(seconds * rate))))
    return Path(path).read_bytes()


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for k in ("LECTURE_TOKEN", "EXPORT_DIR", "WHISPER_MODEL", "PORT"):
            os.environ.pop(k, None)
        server.configure(self.tmp.name)
        self.token = server.ensure_token()
        server.CFG["port"] = 0
        self.fake_text = "hello from the lecture"
        self._orig = server.transcribe
        server.transcribe = lambda path, lang, prompt: (self.calls.append((Path(path).name, lang, prompt)), self.fake_text)[1]
        self.calls = []
        self.addCleanup(lambda: setattr(server, "transcribe", self._orig))
        self.srv = server.make_server()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    def call(self, method, path, body=None, token="default", raw=False):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        t = self.token if token == "default" else token
        if t is not None: req.add_header("Authorization", f"Bearer {t}")
        try:
            with urllib.request.urlopen(req) as r:
                payload = r.read()
                return r.status, (payload if raw else json.loads(payload or b"null"))
        except urllib.error.HTTPError as e:
            payload = e.read()
            try: return e.code, json.loads(payload)
            except ValueError: return e.code, payload


class TestConfigAndAuth(ServerCase):
    def test_token_is_random_and_persisted(self):
        self.assertGreaterEqual(len(self.token), 24)
        self.assertNotEqual(self.token, "local")
        saved = json.loads((Path(self.tmp.name) / "config.json").read_text())
        self.assertEqual(saved["token"], self.token)
        server.configure(self.tmp.name)
        self.assertEqual(server.ensure_token(), self.token)               # stable across restarts
        with tempfile.TemporaryDirectory() as other:
            server.configure(other)
            self.assertNotEqual(server.ensure_token(), self.token)         # different install, different token

    def test_whisper_model_by_ram(self):
        self.assertEqual(server.pick_whisper_model(4), "base")
        self.assertEqual(server.pick_whisper_model(8), "small")
        self.assertEqual(server.pick_whisper_model(16), "medium")
        self.assertEqual(server.pick_whisper_model(None), "small")

    def test_auth(self):
        self.assertEqual(self.call("GET", "/health", token=None)[0], 200)
        self.assertEqual(self.call("GET", "/sessions", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/sessions", token="wrong")[0], 401)
        self.assertEqual(self.call("GET", "/sessions")[0], 200)

    def test_export_folder_config(self):
        code, cfg = self.call("GET", "/config")
        self.assertEqual(code, 200); self.assertEqual(cfg["exportDir"], "")
        folder = str(Path(self.tmp.name) / "exports")
        self.assertEqual(self.call("PUT", "/config", {"exportDir": folder})[0], 200)
        self.assertEqual(self.call("GET", "/config")[1]["exportDir"], folder)
        self.assertEqual(self.call("PUT", "/config", {"exportDir": "relative/path"})[0], 400)


class TestSessionsApi(ServerCase):
    SID = "abc123def456"

    def make_session(self, **meta):
        m = {"title": "Week 1", "course": "Biology", "terms": "mitosis", "startedAt": 1_700_000_000_000, **meta}
        self.assertEqual(self.call("PUT", f"/sessions/{self.SID}", m)[0], 200)

    def upload(self, n, offset, secs=1.0):
        wav = Path(self.tmp.name) / f"t{n}.wav"; audio = make_wav(wav, secs)
        return self.call("POST", f"/sessions/{self.SID}/chunks/{n}?offset={offset}&lang=en&ext=wav", audio)

    def test_create_chunk_transcript_roundtrip(self):
        self.make_session()
        code, res = self.upload(0, 0)
        self.assertEqual((code, res["text"]), (200, self.fake_text))
        self.assertEqual(self.upload(1, 30.0)[0], 200)
        code, s = self.call("GET", f"/sessions/{self.SID}")
        self.assertEqual(code, 200)
        self.assertEqual([c["n"] for c in s["chunks"]], [0, 1])
        self.assertIn("[00:30] hello from the lecture", s["text"])
        self.assertEqual(s["meta"]["course"], "Biology")
        self.assertEqual(self.call("GET", "/sessions")[1][0]["id"], self.SID)
        # the Whisper prompt carries the course and its terms; the language is passed through
        name, lang, prompt = self.calls[0]
        self.assertEqual(lang, "en"); self.assertIn("Biology", prompt); self.assertIn("mitosis", prompt)

    def test_rejects_bad_input(self):
        self.assertEqual(self.call("GET", "/sessions/x")[0], 400)           # id too short
        self.make_session()
        self.assertEqual(self.call("POST", f"/sessions/{self.SID}/chunks/0", b"")[0], 400)

    def test_audio_download_blocks_path_tricks(self):
        self.make_session(); self.upload(0, 0)
        code, files = self.call("GET", f"/sessions/{self.SID}/audio")
        self.assertEqual(code, 200); self.assertEqual(files[0]["key"], "00000.wav")
        self.assertEqual(self.call("GET", f"/sessions/{self.SID}/audio/00000.wav", raw=True)[0], 200)
        self.assertEqual(self.call("GET", f"/sessions/{self.SID}/audio/..")[0], 400)
        self.assertEqual(self.call("GET", f"/sessions/{self.SID}/audio/..%2Fmeta.json")[0], 400)

    def test_joined_audio_endpoint(self):
        self.make_session(); self.upload(0, 0, 1.0); self.upload(1, 30, 1.0)
        code, blob = self.call("GET", f"/sessions/{self.SID}/audio.m4a", raw=True)
        self.assertEqual(code, 200); self.assertGreater(len(blob), 1000)
        self.assertIn(b"ftyp", blob[:16])        # MP4/M4A container

    def test_rename_and_delete_with_export(self):
        folder = Path(self.tmp.name) / "exp"
        self.call("PUT", "/config", {"exportDir": str(folder)})
        self.make_session(); self.upload(0, 0)
        md = list(folder.rglob("*.md")); self.assertEqual(len(md), 1)
        self.assertIn("hello from the lecture", md[0].read_text(encoding="utf-8"))
        self.assertEqual(md[0].parent.name, "Biology")
        self.call("PUT", f"/sessions/{self.SID}", {"title": "Renamed", "course": "Zoology"})
        md = list(folder.rglob("*.md")); self.assertEqual(len(md), 1)
        self.assertEqual((md[0].parent.name, "Renamed" in md[0].name), ("Zoology", True))
        self.assertEqual(self.call("DELETE", f"/sessions/{self.SID}")[0], 200)
        self.assertEqual(list(folder.rglob("*.md")), [])
        self.assertEqual(self.call("GET", "/sessions")[1], [])

    def test_no_export_means_no_files_outside_data(self):
        self.make_session(); self.upload(0, 0)
        self.assertEqual(self.call("POST", f"/sessions/{self.SID}/audio/export")[0], 400)

    def test_courses_api(self):
        self.assertEqual(self.call("PUT", "/courses/Anatomy", {"terms": "femur, tibia"})[0], 200)
        self.assertEqual(self.call("GET", "/courses")[1], {"Anatomy": "femur, tibia"})
        self.assertEqual(self.call("DELETE", "/courses/Anatomy")[0], 200)
        self.assertEqual(self.call("GET", "/courses")[1], {})


class TestCourseTerms(ServerCase):
    def setUp(self):
        super().setUp()
        server._write_json(server.COURSES, {"Financial Accounting": "accruals, IAS 16", "Law": "tort, statute", "Accounting": "ledger, accruals"})

    def test_exact_match_wins(self):
        self.assertEqual(server.terms_for("financial accounting"), "accruals, IAS 16")

    def test_loose_match_in_longer_course_title(self):
        t = server.terms_for("ACC1000 Financial Accounting and Control")
        self.assertEqual(t, "accruals, IAS 16, ledger")               # both saved names match; duplicates are merged

    def test_no_match_and_short_names(self):
        self.assertEqual(server.terms_for("Chemistry"), "")
        self.assertEqual(server.terms_for(""), "")
        self.assertEqual(server.terms_for("a"), "")                      # one letter must not match everything
        self.assertEqual(server.terms_for(None), "")

    def test_whisper_prompt_merges_session_and_saved_terms(self):
        p = server.whisper_prompt({"course": "Law", "terms": "mens rea, tort"})
        self.assertEqual(p, "Lecture: Law. Terms: mens rea, tort, statute")


class TestAudioJoin(ServerCase):
    def test_join_concatenates_parts_and_caches(self):
        import av
        sid = "joinjoin01"
        d = server.sdir(sid)
        for i in range(3): make_wav(d / "audio" / f"{i:05d}.wav", 1.0)
        out = server.join_audio(sid)
        self.assertTrue(out.exists())
        with av.open(str(out)) as c:
            seconds = float(c.duration) / av.time_base
        self.assertAlmostEqual(seconds, 3.0, delta=0.3)
        first = out.stat().st_mtime_ns
        self.assertEqual(server.join_audio(sid).stat().st_mtime_ns, first)   # cached: not rebuilt
        self.assertIsNone(server.join_audio(server.sdir("emptyempty") and "emptyempty"))


@unittest.skipUnless(os.environ.get("LECTURE_SCRIBE_TEST_WHISPER"), "set LECTURE_SCRIBE_TEST_WHISPER=1 to run with the real model")
class TestRealWhisper(ServerCase):
    def test_pipeline_runs_with_real_model(self):
        server.transcribe = self._orig
        server.CFG["whisper_model"] = "tiny"
        wav = Path(self.tmp.name) / "tone.wav"; make_wav(wav, 3)
        self.assertIsInstance(server.transcribe(wav, "en", "Lecture: test."), str)   # a pure tone: empty text is fine, it must not crash


if __name__ == "__main__":
    unittest.main()
