// Study prompt builder (pure functions, no DOM): turns a lecture transcript into a ready-to-paste prompt for
// Gemini / ChatGPT / Claude / NotebookLM. Everything about the student (field, country, language) comes from the
// settings passed in as `ctx`; nothing is hard-coded to a school, degree or country.
//
// ctx = { field, country, language, preset (object from presets.js or null), terms (course term list or "") }

const STUDY_MODES = {
  summary: {
    label: "Summary and key points",
    hint: "A short exam-focused summary with the 'must know' points.",
    task: () => `Summarise this lecture for exam revision.
1. A 6-8 sentence summary.
2. "Must know": the 8-12 most examinable points, each with the [mm:ss] timestamp where the lecturer made it.
3. Anything the lecturer explicitly flagged as important, examinable, or "will come up" (quote the words briefly).
4. A list of the definitions, formulas, numbers, names, rules, standards or sources mentioned, with timestamps.`,
  },
  calc: {
    label: "Calculation and problem drills",
    hint: "Practice problems in the lecturer's style. Answers are hidden until you attempt them.",
    task: () => `Write 5 practice problems in the style of the worked examples in this lecture (calculations, derivations, proofs, data analysis, worked procedures - whatever the lecture covers). Increase difficulty from 1 to 5.
Rules:
- Give the problems first, WITHOUT answers. Then wait for me to reply with my answers.
- When I answer, mark each step (method marks and accuracy marks), show the full worked solution, and tell me exactly where I went wrong.
- After the 5 problems, list the 3 weakest topics I showed and the [mm:ss] lecture moment to rewatch for each.`,
  },
  scenario: {
    label: "Case and scenario practice",
    hint: "Realistic cases (legal, clinical, business, design...) marked step by step.",
    task: (ctx) => `Write 3 case or scenario questions in the style of an exam for ${ctx.field || "this subject"} (for example problem questions, clinical vignettes, business cases or design problems, whichever fits), using ONLY the material taught in this lecture.
Rules:
- Give scenario 1 only. Wait for my answer.
- Mark my answer: did I spot the key issues, apply the right concepts${ctx.preset?.context?.law ? " and rules (use IRAC: Issue, Rule, Application, Conclusion)" : ""} to the facts, and reach a justified conclusion? Give a mark out of 20 and a model answer. Point out anything I missed.
- Then give scenario 2, and so on.
- At the end, list the key concepts, sources or cases from the lecture I should be able to cite, with timestamps.`,
  },
  exam: {
    label: "Exam questions with a marking scheme",
    hint: "A mini mock exam: short questions plus one long question, with marks.",
    task: () => `Create a 30-minute mock exam from this lecture: 6 short questions (2-3 marks each) and 1 long question (15 marks). Do not show the answers yet.
When I send my answers, mark them against a clear marking scheme, give my total, and explain every lost mark. Finish with a revision plan for the topics I lost most marks on, referencing [mm:ss] timestamps.`,
  },
  cards: {
    label: "Flashcards (CSV for Anki / Quizlet)",
    hint: "One flashcard per line, ready to import.",
    task: () => `Create 25 flashcards from this lecture covering definitions, formulas, rules, key names and examples. Output as a CSV code block with two columns, "front","back", with no header row, so I can import it into Anki or Quizlet. Put the [mm:ss] timestamp at the end of each back. Prefer cards that test understanding ("when does X apply?") over plain definitions.`,
  },
  mcq: {
    label: "Multiple-choice quiz",
    hint: "15 MCQs with plausible wrong answers. Answers are revealed only after you reply.",
    task: () => `Write a 15-question multiple-choice quiz from this lecture, 4 options (A-D) each, exactly one correct. Mix recall, application and (where the subject has them) short calculations where the options are the typical wrong answers students get (wrong sign, forgot a step, wrong base).
Rules:
- Give all 15 questions first WITHOUT the answers, then wait for me to reply with my letters (e.g. "1A 2C ...").
- Then give my score, and for every question I missed explain why the right option is right and why mine was tempting, with the [mm:ss] timestamp to rewatch.
- Finish with a 3-bullet summary of my weak areas.`,
  },
  pastpaper: {
    label: "Match my past paper's style",
    hint: "Paste past-paper questions (or attach the PDF) under the prompt so new questions copy their style, difficulty and mark split.",
    task: () => `I will give you questions from a past exam paper for this course. Study their style: wording, difficulty, mark allocation, and the balance of calculation, theory and application. Then write NEW questions on THIS lecture in exactly that style and format, with the same marks. Do not reuse the past-paper questions.
Also tell me which past-paper questions look like they are covered by this lecture, with the [mm:ss] timestamps to revise.
When I answer your new questions, mark them as the examiner would (mark scheme first, then my marks, then a model answer).

PAST PAPER QUESTIONS (paste them here, or attach the PDF/photos):
(paste past paper here)`,
  },
  explain: {
    label: "Explain the hard parts simply",
    hint: "Finds the confusing bits and re-explains them with examples.",
    task: () => `Pick the 5 hardest or most easily confused ideas in this lecture. For each: explain it simply in plain language, give one small worked example, and describe the most common mistake students make. Finish with 3 quick check questions (no answers) and wait for my replies.`,
  },
  code: {
    label: "Coding exercises",
    hint: "Small programming tasks and 'what does this code do?' questions based on the lecture.",
    task: () => `Write 5 exercises from this lecture: 3 short coding tasks and 2 "trace this code / what is its output or complexity?" questions. Increase difficulty from 1 to 5. Give the exercises first WITHOUT solutions and wait for my answers. When I reply, review my code for correctness, edge cases and complexity, show a clean solution, and link each point to the [mm:ss] moment in the lecture.`,
  },
  vocab: {
    label: "Vocabulary and language drills",
    hint: "Vocabulary, grammar and translation practice from the lecture.",
    task: () => `Build language practice from this lecture. 1) A table of the 20 most useful new words or phrases (word, meaning, example sentence from the lecture, [mm:ss]). 2) 10 gap-fill or translation exercises using them, WITHOUT answers, then wait for my replies. 3) When I answer, correct my grammar and word choice, explain each mistake briefly, and suggest what to review.`,
  },
  gaps: {
    label: "Find gaps and errors in the transcript",
    hint: "Checks the auto-transcript for misheard names, numbers and terms.",
    task: () => `The transcript was produced by speech recognition, so it may contain mistakes. List everything that looks doubtful: misheard technical terms, names, numbers, references, and especially any amounts or values that seem inconsistent with the surrounding explanation. For each, give the [mm:ss] timestamp, what is written, what it probably should be, and a confidence level. Do not silently correct anything - list it so I can check the recording.`,
  },
  mark: {
    label: "Mark my answer",
    hint: "Paste a question and your answer under the prompt, then send.",
    task: () => `I will give you an exam question and my answer. Mark my answer strictly as an examiner would, using the lecture below as the source of what the lecturer taught. Give a mark, list what I got right, what is missing, and any errors, then show a model answer. If the question is numerical, mark method and accuracy separately.

QUESTION:
(paste the question here)

MY ANSWER:
(paste or type your answer here - or attach a photo of your handwritten working)`,
  },
};

const WORDS_PER_PART = 9000; // keeps each prompt within free-tier limits of most chat tools

function wordsOf(s) { return s.trim() ? s.trim().split(/\s+/).length : 0; }

function tsFmt(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60, p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

function transcriptParts(session) {
  const lines = session.chunks.filter((c) => c.text).map((c) => ({ line: `[${tsFmt(c.offset)}] ${c.text}`, w: wordsOf(c.text) }));
  const parts = []; let cur = [], w = 0;
  for (const l of lines) {
    if (w + l.w > WORDS_PER_PART && cur.length) { parts.push(cur); cur = []; w = 0; }
    cur.push(l.line); w += l.w;
  }
  if (cur.length) parts.push(cur);
  return parts.map((p) => p.join("\n\n"));
}

// Local context lines. Only mentions law / standards / currency / units when the chosen field uses them.
function contextRule(ctx) {
  const country = (ctx.country || "").trim();
  if (!country) return "";
  const c = ctx.preset?.context || {};
  const things = [c.law && "laws and legal rules", c.standards && "professional or technical standards", c.currency && "currency", c.units && "units and conventions"].filter(Boolean);
  if (things.length) {
    return `- Where the lecture refers to ${things.join(", ")}, assume ${country} unless the lecture says otherwise. If the lecture does not say, tell me what you assumed instead of guessing.`;
  }
  return `- I study in ${country}. Only bring that in where the lecture itself refers to local rules or practice.`;
}

function driveName(meta) {
  const d = new Date(meta.startedAt || 0), p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${(meta.title || meta.id).replace(/[\\/:*?"<>|]+/g, "-")}`; // same name the server gives an exported file
}

function buildPrompt(session, modeKey, tool, partIdx, ctx = {}) {
  const m = STUDY_MODES[modeKey], meta = session.meta;
  const when = meta.startedAt ? new Date(meta.startedAt).toLocaleDateString([], { dateStyle: "medium" }) : "";
  const who = ctx.field ? `a student of ${ctx.field}${ctx.country ? ` in ${ctx.country}` : ""}` : `a student${ctx.country ? ` in ${ctx.country}` : ""}`;
  const terms = meta.terms || ctx.terms;
  const lang = ctx.language && ctx.language !== "auto" ? `\n- The lecture language code is "${ctx.language}". Keep quotes from the lecture in that language.` : "";
  const rule = contextRule(ctx);
  const head = `You are a study coach for ${who}.
Course: ${meta.course || "(not given)"}
Lecture: ${meta.title || meta.id}${when ? ` (${when})` : ""}${terms ? `\nCourse terms: ${terms}` : ""}

Ground rules:
- Use ONLY what was said in this lecture as the source of facts. If something is not covered, say so instead of guessing.
- The transcript is automatic and may contain errors (names, numbers, terms). Flag doubtful items rather than guessing.
- Cite lecture timestamps like [12:34] so I can find the moment in the recording.${rule ? "\n" + rule : ""}${lang}

TASK:
${m.task(ctx)}
`;
  if (tool === "nlm") {
    return head + `
SOURCE: Use only the notebook source for this lecture (its file name starts with "${driveName(meta)}"). Ignore other sources unless I ask.`;
  }
  const parts = transcriptParts(session);
  const body = parts[partIdx] ?? "";
  const label = parts.length > 1 ? `LECTURE TRANSCRIPT (part ${partIdx + 1} of ${parts.length}):` : "LECTURE TRANSCRIPT:";
  return head + `\n${label}\n\n${body}\n`;
}

// Same loose course matching as the server: exact name wins, otherwise containment (names under 3 characters only match exactly).
function termsFor(courseTerms, course) {
  const c = (course || "").trim().toLowerCase(); if (!c) return "";
  for (const [k, v] of Object.entries(courseTerms || {})) if (k.toLowerCase() === c) return v;
  if (c.length < 3) return "";
  const hits = Object.entries(courseTerms || {}).filter(([k]) => k.length >= 3 && (k.toLowerCase().includes(c) || c.includes(k.toLowerCase()))).map(([, v]) => v);
  return [...new Set(hits.flatMap((h) => h.split(",").map((t) => t.trim()).filter(Boolean)))].join(", ");
}

if (typeof module !== "undefined") module.exports = { STUDY_MODES, buildPrompt, transcriptParts, contextRule, termsFor, tsFmt, wordsOf, WORDS_PER_PART, driveName };
