const $ = (i) => document.getElementById(i);
const TEXT = ["field", "country", "language", "workerUrl", "token", "liveUrl", "liveKey"];
const LANGS = { auto: "Detect automatically", en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch",
  pl: "Polish", ru: "Russian", uk: "Ukrainian", tr: "Turkish", ar: "Arabic", he: "Hebrew", hi: "Hindi", bn: "Bengali", ur: "Urdu", zh: "Chinese", ja: "Japanese",
  ko: "Korean", vi: "Vietnamese", th: "Thai", id: "Indonesian", ms: "Malay", sv: "Swedish", da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech",
  el: "Greek", hu: "Hungarian", ro: "Romanian", bg: "Bulgarian", hr: "Croatian", sr: "Serbian", sk: "Slovak", sl: "Slovenian", ca: "Catalan", mt: "Maltese" };
let accent = SETTINGS_DEFAULTS.accent;

$("fieldList").replaceChildren(...SUBJECT_PRESETS.map((p) => Object.assign(document.createElement("option"), { value: p.label })));
$("langList").replaceChildren(...Object.entries(LANGS).map(([k, v]) => Object.assign(document.createElement("option"), { value: k, label: v, textContent: v })));

function noteField() {
  const p = findPreset($("field").value);
  $("fieldNote").textContent = !$("field").value.trim() ? "" : p
    ? `Recognised as "${p.label}": Study prompts will suggest the modes that usually suit it. This is only a suggestion.`
    : "Not one of the built-in presets, which is fine. Study prompts will use your field name and offer every study mode.";
}
$("field").oninput = noteField;

function drawSwatches() {
  $("swatches").replaceChildren(...ACCENTS.map((a) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "sw"; b.setAttribute("role", "radio");
    b.style.setProperty("--c", a.hex); b.setAttribute("aria-checked", String(a.hex === accent));
    const i = document.createElement("i"); b.append(i, a.name);
    b.onclick = () => { accent = a.hex; applyAccent(accent); drawSwatches(); };
    return b;
  }));
}

async function loadExports(cfg) {
  try {
    const c = await (await fetch(cfg.workerUrl.replace(/\/$/, "") + "/config", { headers: { Authorization: `Bearer ${cfg.token}` } })).json();
    if (c.error) throw new Error(c.error);
    $("exportPick").append(...c.exportCandidates.map((f) => Object.assign(document.createElement("option"), { value: f.path, textContent: `${f.label}: ${f.path}` })));
    $("exportDir").value = c.exportDir || "";
    $("exportPick").value = c.exportCandidates.some((f) => f.path === c.exportDir) ? c.exportDir : "";
    $("exportMsg").textContent = c.exportDir ? "Export is ON." : `Export is off. Speech model on this computer: ${c.whisperModel}.`;
  } catch { $("exportMsg").textContent = "Connect to the server (section 2) to choose an export folder."; }
}
$("exportPick").onchange = () => { if ($("exportPick").value) $("exportDir").value = $("exportPick").value; };

async function init() {
  const s = await getSettings();
  TEXT.forEach((k) => ($(k).value = s[k] || ""));
  accent = s.accent; drawSwatches(); noteField();
  if (s.token) loadExports(s);
}

$("show").onclick = () => { const t = $("token"); t.type = t.type === "password" ? "text" : "password"; $("show").textContent = t.type === "password" ? "Show token" : "Hide token"; };

async function test() {
  const url = $("workerUrl").value.trim().replace(/\/$/, ""), token = $("token").value.trim(), out = $("testMsg");
  out.className = "hint";
  try {
    const h = await fetch(url + "/health").then((r) => r.json());
    if (!h.ok) throw new Error("not a Lecture Scribe server");
  } catch { out.className = "bad"; out.textContent = "Cannot reach the server. Is it running?"; return false; }
  try {
    const r = await fetch(url + "/sessions", { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { out.className = "bad"; out.textContent = "Server found, but the token is wrong."; return false; }
    out.className = "ok"; out.textContent = "Connected ✓"; return true;
  } catch { out.className = "bad"; out.textContent = "The server answered, but Chrome blocked the request. Save first so the address is allowed."; return false; }
}
$("test").onclick = test;

$("mic").onclick = async () => {
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); $("micMsg").textContent = "Microphone allowed ✓"; }
  catch (e) { $("micMsg").textContent = "Blocked: " + e.message; }
};

$("save").onclick = async () => {
  const msg = $("msg"); msg.className = "hint";
  const live = $("liveKey").value.trim();
  if (live && /^https?:/i.test(live)) { msg.className = "bad"; return (msg.textContent = "The live Docs secret looks like a URL. Paste the SECRET value instead."); }
  const patch = Object.fromEntries(TEXT.map((k) => [k, $(k).value.trim()]));
  patch.language = patch.language || "auto"; patch.accent = accent;
  patch.workerUrl = (patch.workerUrl || SETTINGS_DEFAULTS.workerUrl).replace(/\/$/, "");
  // Servers other than this computer need an explicit browser permission for that address.
  try {
    const o = new URL(patch.workerUrl);
    if (!["localhost", "127.0.0.1"].includes(o.hostname) && chrome.permissions) {
      const ok = await chrome.permissions.request({ origins: [o.origin + "/*"] });
      if (!ok) { msg.className = "bad"; return (msg.textContent = "Chrome needs your permission to contact that address."); }
    }
  } catch { msg.className = "bad"; return (msg.textContent = "The server address is not a valid URL."); }
  await saveSettings(patch);
  if (patch.token) {
    try {
      const want = $("exportDir").value.trim();
      const r = await fetch(patch.workerUrl + "/config", { method: "PUT", headers: { Authorization: `Bearer ${patch.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ exportDir: want }) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      $("exportMsg").textContent = want ? "Export is ON." : "Export is off.";
    } catch (e) { if ($("exportDir").value.trim()) { msg.className = "bad"; msg.textContent = "Saved, but the export folder was not set: " + e.message; return; } }
  }
  msg.textContent = "Saved ✓";
};
init();
