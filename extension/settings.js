// Shared settings for every extension page. Stored with chrome.storage.local, so nothing is synced through your Google
// account. (The token and any live-Docs secret therefore never leave this browser profile.)
const SETTINGS_DEFAULTS = {
  workerUrl: "http://localhost:8787",   // address of the local server (key name kept for compatibility with the Cloudflare worker)
  token: "",                            // shown by the server on first start; paste it in Options
  language: "auto",                     // transcript language code, or "auto" to detect
  field: "",                            // field of study, e.g. "Medicine" (free text)
  country: "",                          // country or jurisdiction, e.g. "Canada"
  accent: "#2563eb",                    // accent colour
  liveUrl: "", liveKey: "",             // OPTIONAL live Google Docs
  consentAck: false,                    // the recording reminder has been acknowledged
};
const ACCENTS = [
  { name: "Blue", hex: "#2563eb" }, { name: "Teal", hex: "#0f766e" }, { name: "Green", hex: "#15803d" },
  { name: "Purple", hex: "#7c3aed" }, { name: "Orange", hex: "#c2410c" }, { name: "Slate", hex: "#475569" },
];
async function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS))) };
}
function saveSettings(patch) { return chrome.storage.local.set(patch); }
function applyAccent(hex) {
  if (/^#[0-9a-f]{6}$/i.test(hex || "")) document.documentElement.style.setProperty("--accent", hex);
}
if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.storage) {
  getSettings().then((s) => applyAccent(s.accent)).catch(() => {});
}
