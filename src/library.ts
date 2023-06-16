import { Palette, type Item, type Row } from './palette'
import { rank } from './fuzzy'
import { el, keys } from './icons'

import type { Entry } from './bindings/Entry'
import type { Kind } from './bindings/Kind'
import type { Term } from './bindings/Term'
export type { Entry, Kind, Term }
export interface LibrarySource {
  list: (kind: Kind) => Promise<Entry[]>
  terms: () => Promise<Term[]>
  open: (kind: Kind, entry: Entry) => void
  openDictionary: () => void
  onClose: () => void
}

type Scope = 'all' | Kind | 'dictionary'
const scopes: Scope[] = ['all', 'templates', 'documents', 'dictionary']
const titles: Record<Scope, string> = { all: 'All', templates: 'Templates', documents: 'Prompts', dictionary: 'Dictionary' }
const letters: Record<string, Exclude<Scope, 'all'>> = { KeyT: 'templates', KeyP: 'documents', KeyD: 'dictionary' }
const letterOf: Record<string, string> = { templates: 'T', documents: 'P', dictionary: 'D' }
type Rows = Row[] | Error | undefined

export function age(time: number, now = Date.now()) {
  const minutes = Math.max(0, (now - time) / 60_000)
  const units: [number, string][] = [[60 * 24 * 365, 'y'], [60 * 24 * 30, 'mo'], [60 * 24 * 7, 'w'], [60 * 24, 'd'], [60, 'h'], [1, 'm']]
  for (const [size, unit] of units) if (minutes >= size) return Math.floor(minutes / size) + unit
  return 'now'
}

/** ⌘L: templates, saved prompts and the dictation dictionary in one searchable list. */
export class Library {
  private readonly palette: Palette
  private readonly pill: HTMLButtonElement
  private readonly source: LibrarySource
  private scope: Scope = 'all'
  /** The letter that peeked into a scope while the field was empty. */
  private peek = ''
  private data: Record<Exclude<Scope, 'all'>, Rows> = { templates: undefined, documents: undefined, dictionary: undefined }
  private numbered: Row[] = []
  /** A digit typed before its rows arrived; applied when they do. */
  private pending = 0
  private problem = ''
  private selectedRow: Row | undefined
  private generation = 0

  constructor(host: HTMLElement, source: LibrarySource) {
    this.source = source
    this.pill = el('button', 'scope')
    this.pill.type = 'button'
    this.pill.addEventListener('click', () => this.cycle(1))
    this.palette = new Palette(host, {
      label: 'Library', className: 'library', placeholder: 'Search library…', icon: 'search', accessory: this.pill,
      onQuery: () => { this.pending = 0; this.render() },
      onKey: event => this.key(event),
      onSelect: row => { this.selectedRow = row; this.footer() },
      onClose: () => source.onClose(),
    })
  }

  get isOpen() { return this.palette.isOpen }
  /** Errors while the Library covers the window are shown in its own message line. */
  showError(message: string) { this.problem = message; this.footer() }

  private footer() {
    const row = this.selectedRow
    const nodes: Node[] = this.problem ? [el('span', 'error', this.problem)] : []
    if (row) {
      const open = el('button', 'open', el('span', 'label', row.id.startsWith('d:') ? 'Open in editor' : 'Open'), keys('↵'))
      open.type = 'button'
      open.addEventListener('click', () => this.palette.run())
      nodes.push(open)
    }
    this.palette.footer.replaceChildren(...nodes)
  }
  focus() { this.palette.focus() }
  close() { this.palette.close() }

  open() {
    const generation = ++this.generation
    this.scope = 'all'
    this.peek = ''
    this.pending = 0
    this.problem = ''
    this.data = { templates: undefined, documents: undefined, dictionary: undefined }
    this.palette.open()
    const load = <T>(scope: Exclude<Scope, 'all'>, promise: Promise<T[]>, rows: (items: T[]) => Row[]) => promise.then(rows,
      error => error instanceof Error ? error : new Error(String(error)))
      .then(result => { if (generation === this.generation) { this.data[scope] = result; this.render(true) } })
    const entryRow = (kind: Kind, icon: string) => (entry: Entry): Row => ({
      id: kind + ':' + entry.name, name: entry.title || entry.name, icon,
      hint: kind === 'documents' && entry.updatedAt ? age(entry.updatedAt) : undefined,
      run: () => this.source.open(kind, entry),
    })
    void load('templates', this.source.list('templates'), entries => entries.map(entryRow('templates', 'template')))
    void load('documents', this.source.list('documents'), entries => [...entries]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(entryRow('documents', 'prompt')))
    void load('dictionary', this.source.terms(), terms => terms.map((term, i) => ({
      id: 'd:' + i, name: term.to, detail: term.from, icon: 'term', run: () => this.source.openDictionary(),
    })))
  }

  private cycle(step: number) {
    this.scope = scopes[(scopes.indexOf(this.scope) + step + scopes.length) % scopes.length]
    this.peek = ''
    this.pending = 0
    this.render()
    this.palette.focus()
  }

  private render(keepSelection = false) {
    const query = this.palette.query
    const empty = !query.trim()
    this.pill.replaceChildren(el('span', '', titles[this.scope]), keys('⇥'))
    this.pill.classList.toggle('active', this.scope !== 'all')
    this.pill.setAttribute('aria-label', 'Scope: ' + titles[this.scope] + '. Press Tab to change')
    const sections = this.scope === 'all' ? scopes.slice(1) as Exclude<Scope, 'all'>[] : [this.scope]
    const items: Item[] = []
    const errors: string[] = []
    this.numbered = []
    for (const scope of sections) {
      const data = this.data[scope]
      if (data instanceof Error) { errors.push(data.message); continue }
      const rows = rank(data ?? [], query).map(row => ({ ...row, key: undefined as string | undefined }))
      if (!rows.length) continue
      if (empty && scope !== 'dictionary' && (this.scope !== 'all' || scope === 'templates')) {
        this.numbered = rows.slice(0, 9)
        this.numbered.forEach((row, i) => { row.key = String(i + 1) })
      }
      if (this.scope === 'all') items.push({ header: titles[scope], key: empty && !this.peek ? letterOf[scope] : undefined })
      items.push(...rows)
    }
    const loaded = sections.every(scope => this.data[scope] !== undefined)
    if (items.length && errors.length) this.problem ||= errors[0]
    this.palette.render(items, errors[0] ?? (!empty ? 'Nothing found' : loaded ? 'Library is empty' : 'Loading…'), keepSelection)
    const ready = this.scope !== 'dictionary' && this.data[this.scope === 'all' ? 'templates' : this.scope] !== undefined
    if (this.pending && ready) {
      const pick = this.numbered[this.pending - 1]
      this.pending = 0
      pick?.run()
    }
  }

  private key(event: KeyboardEvent): boolean {
    if (event.key === 'Tab') {
      event.preventDefault()
      this.cycle(event.shiftKey ? -1 : 1)
      return true
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !this.palette.query
    if (!plain) { this.peek = ''; return false }
    const digit = event.shiftKey ? undefined : /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1]
    if (digit) {
      const pick = this.numbered[Number(digit) - 1]
      const scope = this.scope === 'all' ? 'templates' : this.scope
      const waiting = scope !== 'dictionary' && this.data[scope] === undefined
      if (pick || waiting || this.scope === 'dictionary') {
        // Fast ⌘L T 1 can beat the list: remember the digit. Dictionary rows have no numbers.
        event.preventDefault()
        this.pending = pick || !waiting ? 0 : Number(digit)
        pick?.run()
        return true
      }
    }
    this.pending = 0
    if (!this.peek && letters[event.code] && event.key.length === 1) {
      event.preventDefault()
      this.peek = event.key
      this.scope = letters[event.code]
      this.render()
      return true
    }
    if (this.peek && event.key.length === 1) {
      // The user was typing a word: return to All and keep both characters.
      event.preventDefault()
      const text = this.peek + event.key
      this.scope = 'all'
      this.peek = ''
      this.palette.query = text
      return true
    }
    this.peek = ''
    return false
  }
}
