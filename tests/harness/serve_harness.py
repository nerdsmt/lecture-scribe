"""Browser test harness (developer tool, not needed by students).

Serves extension/ over http://localhost:8798 with a stubbed `chrome` API injected into every page, and runs the real
Lecture Scribe server on http://localhost:8799 in a temporary folder seeded with two fake lectures (no real speech).
Open http://localhost:8798/library.html or /popup.html or /options.html in a browser.

    local-server/.venv/bin/python tests/harness/serve_harness.py            (Windows: ...\\Scripts\\python)
"""
import json, math, struct, sys, tempfile, threading, wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-server"))
import server  # noqa: E402

tmp = tempfile.mkdtemp(prefix="lecture-scribe-harness-")
server.configure(tmp)
TOKEN = server.ensure_token()
server.CFG["port"] = 8799


def tone(path, secs):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 330 * i / 16000))) for i in range(int(16000 * secs))))


def seed(sid, title, course, started, lines):
    d = server.sdir(sid)
    (d / "meta.json").write_text(json.dumps({"id": sid, "title": title, "course": course, "startedAt": started}))
    for i, t in enumerate(lines):
        (d / "text" / f"{i:05d}.json").write_text(json.dumps({"n": i, "offset": i * 30.0, "text": t}))
        tone(d / "audio" / f"{i:05d}.wav", 2)


seed("lecture0001", "Week 3: Cell division", "Cell Biology 101", 1_760_000_000_000,
     ["Today we will look at mitosis and how cells divide.", "Prophase is the first stage, chromosomes condense.", "Then metaphase, where chromosomes line up in the middle."])
seed("lecture0002", "Week 1: Introduction", "Cell Biology 101", 1_759_000_000_000,
     ["Welcome to the course. The exam is worth sixty percent.", "Please read chapter one before next week."])
server._write_json(server.COURSES, {"Cell Biology": "mitosis, meiosis, prophase, metaphase"})

STUB = """
(() => {
  const params = new URLSearchParams(location.search);
  const store = JSON.parse(sessionStorage.getItem('stub') || 'null') || {
    workerUrl: 'http://localhost:8799', token: '%s', language: 'auto',
    field: params.get('field') ?? '', country: params.get('country') ?? '', accent: params.get('accent') || '#2563eb',
    consentAck: params.get('consent') === '1',
  };
  if (params.get('notoken')) store.token = '';
  const persist = () => sessionStorage.setItem('stub', JSON.stringify(store));
  persist();
  window.__sent = [];
  window.chrome = {
    storage: { local: {
      get: async (keys) => { if (keys == null) return {...store}; const out = {}; [].concat(typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)).forEach(k => { if (k in store) out[k] = store[k]; }); return out; },
      set: async (o) => { Object.assign(store, o); persist(); }, remove: async (k) => { delete store[k]; persist(); } } },
    runtime: { sendMessage: async (m) => { window.__sent.push(m); return { ok: true, sessionId: 'x' }; }, getURL: (p) => p,
      openOptionsPage: () => { window.__optionsOpened = true; }, onMessage: { addListener() {} } },
    tabs: { create: (o) => { window.__tabs = (window.__tabs || []).concat(o); } },
    permissions: { request: async () => true },
    action: {}, power: {},
  };
})();
""" % TOKEN


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT / "extension"), **k)
    def log_message(self, *a): pass
    def do_GET(self):
        path = self.translate_path(self.path.split("?")[0])
        if path.endswith(".html") and Path(path).exists():
            html = Path(path).read_text(encoding="utf-8")
            html = f"<script>{STUB}</script>" + html
            body = html.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            super().do_GET()


if __name__ == "__main__":
    threading.Thread(target=server.make_server().serve_forever, daemon=True).start()
    print(f"API  http://localhost:8799  (temp data in {tmp})\nPages http://localhost:8798/library.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8798), Handler).serve_forever()
