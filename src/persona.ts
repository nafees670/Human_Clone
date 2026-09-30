// ─── Persona, consent, knowledge & safety rules (all hardcoded for the demo) ───

export const PERSONA = {
  name: 'Sir Ahmed',
  avatar: '👨‍🏫',
  profession: 'Physics Teacher · Govt. Boys High School, Lahore',
  bio: [
    '18 years teaching Matric & FSc Physics.',
    'Known for real-life examples — cricket, rickshaws, load-shedding.',
    'Speaks a warm mix of English and Roman Urdu ("Dekho beta…").',
  ],
  disclaimer: 'AI stand-in of Sir Ahmed — not the real person.',
  rules: 'General Physics help only. No grades, exam papers, or signatures.',
}

export const AGREEMENT = {
  id: 'HSI-2026-0142',
  signer: 'Ahmed Raza (Sir Ahmed)',
  signedOn: '12 September 2026',
  validUntil: '12 September 2027',
  scope: [
    'Answer general Physics questions for Matric / FSc students.',
    'Use my teaching style, tone and the notes I have provided.',
    'Always disclose that it is an AI, not me.',
  ],
  excluded: [
    'Anything about exam papers, marks, grades or attendance.',
    'Signing, approving or certifying anything on my behalf.',
    'Personal, medical, financial or disciplinary advice.',
  ],
  revocation: 'I can revoke this consent at any time by written notice; the stand-in is disabled within 24 hours.',
}

// ─── Mock RAG: keyword match over a tiny hardcoded knowledge base ───

export type Snippet = {
  id: string
  source: string
  text: string
  keywords: string[]
}

export const KNOWLEDGE: Snippet[] = [
  {
    id: 'newton',
    source: 'Class Notes · Ch 3 — Newton’s Laws',
    text: 'Second law: F = ma. Same force on a heavier object gives less acceleration. Think of pushing an empty trolley vs a loaded one at the sabzi mandi.',
    keywords: ['newton', 'force', 'mass', 'acceleration', 'inertia', 'push', 'f=ma', 'motion', 'trolley'],
  },
  {
    id: 'energy',
    source: 'Class Notes · Ch 6 — Work & Energy',
    text: 'Energy is never created or destroyed, only converted. A falling cricket ball turns potential energy (mgh) into kinetic energy (½mv²).',
    keywords: ['energy', 'work', 'kinetic', 'potential', 'conservation', 'power', 'joule', 'mgh', 'cricket'],
  },
  {
    id: 'ohm',
    source: 'Lab Manual · Exp 9 — Ohm’s Law',
    text: 'V = IR. Current through a conductor is proportional to voltage if temperature stays constant. More resistance means less current — like a narrow pipe for water.',
    keywords: ['ohm', 'current', 'voltage', 'resistance', 'circuit', 'electricity', 'electric', 'v=ir', 'bijli', 'wire', 'ampere', 'volt'],
  },
  {
    id: 'waves',
    source: 'Class Notes · Ch 10 — Waves & Sound',
    text: 'v = fλ. Sound needs a medium, so it cannot travel in space. It moves faster in solids than in air — put your ear on the desk and tap it.',
    keywords: ['wave', 'waves', 'sound', 'frequency', 'wavelength', 'echo', 'vibration', 'pitch', 'amplitude'],
  },
  {
    id: 'gravity',
    source: 'Revision Sheet · Gravitation',
    text: 'g ≈ 9.8 m/s² on Earth. Without air resistance a feather and a hammer fall together — mass does not change free-fall acceleration.',
    keywords: ['gravity', 'gravitation', 'fall', 'falling', 'weight', 'earth', 'moon', 'feather'],
  },
]

const tokenize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9=²\s]/g, ' ').split(/\s+/).filter(Boolean)

/** Crude plural/gerund stem so "forces" and "falling" still match their keyword. */
const stem = (w: string) => (w.length > 4 ? w.replace(/(ings|ing|ies|es|s)$/, '') : w)

const MIN_PREFIX = 4 // below this, prefix matching causes false positives ("mass" ~ "master")

/** 2 for an exact or stemmed keyword hit, 1 for a shared prefix ("volt" ~ "voltage"). */
function scoreKeyword(keyword: string, words: string[]): number {
  if (words.includes(keyword)) return 2
  if (words.includes(stem(keyword))) return 2
  if (keyword.length >= MIN_PREFIX) {
    for (const w of words) {
      if (w.length >= MIN_PREFIX && (w.startsWith(keyword) || keyword.startsWith(w))) return 1
    }
  }
  return 0
}

/** Returns up to `limit` snippets ranked by keyword overlap with the question. */
export function retrieve(question: string, limit = 2): Snippet[] {
  const words = tokenize(question)
  return KNOWLEDGE.map((s) => ({ s, score: s.keywords.reduce((n, k) => n + scoreKeyword(k, words), 0) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.s)
}

// ─── Risk check: one keyword pass before every answer ───

const BLOCK_PHRASES = [
  // exam paper leakage
  'paper leak', 'leak paper', 'leaked paper', 'leaking paper', 'paper out', 'exam paper', 'paper ki copy',
  'question paper', 'paper bhiqo', 'paper bata do', 'paper bhijwa', 'leak kardo', 'leak kar do',
  // marks / grades
  'give me marks', 'increase my marks', 'marks de', 'marks dedo', 'marks de do', 'marks bada', 'marks barha',
  'marks badha', 'number barha', 'number badha', 'number bada', 'pass kar do', 'pass kara do', 'pass karao',
  'pass karwa', 'bypass', 'change my result', 'result change',
  // signature / certification
  'sign my certificate', 'sign certificate', 'certificate sign', 'sign my', 'signature', 'dastakhat',
  'sign kar do', 'sign kardo', 'sign karwa', 'sign karwa do', 'ghazwat', 'sanad par sign',
  // attendance
  'fake attendance', 'attendance laga', 'attendance lagao', 'mark me present', 'present laga do',
  'present banao', 'absent ko present',
]

const CAUTION_WORDS = [
  'exam', 'test', 'marks', 'mark', 'grade', 'result', 'syllabus', 'assignment', 'deadline',
  'fees', 'fee', 'leave', 'chutti', 'attendance', 'board', 'practical', 'viva', 'paper',
  'percentage', 'merit', 'topper', 'rank', 'promotion', 'fail', 'subject', 'chapter',
  'schedule', 'timetable', 'teacher', 'discipline', 'punish', 'medical',
]

export type Risk = 'blocked' | 'caution' | 'ok'

/** Lowercase, strip zero-width/bidi marks, normalise Arabic letter variants. */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ی')

export function checkRisk(question: string): Risk {
  const q = normalize(question)
  if (BLOCK_PHRASES.some((p) => q.includes(p))) return 'blocked'
  const words = new Set(tokenize(q))
  if (CAUTION_WORDS.some((w) => words.has(w) || words.has(stem(w)))) return 'caution'
  return 'ok'
}

// ─── Prompting & canned fallback ───

export function buildSystemPrompt(snippets: Snippet[]) {
  const ctx = snippets.length
    ? snippets.map((s) => `- [${s.source}] ${s.text}`).join('\n')
    : '- (no matching notes — answer from general Physics knowledge)'
  return `You are an AI stand-in of ${PERSONA.name}, a ${PERSONA.profession}.
Persona: ${PERSONA.bio.join(' ')}
Style: warm, encouraging, simple. Mix English with a little Roman Urdu (e.g. "Dekho beta", "samjhe?"). Use one everyday Pakistani example. Keep answers under 120 words. Plain text, no markdown headings.
Rules: ${PERSONA.rules} If asked about anything outside Physics, politely steer back to Physics. Never claim to be the real ${PERSONA.name}. Never invent exam dates, marks or school policy — tell the student to confirm with ${PERSONA.name} in class.
Sir Ahmed's notes (prefer these facts):
${ctx}`
}

const GREETING = /\b(hi|hello|hey|salam|assalam|aoa|salaam)\b/i

export function cannedReply(question: string, snippets: Snippet[], risk: Risk): string {
  if (GREETING.test(question) && question.split(/\s+/).length <= 4) {
    return 'Wa alaikum assalam beta! 😊 Main Sir Ahmed ka AI stand-in hoon. Physics mein jo bhi confusion hai — Newton’s laws, energy, circuits, waves — poochho, mil ke samjhte hain.'
  }
  if (risk === 'caution' && !snippets.length) {
    return 'Dekho beta, exams, marks aur schedule ki exact details sirf Sir Ahmed class mein confirm kar sakte hain — main guess nahi karunga. Lekin preparation mein zaroor help karunga: batao kaunsa chapter tough lag raha hai?'
  }
  if (snippets.length) {
    const [top, second] = snippets
    return `Dekho beta, simple hai. ${top.text}${second ? ` Aur ek connection bhi yaad rakhna: ${second.text}` : ''} Samjhe? Agar koi numerical chahiye to batao, ek saath solve karte hain.`
  }
  return 'Achha sawal hai beta, lekin ye mere notes mein nahi hai. Main sirf general Physics mein help kar sakta hoon — Newton’s laws, energy, electricity, waves ya gravity ke baare mein kuch poochho?'
}
