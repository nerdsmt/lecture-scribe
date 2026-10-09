const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m });
let timerI;

async function refresh() {
  const { rec } = await chrome.storage.local.get("rec");
  $("go").textContent = rec ? "Stop recording" : "Start recording";
  $("pause").style.display = rec ? "block" : "none";
  $("status").className = rec ? (rec.paused ? "paused" : "live") : "";
  $("pause").textContent = rec?.paused ? "Resume transcribing" : "Pause";
  $("setup").style.display = rec ? "none" : "block";
  clearInterval(timerI);
  if (rec) {
    if (rec.paused) $("status").textContent = "Paused. Nothing is being recorded";
    else {
      const tick = () => ($("status").textContent = "Recording… " + new Date(Date.now() - rec.startedAt).toISOString().substr(11, 8));
      tick(); timerI = setInterval(tick, 1000);
    }
  }
}

let cfg = { ...SETTINGS_DEFAULTS };
async function init() {
  cfg = await getSettings();
  $("banner").hidden = !!cfg.token;
  $("docWrap").hidden = !cfg.liveUrl;       // live Google Docs is optional: only shown once it is set up in Options
}
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();

// First recording: show a short consent reminder once (stored in settings), then start.
function setConsentVisible(on) {
  $("consent").style.display = on ? "block" : "none";
  $("go").style.display = on ? "none" : "block";
  $("setup").style.display = on ? "none" : "block";
}
$("consentCancel").onclick = () => setConsentVisible(false);
$("consentOk").onclick = async () => { await saveSettings({ consentAck: true }); cfg.consentAck = true; setConsentVisible(false); $("go").click(); };

$("go").onclick = async () => {
  const { rec } = await chrome.storage.local.get("rec");
  if (!rec && !cfg.consentAck) return setConsentVisible(true);
  if (!rec && $("course").value.trim() && $("terms").value.trim()) {   // remember this course's terms for next time
    api("/courses/" + encodeURIComponent($("course").value.trim()), { method: "PUT", body: JSON.stringify({ terms: $("terms").value.trim() }) }).catch(() => {});
  }
  $("status").textContent = rec ? "Finishing uploads…" : $("docUrl").value.trim() ? "Starting (live to Google Doc)…" : "Starting…";
  const r = await send(rec
    ? { type: "stop" }
    : { type: "start", mode: $("mode").value, title: $("title").value, course: $("course").value, terms: $("terms").value, docUrl: $("docUrl").value.trim() });
  if (!r.ok) $("status").textContent = "Error: " + r.error;
  else if (rec) { $("status").textContent = "Saved. Open the library to read the transcript."; loadList(); }
  refresh();
};

$("pause").onclick = async () => {
  const { rec } = await chrome.storage.local.get("rec");
  const r = await send({ type: rec?.paused ? "resume" : "pause" });
  if (!r.ok) $("status").textContent = "Error: " + r.error;
  refresh();
};

$("lib").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });

let courses = {};
async function loadCourses() {
  try { courses = await api("/courses"); $("courseList").replaceChildren(...Object.keys(courses).map((k) => Object.assign(document.createElement("option"), { value: k }))); } catch {}
}
// Picking a saved course fills the terms box (only if empty), so you never retype them.
$("course").onchange = () => { const t = courses[$("course").value.trim()]; if (t && !$("terms").value.trim()) $("terms").value = t; };

async function api(path, opt = {}) {
  const { workerUrl, token } = await getSettings();
  const r = await fetch(workerUrl.replace(/\/$/, "") + path, { ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${token}` } });
  return r.json();
}

async function loadList() {
  try {
    const items = (await api("/sessions")).slice(0, 10);
    $("list").innerHTML = "";
    if (!items.length) $("list").textContent = "No lectures yet.";
    for (const s of items) {
      const row = document.createElement("div"); row.className = "row";
      const name = document.createElement("span"); name.textContent = s.title || s.id; name.title = s.course || "";
      const btn = (label, fn, cls = "sm") => Object.assign(document.createElement("button"), { className: cls, textContent: label, onclick: fn });
      const x = btn("Delete", async () => {
        if (!confirm(`Delete \"${s.title || s.id}\"? This removes the audio, the transcript and any exported copy.`)) return;
        await api("/sessions/" + s.id, { method: "DELETE" }); loadList();
      }, "sm del");
      const acts = document.createElement("div"); acts.className = "acts"; acts.append(x);
      row.append(name, acts); $("list").append(row);
    }
  } catch { $("list").textContent = "Cannot reach the server yet. Start it, and check Settings (right-click the icon → Options)."; }
}
chrome.storage.local.get("docUrl").then(({ docUrl }) => { if (docUrl) $("docUrl").value = docUrl; });
$("docUrl").onchange = () => chrome.storage.local.set({ docUrl: $("docUrl").value.trim() });
init(); loadCourses(); refresh(); loadList();
