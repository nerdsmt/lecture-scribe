// Records in CHUNK_SEC slices. Each slice is a standalone, decodable WebM file so
// the Worker can transcribe it independently; a crash loses at most one slice.
const CHUNK_SEC = 30;
let ctx, dest, streams = [], recorder, timer, state = null;

async function getStreams(mode, streamId) {
  const out = [];
  if (mode !== "mic") {
    out.push(await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    }));
  }
  if (mode !== "tab") {
    out.push(await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }));
  }
  return out;
}

function startSlice() {
  const chunks = [];
  const n = state.n++;
  const offset = (Date.now() - state.t0 - state.pausedTotal) / 1000; // audio time, pauses excluded
  const gen = state.gen;
  recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 48000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    state.pending.push(upload(n, offset, blob));
    if (state.running && gen === state.gen) startSlice();
  };
  recorder.start();
  timer = setTimeout(() => recorder.state === "recording" && recorder.stop(), CHUNK_SEC * 1000);
}

async function upload(n, offset, blob, attempt = 0) {
  const { workerUrl, token, language } = state.cfg;
  const url = `${workerUrl.replace(/\/$/, "")}/sessions/${state.id}/chunks/${n}?offset=${offset.toFixed(1)}&lang=${language || "auto"}`;
  try {
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: blob });
    if (!r.ok) throw new Error(r.status);
  } catch (e) {
    if (attempt < 5) {
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
      return upload(n, offset, blob, attempt + 1);
    }
    console.error("chunk", n, "failed permanently", e);
  }
}

async function start(m) {
  ctx = new AudioContext();
  dest = ctx.createMediaStreamDestination();
  streams = await getStreams(m.mode, m.streamId);
  streams.forEach((s) => ctx.createMediaStreamSource(s).connect(dest));
  // Tab capture silences the tab locally; route it back so the student still hears it.
  if (m.mode !== "mic") ctx.createMediaStreamSource(streams[0]).connect(ctx.destination);
  state = { id: m.sessionId, cfg: m.cfg, t0: Date.now(), n: 0, pending: [], running: true, pausedTotal: 0, pausedAt: 0, gen: 0 };
  await fetch(`${m.cfg.workerUrl.replace(/\/$/, "")}/sessions/${m.sessionId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${m.cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(m.meta),
  });
  startSlice();
}

async function pause() {
  if (!state?.running) return;
  state.gen++;
  state.running = false; // onstop uploads the last slice but does not start another
  state.pausedAt = Date.now();
  clearTimeout(timer);
  if (recorder?.state === "recording") recorder.stop();
}

async function resume() {
  if (!state || state.running) return;
  state.pausedTotal += Date.now() - state.pausedAt;
  state.gen++;
  state.running = true;
  startSlice();
}

async function stop() {
  state.running = false;
  clearTimeout(timer);
  if (recorder?.state === "recording") recorder.stop();
  await new Promise((r) => setTimeout(r, 300));
  await Promise.all(state.pending);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await ctx.close();
  setTimeout(() => window.close(), 200); // reply to the background first, then close
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "offscreen") return;
  ({ start, pause, resume, stop }[msg.type](msg))
    .then(() => send({ ok: true }))
    .catch((e) => send({ ok: false, error: String(e.message || e) }));
  return true;
});
