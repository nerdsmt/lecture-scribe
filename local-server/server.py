"""Lecture Scribe - local server (free, runs entirely on your own computer).

Same HTTP API as the optional Cloudflare Worker, so the Chrome extension and the Mac app work with either.
Transcription: faster-whisper (local, CPU). Study notes (optional): Ollama (local). Storage: ./data

Runs on macOS, Windows and Linux. Settings live in config.json next to this file (see config.example.json);
environment variables such as LECTURE_TOKEN, WHISPER_MODEL, PORT, EXPORT_DIR override it.
Nothing is sent to the internet except (a) the one-time Whisper model download and (b) optional features
you switch on yourself (live Google Docs, an export folder that a cloud app such as Drive/OneDrive/Dropbox syncs).
"""
import datetime
import hmac
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from fractions import Fraction
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

AUDIO_EXTS = (".webm", ".m4a", ".wav", ".mp3")

DEFAULTS = {
    "host": "127.0.0.1",          # only this computer can connect. Do not change unless you know why.
    "port": 8787,
    "token": "",                   # generated on first run
    "whisper_model": "auto",       # auto = chosen from your RAM; or tiny / base / small / medium / large-v3-turbo
    "notes_model": "llama3.1:8b",  # optional local "Study notes" via Ollama
    "ollama_url": "http://localhost:11434",
    "export_dir": "",              # optional folder for Markdown transcripts (e.g. inside Drive/OneDrive/Dropbox). "" = off
    "data_dir": "",                # "" = ./data next to this file
    "keep_awake": True,            # stop the computer idle-sleeping while the server runs
}

# ---------------------------------------------------------------- configuration
HOME = Path(__file__).resolve().parent
CFG = dict(DEFAULTS)
DATA = HOME / "data"
COURSES = HOME / "courses.json"   # {"Course name": "term, term, ..."}


def _read_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except ValueError:
        return default


def _write_json(p, obj):
    Path(p).write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")


def configure(home=None):
    """(Re)load settings. `home` (or env LECTURE_SCRIBE_HOME) is the folder holding config.json, courses.json, data/."""
    global HOME, CFG, DATA, COURSES
    HOME = Path(home or os.environ.get("LECTURE_SCRIBE_HOME") or Path(__file__).resolve().parent)
    CFG = {**DEFAULTS, **(_read_json(HOME / "config.json", {}) or {})}
    env = {"LECTURE_TOKEN": "token", "WHISPER_MODEL": "whisper_model", "NOTES_MODEL": "notes_model",
           "OLLAMA_URL": "ollama_url", "EXPORT_DIR": "export_dir", "PORT": "port"}
    for e, k in env.items():
        if os.environ.get(e):
            CFG[k] = int(os.environ[e]) if k == "port" else os.environ[e]
    DATA = Path(CFG["data_dir"]).expanduser() if CFG["data_dir"] else HOME / "data"
    DATA.mkdir(parents=True, exist_ok=True)
    COURSES = HOME / "courses.json"
    return CFG


def ensure_token():
    """Create config.json with a random token on first run (never the same on two computers)."""
    path = HOME / "config.json"
    saved = _read_json(path, {}) or {}
    if not saved.get("token"):
        saved["token"] = secrets.token_urlsafe(24)
        for k in ("port", "whisper_model", "export_dir"):
            saved.setdefault(k, DEFAULTS[k])
        _write_json(path, saved)
        try:
            os.chmod(path, 0o600)       # no effect on Windows; harmless
        except OSError:
            pass
    if not os.environ.get("LECTURE_TOKEN"):
        CFG["token"] = saved["token"]
    return CFG["token"]


def save_config_key(key, value):
    path = HOME / "config.json"
    saved = _read_json(path, {}) or {}
    saved[key] = value
    _write_json(path, saved)
    CFG[key] = value


# ---------------------------------------------------------------- machine helpers
def total_ram_gb():
    """Installed RAM in GB, or None if it cannot be read. No third-party packages needed."""
    try:
        if sys.platform == "darwin":
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()) / 2**30
        if sys.platform.startswith("linux"):
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / 2**20
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("m", ctypes.c_ulong), ("tp", ctypes.c_ulonglong),
                            ("ap", ctypes.c_ulonglong), ("tf", ctypes.c_ulonglong), ("af", ctypes.c_ulonglong),
                            ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ae", ctypes.c_ulonglong)]
            s = MS(); s.l = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
            return s.tp / 2**30
    except Exception:
        pass
    return None


def pick_whisper_model(ram_gb):
    """Bigger models are more accurate (names, jargon, accents) but slower and need more memory.
    These are conservative rules of thumb, not benchmarks: change whisper_model in config.json if you disagree."""
    if ram_gb is None: return "small"
    if ram_gb < 6: return "base"
    if ram_gb < 16: return "small"
    return "medium"


def whisper_model_name():
    m = (CFG.get("whisper_model") or "auto").strip()
    return pick_whisper_model(total_ram_gb()) if m == "auto" else m


def detect_export_folders():
    """Best-effort search for synced cloud folders, so transcripts can optionally be saved where Drive / OneDrive /
    Dropbox will sync them. Nothing is created or written here. Paths differ between versions; any folder can be
    chosen by hand instead."""
    home, found = Path.home(), []

    def add(label, base):
        try:
            if (base / "My Drive").is_dir(): base = base / "My Drive"      # Google Drive: files belong in "My Drive"
            if base.is_dir():
                found.append({"label": label, "path": str(base / "Lecture Scribe"), "real": str(base.resolve())})
        except OSError:
            pass
    cs = home / "Library" / "CloudStorage"                     # macOS
    if cs.is_dir():
        for p in sorted(cs.glob("GoogleDrive-*")): add("Google Drive", p / "My Drive")
        for p in sorted(cs.glob("OneDrive*")): add("OneDrive", p)
        for p in sorted(cs.glob("Dropbox*")): add("Dropbox", p)
    if os.name == "nt":                                         # Google Drive for desktop usually mounts as a drive letter
        for letter in "GHIJKLMNOPQRSTUVWXYZDEF":
            add("Google Drive", Path(f"{letter}:/My Drive"))
        for env in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
            if os.environ.get(env): add("OneDrive", Path(os.environ[env]))
    for name, label in (("OneDrive", "OneDrive"), ("Dropbox", "Dropbox"), ("Google Drive", "Google Drive"),
                        ("GoogleDrive", "Google Drive"), ("iCloud Drive", "iCloud Drive")):
        add(label, home / name)
    add("iCloud Drive", home / "Library" / "Mobile Documents" / "com~apple~CloudDocs")
    seen, out = set(), []
    for f in found:                          # the same folder can be reachable through several shortcuts
        real = f.pop("real")
        if real not in seen:
            seen.add(real); out.append(f)
    return out


_awake_proc = None


def keep_awake():
    """Ask the OS not to idle-sleep while the server runs (2-hour lectures). Best effort; silently skipped if unavailable."""
    global _awake_proc
    if not CFG.get("keep_awake"): return
    try:
        if sys.platform == "darwin" and shutil.which("caffeinate"):
            _awake_proc = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
        elif os.name == "nt":
            import ctypes
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        elif shutil.which("systemd-inhibit"):
            _awake_proc = subprocess.Popen(["systemd-inhibit", "--what=idle", "--why=Lecture Scribe is running",
                                            "sleep", "infinity"])
    except Exception:
        pass


# ---------------------------------------------------------------- transcription
_model, _lock = None, threading.Lock()


def model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(whisper_model_name(), device="cpu", compute_type="int8")
    return _model


def prep_audio(path):
    """Decode to 16 kHz mono and raise the level of quiet speech (quiet laptop mics, distant lecturers).
    Only boosts when there is clear speech above the noise floor, so silence is not amplified into hallucinations.
    The saved audio file is never changed."""
    try:
        import av, numpy as np
        c = av.open(str(path)); rs = av.AudioResampler(format="flt", layout="mono", rate=16000)
        x = np.concatenate([r.to_ndarray().ravel() for fr in c.decode(audio=0) for r in rs.resample(fr)]).astype("float32")
        peak = float(abs(x).max())
        if peak < 1e-4: return x
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        probe = np.clip(x * min(20.0, 0.7 / peak), -1.0, 1.0)   # let the voice detector hear a level-normalised copy
        segs = get_speech_timestamps(probe, VadOptions())
        if segs:                                                # boost only if real speech was found; noise-only parts stay untouched
            voiced = np.concatenate([x[sg["start"]:sg["end"]] for sg in segs])
            lvl = float(np.sqrt((voiced ** 2).mean()))
            if 0.0002 <= lvl < 0.08:
                x = np.clip(x * min(12.0, 0.1 / lvl), -1.0, 1.0)
        return x
    except Exception:
        return str(path)


def transcribe(path, lang, prompt):
    with _lock:  # one transcription at a time
        audio = prep_audio(path)
        language = None if lang in (None, "", "auto") else lang
        try:
            segs, _ = model().transcribe(audio, language=language, initial_prompt=prompt or None,
                                         vad_filter=True, condition_on_previous_text=False)
        except ValueError:          # unknown language code -> let Whisper detect it
            segs, _ = model().transcribe(audio, language=None, initial_prompt=prompt or None,
                                         vad_filter=True, condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segs).strip()


def ts(sec):
    s = int(sec); h, m, r = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{r:02d}" if h else f"{m:02d}:{r:02d}"


# ---------------------------------------------------------------- storage
def sdir(sid):
    d = DATA / sid
    (d / "audio").mkdir(parents=True, exist_ok=True)
    (d / "text").mkdir(exist_ok=True)
    return d


def chunks_of(sid):
    return sorted((json.loads(p.read_text(encoding="utf-8")) for p in (sdir(sid) / "text").glob("*.json")), key=lambda c: c["n"])


def export_dir():
    return Path(CFG["export_dir"]).expanduser() if CFG.get("export_dir") else None


def export_path(sid):
    m = _read_json(sdir(sid) / "meta.json", {})
    safe = lambda x: re.sub(r'[\\/:*?"<>|]+', "-", x or "").strip()[:80]
    when = datetime.datetime.fromtimestamp(m.get("startedAt", 0) / 1000).strftime("%Y-%m-%d")
    folder = export_dir() / (safe(m.get("course")) or "Lectures")
    return folder / f"{when} {safe(m.get('title')) or sid}.md", m, when


def export(sid):
    """Write the running transcript as Markdown into export_dir/<course>/<date> <title>.md (if an export folder is set)."""
    if not export_dir(): return
    path, m, when = export_path(sid)
    path.parent.mkdir(parents=True, exist_ok=True)
    head = f"# {m.get('title') or sid}\n\nCourse: {m.get('course') or '-'}  \nDate: {when}\n\n## Transcript\n\n"
    body = "\n\n".join(f"[{ts(c['offset'])}] {c['text']}" for c in chunks_of(sid) if c["text"])
    path.write_text(head + body + "\n", encoding="utf-8")


def unexport(sid):
    """Remove the exported Markdown (and its course folder if now empty)."""
    if not export_dir(): return
    path, _, _ = export_path(sid)
    path.unlink(missing_ok=True); path.with_suffix(".m4a").unlink(missing_ok=True)
    try: path.parent.rmdir()
    except OSError: pass


def load_courses():
    return _read_json(COURSES, {}) or {}


def terms_for(course):
    """Saved term list for a course. Exact name wins; otherwise a saved name contained in the course text (or vice versa),
    so 'ACC1000 Financial Accounting and Control' finds 'Financial Accounting'. Names under 3 characters only match exactly."""
    if not course: return ""
    c, saved = course.strip().lower(), load_courses()
    for k, v in saved.items():
        if k.lower() == c: return v
    if len(c) < 3: return ""
    hits = [v for k, v in saved.items() if len(k) >= 3 and (k.lower() in c or c in k.lower())]
    return ", ".join(dict.fromkeys(t.strip() for h in hits for t in h.split(",") if t.strip()))


def whisper_prompt(m):
    """Course name + glossary nudge Whisper towards the right spelling of names and jargon."""
    terms = ", ".join(dict.fromkeys(t.strip() for t in ((m.get("terms") or "") + "," + terms_for(m.get("course"))).split(",") if t.strip()))
    return " ".join(x for x in [m.get("course") and f"Lecture: {m['course']}.", terms and f"Terms: {terms}"] if x)


# ---------------------------------------------------------------- optional: live Google Doc
def live_accounts(m):
    """Web apps to try, in order. live.json: {"accounts":[{"name","url","key"},...]} or {"url","key"}."""
    c = _read_json(HOME / "live.json", {}) or {}
    accs = c.get("accounts") or ([{"name": "default", "url": c["url"], "key": c.get("key")}] if c.get("url") else [])
    if not accs and m.get("liveUrl"): accs = [{"name": "extension", "url": m["liveUrl"], "key": m.get("liveKey")}]
    return accs


_doc_account = {}  # docId -> index of the account whose web app can edit that Doc
_MISMATCH = ("Document is missing", "permission", "access", "Action not allowed")  # this Google account cannot open the Doc


def live_push(m, n, offset, text):
    """OPTIONAL. Append this chunk to the student's own Google Doc via their own Apps Script web app (background thread).
    Only runs when a Doc link was given for this recording AND a web app URL is configured."""
    accs = live_accounts(m)
    if not (m.get("docId") and accs and text): return

    def run():
        payload_base = {"docId": m["docId"], "n": n, "text": text, "stamp": ts(offset), "title": m.get("title"),
                        "course": m.get("course"), "date": datetime.date.today().isoformat()}
        first = _doc_account.get(m["docId"], 0)
        order = [first] + [i for i in range(len(accs)) if i != first]
        last = None
        for i in order:
            a = accs[i]
            for attempt in range(3):
                try:
                    req = urllib.request.Request(a["url"], json.dumps({**payload_base, "key": a.get("key")}).encode(),
                                                 {"Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=60) as r: res = json.load(r)
                except Exception as e:
                    last = str(e); print("live doc push failed:", e, flush=True)
                    time.sleep(3 * (attempt + 1)); continue
                if res.get("ok"):
                    _doc_account[m["docId"]] = i
                    print(f"live doc: chunk {n} written via account '{a.get('name', i)}'", flush=True); return
                last = res.get("error", "")
                if any(k in last for k in _MISMATCH): break   # wrong Google account for this Doc: try the next one
                print("live doc error:", res, flush=True); time.sleep(3 * (attempt + 1))
        print(f"live doc: chunk {n} NOT written. Last error: {last}. "
              "Share the Doc with the Google account that owns the web app, or add that account to live.json.", flush=True)
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- audio join
def join_audio(sid):
    """Concatenate all 30 s parts (webm/m4a/wav/mp3) into one AAC .m4a, cached until a part changes."""
    import av
    d = sdir(sid); files = sorted(f for f in (d / "audio").iterdir() if f.suffix in AUDIO_EXTS)
    if not files: return None
    out = d / "lecture.m4a"
    if out.exists() and out.stat().st_mtime >= max(f.stat().st_mtime for f in files): return out
    tmp = d / "lecture.tmp.m4a"; RATE = 44100
    with av.open(str(tmp), "w", format="mp4") as oc:
        st = oc.add_stream("aac", rate=RATE); st.bit_rate = 64000; total = 0
        for f in files:
            try: ic = av.open(str(f))
            except Exception: continue
            with ic:
                rs = av.AudioResampler(format="fltp", layout="mono", rate=RATE)

                def feed(frames):
                    nonlocal total
                    for rf in frames:
                        rf.pts = total; rf.time_base = Fraction(1, RATE); total += rf.samples
                        for pkt in st.encode(rf): oc.mux(pkt)
                for frame in ic.decode(audio=0): feed(rs.resample(frame))
                feed(rs.resample(None))
        for pkt in st.encode(None): oc.mux(pkt)
    tmp.replace(out); return out


# ---------------------------------------------------------------- optional: local study notes (Ollama)
def chat(system, user):
    body = json.dumps({"model": CFG["notes_model"], "stream": False, "options": {"num_ctx": 8192},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    req = urllib.request.Request(CFG["ollama_url"] + "/api/chat", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)["message"]["content"].strip()


def study_notes(text, m):
    ctx = f"Course: {m.get('course') or 'unknown'}. Lecture: {m.get('title') or 'untitled'}. Glossary: {m.get('terms') or 'none'}."
    parts = [chat(f"You are a study assistant. {ctx} Clean up this raw lecture transcript segment "
                  "(remove fillers, fix obvious mis-hearings using the glossary) and condense it into accurate, "
                  "detailed bullet-point notes. Do not invent content that was not said.", text[i:i + 6000])
             for i in range(0, len(text), 6000)]
    merged = "\n".join(parts)[:20000]
    out = chat(f"You are a study assistant. {ctx} From the lecture notes below produce Markdown with exactly "
               "these sections:\n## Summary\n(5-8 sentences)\n## Key Concepts\n(bulleted, one-line definitions)\n"
               "## Detailed Notes\n(organised by topic)\n## Flashcards\n(8-15 lines formatted \"Q: ... | A: ...\")\n"
               "## Likely Exam Questions\n(5-8)\n## Action Items\n(readings/deadlines mentioned, or \"None\")\n"
               "Only use information present in the notes.", merged)
    return {"generatedAt": int(time.time() * 1000), "markdown": out}


# ---------------------------------------------------------------- HTTP API
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, data, status=200, ctype="application/json"):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        for k, v in {"Content-Type": ctype, "Access-Control-Allow-Origin": "*",
                     "Access-Control-Allow-Headers": "Authorization, Content-Type",
                     "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"}.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_OPTIONS(self): self.send(b"", 204)
    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PUT(self): self.route("PUT")
    def do_DELETE(self): self.route("DELETE")

    def route(self, method):
        try: self._route(method)
        except Exception as e: self.send({"error": str(e)}, 500)

    def authorised(self):
        sent = (self.headers.get("Authorization") or "").encode()
        return bool(CFG["token"]) and hmac.compare_digest(sent, f"Bearer {CFG['token']}".encode())

    def _route(self, method):
        u = urlparse(self.path); q = parse_qs(u.query)
        p = [x for x in u.path.split("/") if x]
        if p == ["health"] and method == "GET":          # no token needed: lets setup screens check the server is up
            return self.send({"ok": True, "app": "lecture-scribe"})
        if not self.authorised(): return self.send({"error": "unauthorized"}, 401)

        if p == ["config"]:
            if method == "GET":
                return self.send({"exportDir": CFG["export_dir"], "exportCandidates": detect_export_folders(),
                                  "whisperModel": whisper_model_name(), "ramGb": round(total_ram_gb() or 0, 1)})
            if method == "PUT":
                want = json.loads(self.body() or b"{}").get("exportDir", "")
                if want:
                    want = str(Path(want).expanduser())
                    if not Path(want).is_absolute(): return self.send({"error": "Use a full folder path."}, 400)
                    Path(want).mkdir(parents=True, exist_ok=True)
                save_config_key("export_dir", want)
                return self.send({"ok": True, "exportDir": want})

        if p and p[0] == "courses":
            saved = load_courses()
            if len(p) == 1 and method == "GET": return self.send(dict(sorted(saved.items(), key=lambda kv: kv[0].lower())))
            name = unquote(p[1]).strip() if len(p) == 2 else ""
            if not name: return self.send({"error": "bad course name"}, 400)
            if method == "PUT":
                terms = (json.loads(self.body() or b"{}").get("terms") or "").strip()
                if terms: saved[name] = terms
                else: saved.pop(name, None)
                _write_json(COURSES, saved); return self.send({"ok": True})
            if method == "DELETE":
                saved.pop(name, None); _write_json(COURSES, saved); return self.send({"ok": True})
            return self.send({"error": "not found"}, 404)
        if not p or p[0] != "sessions": return self.send({"error": "not found"}, 404)

        if len(p) == 1 and method == "GET":
            metas = [_read_json(d / "meta.json", {"id": d.name}) for d in DATA.iterdir() if d.is_dir()]
            return self.send(sorted(metas, key=lambda m: m.get("startedAt", 0), reverse=True))

        sid = p[1] if len(p) > 1 else ""
        if not re.fullmatch(r"[\w-]{6,64}", sid): return self.send({"error": "bad id"}, 400)
        d = sdir(sid); meta_p = d / "meta.json"

        if len(p) == 2 and method == "PUT":
            old = export_path(sid)[0] if export_dir() else None
            meta = {**(_read_json(meta_p, {})), **json.loads(self.body() or b"{}"), "id": sid}
            meta_p.write_text(json.dumps(meta), encoding="utf-8")
            if export_dir():  # a rename/course change moves the exported Markdown copy to its new name
                new = export_path(sid)[0]
                if old and old != new and old.exists():
                    new.parent.mkdir(parents=True, exist_ok=True); old.replace(new)
                    if old.with_suffix(".m4a").exists(): old.with_suffix(".m4a").replace(new.with_suffix(".m4a"))
                    try: old.parent.rmdir()
                    except OSError: pass
                    export(sid)  # refresh the title/course lines inside the file
            return self.send(meta)
        if len(p) == 2 and method == "GET":
            cs = chunks_of(sid)
            return self.send({"meta": _read_json(meta_p, {"id": sid}),
                              "text": "\n\n".join(f"[{ts(c['offset'])}] {c['text']}".strip() for c in cs),
                              "plain": " ".join(c["text"] for c in cs),
                              "chunks": [{"n": c["n"], "offset": c["offset"], "text": c["text"]} for c in cs]})
        if len(p) == 2 and method == "DELETE":
            unexport(sid); shutil.rmtree(d); return self.send({"ok": True})

        if len(p) == 4 and p[2] == "chunks" and method == "POST":
            n = int(p[3]); audio = self.body()
            if not audio: return self.send({"error": "empty"}, 400)
            pad = f"{n:05d}"; ext = re.sub(r"[^a-z0-9]", "", (q.get("ext") or ["webm"])[0].lower())[:4] or "webm"
            ap = d / "audio" / f"{pad}.{ext}"; ap.write_bytes(audio)
            m = _read_json(meta_p, {})
            offset = float((q.get("offset") or ["0"])[0])
            text = transcribe(ap, (q.get("lang") or [None])[0], whisper_prompt(m))
            (d / "text" / f"{pad}.json").write_text(json.dumps({"n": n, "offset": offset, "text": text}), encoding="utf-8")
            export(sid); live_push(m, n, offset, text)
            return self.send({"n": n, "text": text})

        if len(p) >= 3 and p[2] == "notes" and method == "POST":
            np_ = d / "notes.json"
            if np_.exists() and not q.get("refresh"): return self.send(_read_json(np_))
            full = " ".join(c["text"] for c in chunks_of(sid)).strip()
            if not full: return self.send({"error": "no transcript yet"}, 400)
            notes = study_notes(full, _read_json(meta_p, {})); _write_json(np_, notes); return self.send(notes)

        if len(p) == 3 and p[2] == "audio.m4a" and method == "GET":
            f = join_audio(sid)
            return self.send(f.read_bytes(), ctype="audio/mp4") if f else self.send({"error": "no audio"}, 404)
        if len(p) == 4 and p[2] == "audio" and p[3] == "export" and method == "POST":
            if not export_dir(): return self.send({"error": "No export folder is set. Choose one in the extension Options."}, 400)
            f = join_audio(sid)
            if not f: return self.send({"error": "no audio"}, 404)
            dest = export_path(sid)[0].with_suffix(".m4a"); dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, dest)
            return self.send({"ok": True, "path": str(dest), "mb": round(dest.stat().st_size / 1e6, 1)})
        if len(p) >= 3 and p[2] == "audio" and method == "GET":
            if len(p) == 3:
                return self.send([{"key": f.name, "size": f.stat().st_size} for f in sorted((d / "audio").iterdir())])
            if not re.fullmatch(r"[\w.-]{1,40}", p[3]) or ".." in p[3]: return self.send({"error": "bad name"}, 400)
            f = d / "audio" / p[3]
            return self.send(f.read_bytes(), ctype={"m4a": "audio/mp4", "webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg"}.get(f.suffix[1:], "application/octet-stream")) if f.is_file() else self.send({"error": "not found"}, 404)
        self.send({"error": "not found"}, 404)


def make_server():
    return ThreadingHTTPServer((CFG["host"], int(CFG["port"])), H)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")      # Windows consoles can choke on non-ASCII
    configure()
    args = sys.argv[1:]
    token = ensure_token()
    if "--show-token" in args:
        print(token); return
    if "--init" in args:
        print(f"Config: {HOME / 'config.json'}")
        print(f"Token:  {token}")
        ram = total_ram_gb()
        print(f"Whisper model: {whisper_model_name()} (this computer has {ram:.0f} GB RAM)" if ram else f"Whisper model: {whisper_model_name()}")
        for f in detect_export_folders():
            print(f"Optional export folder found: {f['label']} -> {f['path']}")
        return
    if "--download-model" in args:
        print(f"Downloading the '{whisper_model_name()}' speech model (one time)..."); model(); print("Done."); return
    print(f"Lecture Scribe local server on http://localhost:{CFG['port']}")
    print(f"  Token:         {token}   (paste it into the extension Options)")
    print(f"  Speech model:  {whisper_model_name()}")
    print(f"  Data folder:   {DATA}")
    print(f"  Export folder: {CFG['export_dir'] or '(off - transcripts stay in the data folder only)'}")
    if not CFG["export_dir"]:
        for f in detect_export_folders():
            print(f"    could export to {f['label']}: {f['path']}  (choose it in the extension Options)")
    keep_awake()
    print("Loading speech model (the first run downloads it)...", flush=True); model()
    print("Ready. Keep this window open while you record.", flush=True)
    make_server().serve_forever()


configure()

if __name__ == "__main__":
    main()
