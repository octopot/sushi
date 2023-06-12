/** Case- and diacritic-insensitive form used for matching. */
export const fold = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()

/** A spoken phrase reduced to its words: «Сделай короче.» ⇒ «сделай короче». */
export const phrase = (s: string) => fold(s.replace(/[^\p{L}\p{N}\s]/gu, ' '))

const wordStart = (text: string, at: number) => at === 0 || /[\s\p{P}]/u.test(text[at - 1])

/** exact > prefix > word-prefix > substring > in-order subsequence; -Infinity means no match. */
export function score(query: string, value: string, subsequence = true): number {
  const q = fold(query), text = fold(value)
  if (!q) return 0
  if (text === q) return 1000
  if (text.startsWith(q)) return 800 - Math.min(text.length, 100) / 10
  let at = text.indexOf(q), best = -Infinity
  while (at !== -1) {
    best = Math.max(best, (wordStart(text, at) ? 600 : 400) - Math.min(at, 100) / 10)
    at = text.indexOf(q, at + 1)
  }
  // Loose in-order matching only for 3+ letters, and only when compact or anchored at a word start.
  if (best > -Infinity || !subsequence || [...q].length < 3) return best
  let from = 0, first = -1, previous = -2, points = 0
  for (const letter of q) {
    const found = text.indexOf(letter, from)
    if (found === -1) return -Infinity
    if (first < 0) first = found
    points += (wordStart(text, found) ? 8 : 0) + (found === previous + 1 ? 5 : 0) - Math.min(found - from, 10)
    previous = found
    from = found + 1
  }
  if (previous - first + 1 > 2 * q.length && !wordStart(text, first)) return -Infinity
  return 100 + Math.max(-90, Math.min(points, 90))
}

export interface Searchable { name: string; aliases?: string[]; detail?: string }

export function match(item: Searchable, query: string): number {
  return Math.max(
    score(query, item.name),
    ...(item.aliases ?? []).map(alias => score(query, alias) - 25),
    item.detail ? score(query, item.detail, false) - 50 : -Infinity,
  )
}

/**
 * Whether a free-form instruction should come before the matching items: nothing matches strongly
 * (exact, prefix, word prefix or substring of a name or alias) and the query is a sentence (3+ words)
 * or matches nothing at all. A short loose query such as `shrtn` still puts the items first.
 */
export function instructionFirst(items: Searchable[], query: string): boolean {
  const best = Math.max(-Infinity, ...items.map(item => match(item, query)))
  return best < 300 && (fold(query).split(' ').length >= 3 || best === -Infinity)
}

/** Items that match the query, best first; ties keep the original order. */
export function rank<T extends Searchable>(items: T[], query: string): T[] {
  if (!fold(query)) return items
  return items.map((item, i) => ({ item, i, s: match(item, query) }))
    .filter(r => r.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(r => r.item)
}
