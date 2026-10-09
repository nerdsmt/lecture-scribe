const $ = (id) => document.getElementById(id);
let cfg, sessions = [], cur = null, curIdx = 0, urls = new Map();

async function api(path, opt = {}) {
  const r = await fetch(cfg.workerUrl.replace(/\/$/, "") + path, {
    ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${cfg.token}` },
  });
  return opt.blob ? r.blob() : r.json();
}
const ts = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60, p = (n) => String(n).padStart(2, "0"); return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`; };
const dateOf = (m) => m.startedAt ? new Date(m.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
const duration = (s) => { const c = s.chunks; return c.length ? c[c.length - 1].offset + 30 : 0; };

// Build a node with matches wrapped in <mark>, using text nodes only (transcripts are untrusted text).
function highlighted(text, q) {
  const span = document.createElement("span");
  if (!q) { span.textContent = text; return span; }
  const lo = text.toLowerCase(); let i = 0, j;
  while ((j = lo.indexOf(q, i)) !== -1) {
    span.append(text.slice(i, j));
    const mk = document.createElement("mark"); mk.textContent = text.slice(j, j + q.length); span.append(mk);
    i = j + q.length;
  }
  span.append(text.slice(i)); return span;
}

let courseTerms = {}, exportDir = "";
async function loadCourses() { try { courseTerms = await api("/courses"); } catch { courseTerms = {}; } }

async function load(keepId) {
  cfg = await getSettings();
  if (!cfg.workerUrl || !cfg.token) { $("count").textContent = "First, open the extension Options and paste the server token."; return; }
  try {
    const list = await api("/sessions");
    sessions = (await Promise.all(list.map(async (m) => {
      const d = await api("/sessions/" + m.id);
      return { meta: { ...d.meta, id: m.id }, chunks: d.chunks, plain: d.plain || "" };
    }))).sort((a, b) => (b.meta.startedAt || 0) - (a.meta.startedAt || 0));
  } catch { $("count").textContent = "Cannot reach the local server. Start it (start.sh on macOS/Linux, start.bat on Windows) and press Refresh."; return; }
  await loadCourses();
  try { exportDir = (await api("/config")).exportDir || ""; } catch { exportDir = ""; }
  $("audioDrive").hidden = !exportDir;
  renderList();
  const keep = sessions.find((s) => s.meta.id === keepId);
  if (keep) open(keep); else if (!cur) { $("view").hidden = true; $("empty").hidden = false; }
}

function renderList() {
  const q = $("q").value.trim().toLowerCase();
  const rows = sessions.filter((s) => !q || `${s.meta.title} ${s.meta.course}`.toLowerCase().includes(q) || s.plain.toLowerCase().includes(q));
  $("count").textContent = `${rows.length} of ${sessions.length} lectures`;
  $("list").replaceChildren(...rows.map((s) => {
    const el = document.createElement("div"); el.className = "item" + (cur?.meta.id === s.meta.id ? " on" : ""); el.role = "listitem";
    const b = document.createElement("b"); b.append(highlighted(s.meta.title || s.meta.id, q));
    const sm = document.createElement("small"); sm.textContent = [s.meta.course, dateOf(s.meta), duration(s) ? ts(duration(s)) : ""].filter(Boolean).join(" · ");
    el.append(b, sm);
    const at = q && s.plain.toLowerCase().indexOf(q);
    if (q && at >= 0) { const sn = document.createElement("span"); sn.className = "snip"; sn.append("…", highlighted(s.plain.slice(Math.max(0, at - 40), at + 80), q), "…"); el.append(sn); }
    el.onclick = () => open(s);
    return el;
  }));
}

function open(s) {
  if (cur?.meta.id !== s.meta.id) { stopAudio(); urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); $("notesBox").hidden = true; }
  cur = s; curIdx = 0;
  $("empty").hidden = true; $("view").hidden = false;
  $("title").textContent = s.meta.title || s.meta.id;
  $("crumbs").textContent = ["Lectures", s.meta.course, s.meta.title].filter(Boolean).join("  /  ");
  $("meta").textContent = [s.meta.course, dateOf(s.meta), duration(s) ? ts(duration(s)) + " recorded" : "", s.meta.docId ? "live Google Doc" : ""].filter(Boolean).join(" · ");
  renderTranscript(); renderList();
}

function renderTranscript() {
  const q = $("q").value.trim().toLowerCase();
  const rows = cur.chunks.map((c, i) => {
    if (!c.text) return null;
    const el = document.createElement("div"); el.className = "line"; el.dataset.i = i;
    const t = document.createElement("span"); t.className = "ts"; t.textContent = ts(c.offset);
    const x = document.createElement("span"); x.append(highlighted(c.text, q));
    el.append(t, x); el.onclick = () => play(i); return el;
  }).filter(Boolean);
  if (!rows.length) { const p = document.createElement("p"); p.className = "hint"; p.textContent = "No speech was transcribed for this recording."; rows.push(p); }
  $("transcript").replaceChildren(...rows);
}

// Audio: parts are separate WebM files; fetch with the auth header, play back-to-back, preload the next.
async function partUrl(i) {
  const c = cur.chunks[i]; if (!c) return null;
  const key = `${cur.meta.id}/${c.n}`;
  if (!cur.files) cur.files = Object.fromEntries((await api(`/sessions/${cur.meta.id}/audio`)).map((f) => [parseInt(f.key, 10), f.key]));
  const name = cur.files[c.n]; if (!name) return null;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(await api(`/sessions/${cur.meta.id}/audio/${name}`, { blob: true })));
  return urls.get(key);
}
async function play(i) {
  const id = cur.meta.id; curIdx = i;
  const a = $("audio"), u = await partUrl(i);
  if (!u || cur.meta.id !== id) return;
  a.src = u; a.playbackRate = parseFloat($("rate").value); await a.play().catch(() => {});
  $("part").textContent = `part ${i + 1} of ${cur.chunks.length}`;
  document.querySelectorAll(".line.now").forEach((e) => e.classList.remove("now"));
  const now = document.querySelector(`.line[data-i="${i}"]`); if (now) { now.classList.add("now"); now.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  partUrl(i + 1).catch(() => {});
}
function stopAudio() { const a = $("audio"); a.pause(); a.removeAttribute("src"); $("part").textContent = ""; }
$("audio").onended = () => { if (curIdx + 1 < cur.chunks.length) play(curIdx + 1); };
$("rate").onchange = () => ($("audio").playbackRate = parseFloat($("rate").value));
$("audio").onplay = () => { if (!$("audio").src) play(curIdx); };

const markdown = (s) => `# ${s.meta.title || s.meta.id}\n\nCourse: ${s.meta.course || "-"}  \nDate: ${dateOf(s.meta)}\n\n## Transcript\n\n` +
  s.chunks.filter((c) => c.text).map((c) => `[${ts(c.offset)}] ${c.text}`).join("\n\n") + "\n";
const safeName = (s) => (s.meta.title || s.meta.id).replace(/[\\/:*?"<>|]+/g, "-");

$("dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([markdown(cur)], { type: "text/markdown" })); a.download = safeName(cur) + ".md"; a.click(); };
$("copy").onclick = async () => { await navigator.clipboard.writeText(markdown(cur)); $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy transcript"), 1500); };
$("audioDl").onclick = async () => {
  const b = $("audioDl"); b.textContent = "Preparing…"; b.disabled = true;
  try { const blob = await api(`/sessions/${cur.meta.id}/audio.m4a`, { blob: true }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = safeName(cur) + ".m4a"; a.click(); }
  catch { alert("Could not build the audio file."); }
  b.textContent = "Download audio (.m4a)"; b.disabled = false;
};
$("audioDrive").onclick = async () => {
  const b = $("audioDrive"); b.textContent = "Saving…"; b.disabled = true;
  const r = await api(`/sessions/${cur.meta.id}/audio/export`, { method: "POST" });
  b.textContent = r.ok ? `Saved (${r.mb} MB)` : "Save audio to export folder"; if (!r.ok) alert(r.error);
  setTimeout(() => { b.textContent = "Save audio to export folder"; b.disabled = false; }, 2500);
};
$("rename").onclick = async () => {
  const title = prompt("Lecture title:", cur.meta.title || ""); if (title === null) return;
  const course = prompt("Course:", cur.meta.course || ""); if (course === null) return;
  await api("/sessions/" + cur.meta.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() || cur.meta.title, course: course.trim() }) });
  await load(cur.meta.id);
};
$("del").onclick = async () => {
  if (!confirm(`Delete "${cur.meta.title || cur.meta.id}"? This removes the audio, the transcript and any exported copy. A live Google Doc is not touched.`)) return;
  stopAudio(); await api("/sessions/" + cur.meta.id, { method: "DELETE" }); cur = null; await load();
};
$("notes").onclick = async () => {
  $("notes").textContent = "Working… (about a minute)"; $("notes").disabled = true;
  try { const r = await api(`/sessions/${cur.meta.id}/notes`, { method: "POST" }); $("notesText").textContent = r.markdown || r.error; $("notesBox").hidden = false; }
  catch { $("notesText").textContent = "Could not generate notes (is Ollama running?)."; $("notesBox").hidden = false; }
  $("notes").textContent = "Local AI notes"; $("notes").disabled = false;
};
$("q").oninput = () => { renderList(); if (cur) renderTranscript(); };
$("refresh").onclick = () => load(cur?.meta.id);
load();

// ---- course term lists dialog ----
async function renderCourses() {
  await loadCourses();
  const rows = Object.entries(courseTerms).map(([name, terms]) => {
    const row = document.createElement("div"); row.className = "crow";
    const top = document.createElement("div"); top.className = "top";
    const b = document.createElement("b"); b.textContent = name;
    const save = Object.assign(document.createElement("button"), { className: "link", textContent: "Save" });
    const del = Object.assign(document.createElement("button"), { className: "link danger", textContent: "Delete" });
    const ta = document.createElement("textarea"); ta.value = terms;
    save.onclick = async () => { await api("/courses/" + encodeURIComponent(name), { method: "PUT", body: JSON.stringify({ terms: ta.value }) }); save.textContent = "Saved"; setTimeout(() => (save.textContent = "Save"), 1500); };
    del.onclick = async () => { if (confirm(`Delete the term list for "${name}"?`)) { await api("/courses/" + encodeURIComponent(name), { method: "DELETE" }); renderCourses(); } };
    const btns = document.createElement("span"); btns.append(save, del); top.append(b, btns); row.append(top, ta); return row;
  });
  if (!rows.length) { const p = document.createElement("p"); p.className = "hint"; p.textContent = "No saved courses yet. Add one below, or use the starter lists."; rows.push(p); }
  $("courseRows").replaceChildren(...rows);
}
// close the "more" menu after choosing an action or clicking elsewhere
document.querySelectorAll(".menu button").forEach((b) => b.addEventListener("click", () => setTimeout(() => (document.querySelector(".more").open = false), 50)));
document.addEventListener("click", (e) => { const m = document.querySelector(".more"); if (m.open && !m.contains(e.target)) m.open = false; });
$("optionsBtn").onclick = () => chrome.runtime.openOptionsPage();
$("coursesBtn").onclick = () => { renderCourses(); $("coursesDlg").showModal(); };
$("addCourse").onclick = async () => {
  const n = $("newCourse").value.trim(); if (!n) return;
  await api("/courses/" + encodeURIComponent(n), { method: "PUT", body: JSON.stringify({ terms: "(add terms, separated by commas)" }) });
  $("newCourse").value = ""; renderCourses();
};
// Optional subject presets (presets.js): adds a short, editable starter term list as a new course.
$("presetPick").replaceChildren(...SUBJECT_PRESETS.map((p) => Object.assign(document.createElement("option"), { value: p.id, textContent: p.label })));
$("addPreset").onclick = async () => {
  const p = SUBJECT_PRESETS.find((x) => x.id === $("presetPick").value); if (!p) return;
  await loadCourses();
  if (courseTerms[p.label]) { $("presetMsg").textContent = `"${p.label}" is already saved.`; return; }
  await api("/courses/" + encodeURIComponent(p.label), { method: "PUT", body: JSON.stringify({ terms: p.terms }) });
  $("presetMsg").textContent = `Added "${p.label}". Rename it to your course and edit the terms freely.`; renderCourses();
};
