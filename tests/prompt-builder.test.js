// Run from the repo root:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPrompt, transcriptParts, contextRule, termsFor, tsFmt, STUDY_MODES, WORDS_PER_PART } = require("../extension/prompt-builder.js");
const { SUBJECT_PRESETS, findPreset } = require("../extension/presets.js");

const session = (over = {}) => ({
  meta: { id: "abc123", title: "Week 2", course: "Cell Biology", startedAt: Date.UTC(2025, 2, 4, 12), ...over },
  chunks: [{ n: 0, offset: 0, text: "Today we cover mitosis." }, { n: 1, offset: 30, text: "Prophase comes first." }, { n: 2, offset: 3725, text: "" }],
});
const ALL_PERSONAL = /malta|university of|bachelor of commerce|bcom|maltese|um\.edu|\beuro\b/i;

test("uses field and country from settings, not hard-coded text", () => {
  const p = buildPrompt(session(), "summary", "paste", 0, { field: "Medicine", country: "Canada", preset: findPreset("Medicine") });
  assert.match(p, /study coach for a student of Medicine in Canada/);
  assert.match(p, /Course: Cell Biology/);
  assert.match(p, /\[00:30\] Prophase comes first\./);
  assert.doesNotMatch(p, ALL_PERSONAL);
});

test("no field and no country still gives a valid generic prompt", () => {
  const p = buildPrompt(session(), "exam", "paste", 0, {});
  assert.match(p, /study coach for a student\./);
  assert.doesNotMatch(p, /\bin undefined|\bnull\b/);
  assert.doesNotMatch(p, /assume|I study in/);
});

test("law, standards, currency are only mentioned when the field uses them", () => {
  const law = contextRule({ country: "Germany", preset: findPreset("Law") });
  assert.match(law, /laws and legal rules/); assert.doesNotMatch(law, /currency/);
  const acc = contextRule({ country: "Kenya", preset: findPreset("accounting") });
  assert.match(acc, /professional or technical standards, currency/); assert.doesNotMatch(acc, /laws/);
  const cs = contextRule({ country: "India", preset: findPreset("Computer Science") });
  assert.doesNotMatch(cs, /laws|currency|standards/); assert.match(cs, /only bring that in/i);
  const free = contextRule({ country: "India", preset: null });          // a field with no preset
  assert.doesNotMatch(free, /laws|currency|standards/);
  assert.equal(contextRule({ field: "Law", country: "" , preset: findPreset("Law")}), "");
});

test("scenario mode mentions IRAC only for law", () => {
  assert.match(buildPrompt(session(), "scenario", "paste", 0, { field: "Law", preset: findPreset("Law") }), /IRAC/);
  assert.doesNotMatch(buildPrompt(session(), "scenario", "paste", 0, { field: "Medicine", preset: findPreset("Medicine") }), /IRAC/);
});

test("every mode builds, with no personal/institutional wording", () => {
  for (const k of Object.keys(STUDY_MODES)) {
    const p = buildPrompt(session(), k, "paste", 0, { field: "History", country: "Spain", language: "es", preset: findPreset("History") });
    assert.ok(p.includes("TASK:") && p.includes("LECTURE TRANSCRIPT:"), k);
    assert.doesNotMatch(p, ALL_PERSONAL, k);
    assert.match(p, /language code is "es"/);
  }
});

test("NotebookLM prompt names the source file instead of embedding the transcript", () => {
  const p = buildPrompt(session({ title: "A/B: test" }), "summary", "nlm", 0, {});
  assert.match(p, /2025-03-04 A-B- test/);
  assert.doesNotMatch(p, /LECTURE TRANSCRIPT/);
});

test("session terms win, otherwise course terms are shown", () => {
  assert.match(buildPrompt(session(), "cards", "paste", 0, { terms: "mitosis, meiosis" }), /Course terms: mitosis, meiosis/);
  assert.match(buildPrompt(session({ terms: "own list" }), "cards", "paste", 0, { terms: "saved list" }), /Course terms: own list/);
  assert.doesNotMatch(buildPrompt(session(), "cards", "paste", 0, {}), /Course terms/);
});

test("long transcripts are split into parts of at most WORDS_PER_PART words", () => {
  const chunks = Array.from({ length: 40 }, (_, i) => ({ n: i, offset: i * 30, text: "word ".repeat(500).trim() }));
  const parts = transcriptParts({ chunks });
  assert.equal(parts.length, 3);
  for (const p of parts) assert.ok(p.split(/\s+/).filter((w) => w === "word").length <= WORDS_PER_PART);
  assert.match(buildPrompt({ meta: session().meta, chunks }, "summary", "paste", 1, {}), /part 2 of 3/);
});

test("timestamps", () => { assert.equal(tsFmt(65), "01:05"); assert.equal(tsFmt(3725), "1:02:05"); });

test("course term matching mirrors the server", () => {
  const saved = { "Financial Accounting": "accruals, IAS 16", Accounting: "ledger, accruals" };
  assert.equal(termsFor(saved, "financial accounting"), "accruals, IAS 16");
  assert.equal(termsFor(saved, "ACC1000 Financial Accounting and Control"), "accruals, IAS 16, ledger");
  assert.equal(termsFor(saved, "a"), ""); assert.equal(termsFor(saved, ""), ""); assert.equal(termsFor(saved, "Chemistry"), "");
});

test("presets are well formed and reference real study modes", () => {
  const ids = new Set();
  for (const p of SUBJECT_PRESETS) {
    assert.ok(p.id && p.label && p.terms.split(",").length >= 8, p.id);
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    for (const m of p.modes) assert.ok(STUDY_MODES[m], `${p.id} -> ${m}`);
    assert.doesNotMatch(JSON.stringify(p), ALL_PERSONAL, p.id);
  }
  assert.equal(findPreset("law").id, "law"); assert.equal(findPreset("Maths").id, "maths");
  assert.equal(findPreset("underwater basket weaving"), null); assert.equal(findPreset(""), null);
});
