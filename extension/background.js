importScripts("settings.js");

// Orchestrates recording. Audio capture itself lives in the offscreen document.
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record lecture audio from the tab and microphone",
  });
}

async function start({ mode, title, course, terms, docUrl }) {
  const cfg = await getSettings();
  const docId = (docUrl || "").match(/\/d\/([\w-]+)/)?.[1] || (/^[\w-]{20,}$/.test(docUrl || "") ? docUrl : "");
  if (docUrl && !docId) throw new Error("That does not look like a Google Docs link.");
  if (docId && !cfg.liveUrl) throw new Error("Add the Live Google Docs web app URL in Options first.");
  if (!cfg.workerUrl || !cfg.token) throw new Error("Open Settings (right-click the icon → Options) and paste the server token first.");
  const sessionId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  let streamId = null;
  if (mode !== "mic") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  }
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: "offscreen", type: "start", streamId, mode, sessionId,
    cfg, meta: { title: title || "Lecture " + new Date().toLocaleString(), course, terms, startedAt: Date.now(),
            ...(docId ? { docId, liveUrl: cfg.liveUrl, liveKey: cfg.liveKey } : {}) },
  });
  if (!res?.ok) throw new Error(res?.error || "Could not start recording");
  await chrome.storage.local.set({ rec: { sessionId, startedAt: Date.now(), mode, title } });
  chrome.power.requestKeepAwake("system"); // long lectures: keep the computer from idle-sleeping
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  return sessionId;
}

async function stop() {
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  } catch (e) {
    console.warn("offscreen stop:", e); // offscreen page may already be gone; still clear state below
  } finally {
    await chrome.storage.local.remove("rec");
    chrome.power.releaseKeepAwake();
    chrome.action.setBadgeText({ text: "" });
  }
}

async function setPaused(paused) {
  await chrome.runtime.sendMessage({ target: "offscreen", type: paused ? "pause" : "resume" });
  const { rec } = await chrome.storage.local.get("rec");
  if (rec) await chrome.storage.local.set({ rec: { ...rec, paused } });
  chrome.action.setBadgeText({ text: paused ? "II" : "REC" });
  chrome.action.setBadgeBackgroundColor({ color: paused ? "#f29900" : "#d93025" });
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "background") return;
  ({ start, stop, pause: () => setPaused(true), resume: () => setPaused(false) }[msg.type](msg))
    .then((sessionId) => send({ ok: true, sessionId }))
    .catch((e) => send({ ok: false, error: String(e.message || e) }));
  return true;
});

// First install: open the settings page so the student can enter field, country, language and the server token.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") chrome.runtime.openOptionsPage();
});
