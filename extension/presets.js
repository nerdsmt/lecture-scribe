// OPTIONAL subject presets. These are suggestions only: nothing is applied unless you choose it, and everything can be
// edited afterwards. A preset gives (1) a short starter term list you can add as a course in the library
// ("Course terms" -> "Add from a subject preset") and (2) the study modes that usually suit the field.
// `context` says what a Study prompt may mention for that field when you set a country (law, professional standards,
// currency, units). Fields not listed here still work: type any field in Options and you get all study modes.
//
// To add a field, copy an entry below. Keep term lists short and generic (no country-specific statute numbers).
const SUBJECT_PRESETS = [
  { id: "accounting", label: "Accounting and Finance", aliases: ["accounting", "accountancy", "finance", "auditing", "taxation"],
    modes: ["calc", "mcq", "exam", "cards", "pastpaper", "summary"], context: { standards: true, currency: true },
    terms: "accruals, prepayments, depreciation, trial balance, bank reconciliation, ledger, journal, double entry, going concern, prudence, inventory valuation, FIFO, weighted average cost, break-even, variance analysis, NPV, IRR, WACC, working capital, materiality" },
  { id: "law", label: "Law", aliases: ["law", "legal studies", "jurisprudence"],
    modes: ["scenario", "exam", "cards", "explain", "mark", "summary"], context: { law: true },
    terms: "statute, case law, precedent, ratio decidendi, obiter dictum, tort, negligence, duty of care, contract, offer and acceptance, consideration, breach, damages, injunction, mens rea, actus reus, burden of proof, jurisdiction, liability, remedy" },
  { id: "medicine", label: "Medicine and Health", aliases: ["medicine", "nursing", "pharmacy", "health", "dentistry", "physiotherapy"],
    modes: ["mcq", "scenario", "cards", "explain", "summary", "exam"], context: { units: true },
    terms: "aetiology, pathophysiology, differential diagnosis, prognosis, contraindication, pharmacokinetics, pharmacodynamics, homeostasis, anamnesis, auscultation, palpation, prophylaxis, comorbidity, idiopathic, benign, malignant, acute, chronic" },
  { id: "engineering", label: "Engineering", aliases: ["engineering", "mechanical", "civil", "electrical", "chemical engineering"],
    modes: ["calc", "exam", "explain", "mcq", "cards", "summary"], context: { standards: true, units: true },
    terms: "stress, strain, torque, load, thermodynamics, entropy, Fourier transform, Laplace transform, differential equation, impedance, feedback loop, finite element, tolerance, safety factor, SI units, free body diagram" },
  { id: "cs", label: "Computer Science", aliases: ["computer science", "software", "informatics", "it", "data science"],
    modes: ["code", "explain", "mcq", "cards", "exam", "summary"], context: {},
    terms: "algorithm, time complexity, Big O, recursion, data structure, hash table, binary tree, graph traversal, dynamic programming, concurrency, mutex, API, database index, normalisation, compiler, heap, stack, queue" },
  { id: "languages", label: "Languages and Linguistics", aliases: ["languages", "linguistics", "english", "literature (languages)", "translation"],
    modes: ["vocab", "cards", "explain", "mark", "gaps", "summary"], context: {},
    terms: "conjugation, declension, subjunctive, syntax, morphology, phonetics, pragmatics, register, idiom, collocation, tense, aspect, mood, loanword, dialect" },
  { id: "economics", label: "Economics", aliases: ["economics", "econometrics"],
    modes: ["calc", "exam", "mcq", "explain", "cards", "summary"], context: { currency: true },
    terms: "elasticity, opportunity cost, marginal cost, marginal revenue, GDP, inflation, monetary policy, fiscal policy, equilibrium, monopoly, oligopoly, externality, comparative advantage, Nash equilibrium, deadweight loss" },
  { id: "biology", label: "Biology", aliases: ["biology", "biochemistry", "biomedical", "life sciences", "ecology"],
    modes: ["mcq", "cards", "explain", "exam", "summary", "scenario"], context: { units: true },
    terms: "mitosis, meiosis, DNA replication, transcription, translation, ATP, photosynthesis, natural selection, allele, genotype, phenotype, ecosystem, homeostasis, enzyme, membrane transport" },
  { id: "maths", label: "Mathematics and Statistics", aliases: ["mathematics", "maths", "math", "statistics", "physics"],
    modes: ["calc", "explain", "exam", "mark", "mcq", "summary"], context: {},
    terms: "theorem, lemma, proof by induction, eigenvalue, derivative, integral, limit, convergence, probability distribution, standard deviation, hypothesis test, p-value, confidence interval, regression" },
  { id: "business", label: "Business and Management", aliases: ["business", "management", "marketing", "hr", "entrepreneurship"],
    modes: ["scenario", "summary", "exam", "mcq", "cards", "explain"], context: { currency: true },
    terms: "SWOT, PESTLE, stakeholders, strategy, value chain, market segmentation, positioning, KPI, organisational structure, leadership, change management, supply chain, business model, competitive advantage" },
  { id: "humanities", label: "Humanities and Social Sciences", aliases: ["history", "philosophy", "psychology", "sociology", "politics", "literature", "humanities"],
    modes: ["summary", "explain", "exam", "cards", "mark", "gaps"], context: {},
    terms: "primary source, secondary source, historiography, epistemology, ethics, hermeneutics, discourse, ideology, methodology, qualitative, quantitative, case study, bias, theory, canon" },
];

// Match free-text "field of study" to a preset by label, id or alias (case-insensitive). Returns null if none matches.
function findPreset(field) {
  const f = (field || "").trim().toLowerCase();
  if (!f) return null;
  return SUBJECT_PRESETS.find((p) => p.label.toLowerCase() === f || p.id === f || p.aliases.includes(f)) ||
    SUBJECT_PRESETS.find((p) => p.label.toLowerCase().includes(f) || p.aliases.some((a) => a.length > 3 && (f.includes(a) || a.includes(f)))) || null;
}

if (typeof module !== "undefined") module.exports = { SUBJECT_PRESETS, findPreset };
