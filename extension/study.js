// Study prompts dialog (DOM glue). The prompt text itself is built in prompt-builder.js from the settings in Options.
let studyCtx = { field: "", country: "", language: "auto", preset: null };

function studyContext() {
  return { ...studyCtx, terms: termsFor(courseTerms, cur?.meta.course) };
}

function fillModeSelect() {
  const sel = $("mode"), keep = sel.value;
  const suggested = studyCtx.preset?.modes || [];
  const opt = (k) => Object.assign(document.createElement("option"), { value: k, textContent: STUDY_MODES[k].label });
  sel.replaceChildren();
  if (suggested.length) {
    const g1 = Object.assign(document.createElement("optgroup"), { label: `Suggested for ${studyCtx.preset.label}` });
    g1.append(...suggested.map(opt));
    const g2 = Object.assign(document.createElement("optgroup"), { label: "All study modes" });
    g2.append(...Object.keys(STUDY_MODES).filter((k) => !suggested.includes(k)).map(opt));
    sel.append(g1, g2);
  } else sel.append(...Object.keys(STUDY_MODES).map(opt));
  if (keep && STUDY_MODES[keep]) sel.value = keep;
}

function refreshStudyPrompt() {
  const session = cur; if (!session) return;
  const mode = $("mode").value, tool = $("tool").value;
  const parts = transcriptParts(session);
  const long = tool === "paste" && parts.length > 1;
  $("partWrap").hidden = !long;
  if (long && $("part2").options.length !== parts.length) {
    $("part2").replaceChildren(...parts.map((_, i) => Object.assign(document.createElement("option"), { value: i, textContent: `${i + 1} of ${parts.length}` })));
  }
  $("modeHint").textContent = STUDY_MODES[mode].hint + (long ? " Paste each part into the same chat one after another, or work on one part at a time." : "") +
    (tool === "nlm" ? " In NotebookLM, make sure the lecture is added as a source first (see the README)." : "");
  const text = buildPrompt(session, mode, tool, long ? parseInt($("part2").value || "0", 10) : 0, studyContext());
  $("promptText").value = text; $("wc").textContent = `${wordsOf(text).toLocaleString()} words`;
}

["mode", "tool", "part2"].forEach((id) => ($(id).onchange = refreshStudyPrompt));
$("study").onclick = async () => {
  const s = await getSettings();
  studyCtx = { field: s.field, country: s.country, language: s.language, preset: findPreset(s.field) };
  fillModeSelect();
  $("part2").replaceChildren(); refreshStudyPrompt(); $("studyDlg").showModal();
};
$("copyPrompt").onclick = async () => {
  await navigator.clipboard.writeText($("promptText").value);
  const b = $("copyPrompt"); b.textContent = "Copied. Now paste it into the chat"; setTimeout(() => (b.textContent = "Copy prompt"), 2500);
};
