// Canned "model" answers for the landing demo. In the app every instruction goes to a local model;
// here a few scripted edits and simple text rules stand in for it, so the demo works offline.

/** Exact answers for the sample prompt the guided tour types; keyed by rule id, then by input text. */
const scripted: Record<string, Record<string, string>> = {
  shorten: {
    'Add a dark mode toggle to the settings screen.': 'Add a dark mode toggle to Settings.',
    'Please make sure that it basically follows the system appearance by default and also remembers whatever the user picked last time.':
      'Follow the system appearance by default and remember the user’s last choice.',
  },
  grammar: {
    'Update the snapshot tests and dont touch the onboarding flow':
      'Update the snapshot tests, and don’t touch the onboarding flow.',
  },
  specific: {
    'Add a dark mode toggle to the settings screen.':
      'Add a “Dark mode” switch to the Appearance section of the Settings screen.',
  },
}

const typos: [RegExp, string][] = [
  [/\bdont\b/g, 'don’t'], [/\bdoesnt\b/g, 'doesn’t'], [/\bcant\b/g, 'can’t'], [/\bwont\b/g, 'won’t'],
  [/\bisnt\b/g, 'isn’t'], [/\barent\b/g, 'aren’t'], [/\bdidnt\b/g, 'didn’t'], [/\bim\b/g, 'I’m'],
  [/\bi\b/g, 'I'], [/\bteh\b/g, 'the'], [/\brecieve/g, 'receive'], [/\bseperate/g, 'separate'],
  [/\bdefinately\b/g, 'definitely'], [/\boccured\b/g, 'occurred'], [/\buntill\b/g, 'until'],
  [/\bwich\b/g, 'which'], [/\balot\b/g, 'a lot'], [/\bthier\b/g, 'their'], [/\bbeacuse\b/g, 'because'],
  [/\bfunciton/g, 'function'], [/\bteh\b/g, 'the'], [/\s+([,.;:!?])/g, '$1'], [/([,.;:!?])(?=[A-Za-z])/g, '$1 '],
]

const fillers: [RegExp, string][] = [
  [/\b(?:please|kindly)\s+/gi, ''], [/\bmake sure (?:that )?/gi, ''], [/\bI (?:would like|want|need) you to\s+/gi, ''],
  [/\b(?:could|can|would) you(?: please)?\s+/gi, ''], [/\b(?:basically|really|just|actually|very|simply|quite)\s+/gi, ''],
  [/\b(?:kind|sort) of\s+/gi, ''], [/\bI think\s+/gi, ''], [/\bin order to\b/gi, 'to'], [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'], [/\ba little bit\b/gi, 'slightly'], [/\balso\s+/gi, ''], [/\bwhatever\s+/gi, 'what '],
  [/\bit would be (?:great|nice) if\s+/gi, ''], [/\bas well\b/gi, ''],
]

const vague: [RegExp, string][] = [
  [/\bstuff\b/gi, 'code'], [/\bthings\b/gi, 'cases'], [/\bsomehow\s+/gi, ''], [/,?\s*etc\.?/gi, ''],
  [/\bthe tests\b/gi, 'the unit and snapshot tests'], [/\bfast\b/gi, 'within 200 ms'], [/\bsoon\b/gi, 'in this change'],
  [/\bnicer?\b/gi, 'consistent with the existing design'], [/\bsome\b/gi, 'the relevant'],
]

const replaceAll = (text: string, pairs: [RegExp, string][]) => pairs.reduce((t, [from, to]) => t.replace(from, to), text)
/** Upper-cases the first letter of each sentence and line; keeps Markdown markers. */
const capitalize = (text: string) => text.replace(/(^|[.!?]\s+|\n[-*#>\s]*)(\p{Ll})/gu, (_, lead, letter) => lead + letter.toUpperCase())
const tidy = (text: string) => capitalize(text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/^[ \t]+|[ \t]+$/gm, ''))
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
const period = (s: string) => /[.!?:]$/.test(s) ? s : s + '.'

function shorten(text: string) {
  const short = tidy(replaceAll(text, fillers))
  if (short !== text.trim()) return short
  // Nothing to cut: drop articles and the weakest words, as a terse rewrite would.
  return tidy(text.replace(/(?<=\S\s)(?:the|a|an|that|which is|in order)\s+/gi, '').replace(/\s+(?:screen|section|part)\b/gi, ''))
}
function grammar(text: string) { return text.split('\n').map(line => line.trim() && !/^[#\-*>]/.test(line.trim()) ? period(tidy(replaceAll(line, typos))) : replaceAll(line, typos)).join('\n') }
function specific(text: string) { return tidy(replaceAll(text, vague)) }
function clarify(text: string) {
  return tidy(replaceAll(text, fillers).replace(/,? and (?=(?:also )?(?:remember|keep|update|add|make|use|don’t|do not|never)\b)/gi, '. '))
}
function structure(text: string) {
  const all = sentences(shorten(text)).map(period)
  if (all.length < 2) return text
  const constraint = (s: string) => /\b(?:don’t|don't|do not|never|keep|without|only|avoid)\b/i.test(s)
  const [goal, ...rest] = all
  const requirements = rest.filter(s => !constraint(s)), constraints = rest.filter(constraint)
  return ['## Goal', goal, ...(requirements.length ? ['', '## Requirements', ...requirements.map(s => '- ' + s)] : []),
    ...(constraints.length ? ['', '## Constraints', ...constraints.map(s => '- ' + s)] : [])].join('\n')
}
function bullets(text: string) { const all = sentences(text).map(period); return all.length < 2 ? text : all.map(s => '- ' + s).join('\n') }
function polite(text: string) { return sentences(text).map(s => /^(?:please|could)/i.test(s) ? s : 'Please ' + s[0].toLowerCase() + s.slice(1)).join(' ') }
function pirate(text: string) {
  return 'Arr! ' + replaceAll(text, [[/\byou\b/gi, 'ye'], [/\bmy\b/gi, 'me'], [/\bis\b/g, 'be'], [/\bthe\b/g, 'th’'], [/\bhello\b/gi, 'ahoy'], [/!?$/, ', matey!']])
}

const byRule: Record<string, (text: string) => string> = { shorten, grammar, specific, clarify, structure }

/** Free-form instructions the demo understands, in either language the shipped aliases use. */
const freeform: [RegExp, (text: string) => string][] = [
  [/pirate|пират/i, pirate],
  [/bullet|list|checklist|steps|пункт|списк/i, bullets],
  [/structur|organi[sz]|section|раздел|структур/i, structure],
  [/short|concise|brief|tight|trim|cut|короч|сократ/i, shorten],
  [/grammar|spell|typo|punctuat|грамм|ошибк|орфогр/i, grammar],
  [/specific|concrete|precise|конкрет/i, specific],
  [/polite|friendly|soft|kind|вежлив/i, polite],
  [/upper ?case|caps|shout/i, text => text.toUpperCase()],
  [/lower ?case/i, text => text.toLowerCase()],
  [/clear|clarif|simpl|plain|readab|ясн|понятн/i, clarify],
]

/** The reply for `instruction` applied to `text`, and whether it came from a known rule or instruction. */
export function answer(instruction: string, text: string, rules: { id: string; instruction?: string }[]): { reply: string; known: boolean } {
  const trimmed = text.trim()
  const rule = rules.find(r => r.instruction === instruction)
  if (rule) {
    const reply = scripted[rule.id]?.[trimmed] ?? byRule[rule.id]?.(trimmed) ?? clarify(trimmed)
    return { reply, known: true }
  }
  const match = freeform.find(([pattern]) => pattern.test(instruction))
  return { reply: (match ? match[1] : clarify)(trimmed), known: !!match }
}
