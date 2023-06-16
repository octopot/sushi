// Library (library-path.txt) and, below it, the dictionary (dictionary.json) as a lookup table.
import { fold } from '../../fuzzy'
import type { LibraryPane } from '../../bindings/LibraryPane'
import type { Term } from '../../bindings/Term'
import { call } from '../../ipc'
import { FileBar, fileNotice } from '../filebar'
import { icon } from '../icons'
import type { Context, Pane } from '../pane'
import type { Slot } from '../store'
import { afterFocus, banner, button, card, composing, drawing, fieldError, group, h, offerUndo, settle } from '../ui'

interface TermDraft {
  key: number
  from: string
  to: string
  /** The term in the file this row started from; null for a new one. */
  origin: Term | null
  /** When the row was last edited, to know which of two rows with the same source came second. */
  edited: number
  tried: boolean
}
let keys = 0
let edits = 0
const SCOPE = 'dictionary'
const sourceOf = (term: string) => term.trim().toLowerCase()
const sameTerm = (a: Term, b: Term) => a.from === b.from && a.to === b.to
const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

export class LibrarySettings implements Pane {
  readonly id = 'library'
  readonly title = 'Library'
  readonly root = h('div', { class: 'pane-body' })
  private readonly folderBar: FileBar<LibraryPane>
  private readonly termsBar: FileBar<LibraryPane>
  private choosing = false
  private folderKind: 'choose' | 'default' = 'choose'
  private folderError: string | null = null
  private work: TermDraft[] = []
  private filter = ''
  private termsError: string | null = null

  constructor(private readonly folder: Slot<LibraryPane>, private readonly terms: Slot<LibraryPane>, private readonly ctx: Context) {
    folder.host = {
      file: pane => pane.file,
      hasDraft: () => false,
      dropDraft: () => { this.choosing = false; this.folderError = null },
      render: () => this.render(),
    }
    terms.host = {
      file: pane => pane.dictionary.file,
      hasDraft: () => this.dirty(),
      blocked: () => this.work.some(d => d.tried && this.changedRow(d) && !this.valid(d)) || (this.termsError !== null && this.dirty()),
      dropDraft: () => { this.work = []; this.termsError = null },
      rebase: () => this.rebuild(),
      render: () => this.render(),
    }
    this.folderBar = new FileBar(folder, 'library')
    this.termsBar = new FileBar(terms, 'dictionary')
    this.rebuild()
  }

  pending() { return this.dirty() }

  // ——— The folder ———

  private folderOp(kind: 'choose' | 'default') {
    this.folderError = null
    this.folderKind = kind
    const fail = (text: string) => { this.folderError = text }
    this.folder.save({
      send: revision => {
        // Set again when Choose again… sends it once more after a conflict.
        this.choosing = kind === 'choose'
        this.render()
        return kind === 'choose' ? call('prefs_library_choose', { revision }) : call('prefs_library_default', { revision })
      },
      // Whatever the reply, `changed` included, the picker is closed now.
      settled: () => { this.choosing = false },
      invalid: fail, failed: fail,
    })
    this.render()
  }

  private folderGroup(): HTMLElement {
    const pane = this.folder.pane
    const env = pane.source === 'environment'
    const writable = pane.file.writable && !env && !this.folder.conflict
    const notice = fileNotice(this.folder, {
      subject: 'The library folder setting', resave: () => {}, reset: prefs => this.ctx.applyReset(prefs, 'library-path.txt'),
      // What the Library does now, as Rust reports it: with a broken path file it opens no folder at all.
      meanwhile: pane.prompts === null ? 'The Library cannot open until the path is fixed.' : `The Library reads ${pane.path} meanwhile.`,
      // The folder picker keeps no choice: after a conflict, the second way out opens it again.
      replace: this.folderKind === 'choose' ? {
        label: 'Choose again…',
        text: 'library-path.txt changed while the folder picker was open, so your choice was not saved. Use the file’s version, or choose the folder again.',
      } : undefined,
    })
    const source = { default: 'Default folder', file: 'Custom folder', environment: 'Set outside Settings' }[pane.source]
    // Rust counts a missing .templates as 0; null means it could not be read, which is said as such.
    const pathBroken = pane.file.status === 'invalid' || pane.file.status === 'unreadable'
    const counts = pane.prompts === null
      ? h('span', { class: 'warning-text', text: pathBroken && pane.source === 'file' ? 'Not available until library-path.txt is fixed.' : 'Unavailable: Sushi cannot read this folder.' })
      : h('span', { text: `${pane.prompts} ${pane.prompts === 1 ? 'prompt' : 'prompts'} · ${pane.templates === null ? 'templates unavailable' : `${pane.templates} ${pane.templates === 1 ? 'template' : 'templates'}`}` })
    const choose = button({ label: this.choosing ? 'Choosing…' : 'Choose folder…', id: 'library-choose', busy: this.choosing, disabled: !writable || this.folder.busy, onClick: () => this.folderOp('choose') })
    const reset = button({ label: 'Use default folder', kind: 'quiet', id: 'library-default', disabled: !writable || pane.source !== 'file' || this.folder.busy, onClick: () => this.folderOp('default') })
    if (pane.source === 'default') reset.title = 'The Library already reads the default folder.'
    if (env) reset.title = choose.title = 'SUSHI_LIBRARY_DIR decides the folder.'
    return group('Folder',
      notice,
      env ? banner({ tone: 'note', title: 'Library folder set outside Settings', detail: 'Sushi was started with SUSHI_LIBRARY_DIR. Remove it and restart Sushi to choose a folder here.' }) : null,
      card(
        h('div', { class: 'row folder' },
          icon('folder'),
          h('div', { class: 'row-text' },
            h('div', { class: 'folder-name', text: basename(pane.path) }),
            h('div', { class: 'row-detail' }, h('span', { text: source + ' · ' }), counts)),
          h('div', { class: 'row-control' },
            button({ label: 'Show library in Finder', id: 'library-show', disabled: pane.prompts === null,
              onClick: () => call('prefs_action', { action: 'library', provider: null }).catch(e => this.ctx.error(e)) }))),
        h('div', { class: 'path-line' }, h('code', { class: 'path', title: pane.path, text: pane.path })),
        env ? null : h('div', { class: 'card-actions' },
          h('span', { class: 'card-note', text: 'Choose the folder Sushi reads. Existing files stay where they are.' }),
          reset, choose),
        this.folderError ? h('div', { class: 'row-message' }, fieldError(this.folderError, 'library-error')) : null),
      this.folderBar.root)
  }

  // ——— The dictionary ———

  private get committed(): Term[] { return this.terms.pane.dictionary.terms }

  private changedRow(d: TermDraft) { return !d.origin || !sameTerm(d.origin, { from: d.from.trim(), to: d.to.trim() }) }
  private dirty(): boolean {
    if (this.work.some(d => this.changedRow(d))) return true
    const committed = this.committed
    return this.work.length !== committed.length || this.work.some((d, i) => !sameTerm(d.origin!, committed[i]))
  }

  /** The rows as the file has them, keeping each row's key. */
  private rebuild() {
    const old = new Map(this.work.map(d => [d.origin ? sourceOf(d.origin.from) : '', d.key]))
    this.work = this.committed.map(term => ({ key: old.get(sourceOf(term.from)) ?? ++keys, from: term.from, to: term.to, origin: term, edited: 0, tried: false }))
  }

  private sync() {
    if (this.terms.busy || this.terms.conflict || (this.work.length && this.dirty())) return
    this.rebuild()
  }

  private blank(d: TermDraft) { return !d.from.trim() || !d.to.trim() }

  /**
   * What a save would write, row by row: a row's own term when it can be saved, otherwise what the file
   * has for it (or nothing for a new row). Uniqueness is checked on exactly that list: an edit whose
   * source another written term already has is refused at its field, and nothing is ever filtered out.
   * The file's own terms come first; of two edits, the earlier one keeps the source.
   */
  private plan(): { terms: Term[]; rows: [TermDraft, Term][]; refused: Set<TermDraft>; clash: boolean } {
    const refused = new Set<TermDraft>()
    const own = (d: TermDraft) => !this.blank(d) && !refused.has(d) && this.changedRow(d)
    const termOf = (d: TermDraft): Term | null => own(d) ? { from: d.from.trim(), to: d.to.trim() } : d.origin
    for (let round = 0; round <= this.work.length; round++) {
      const groups = new Map<string, TermDraft[]>()
      for (const d of this.work) {
        const term = termOf(d)
        if (term) groups.set(sourceOf(term.from), [...groups.get(sourceOf(term.from)) ?? [], d])
      }
      let more = false
      for (const rows of groups.values()) {
        if (rows.length < 2) continue
        const edits = rows.filter(own).sort((a, b) => a.edited - b.edited)
        // With a term of the file in the group every edit gives way; among edits only, the first one stays.
        const keep = edits.length === rows.length ? 1 : 0
        for (const d of edits.slice(keep)) { refused.add(d); more = true }
      }
      if (!more) break
    }
    const rows = this.work.map(d => [d, termOf(d)] as [TermDraft, Term | null]).filter((r): r is [TermDraft, Term] => r[1] !== null)
    const terms = rows.map(([, term]) => term)
    const clash = new Set(terms.map(t => sourceOf(t.from))).size !== terms.length
    return { terms, rows, refused, clash }
  }

  private reasons(d: TermDraft, plan = this.plan()): Partial<Record<'from' | 'to', string>> {
    const out: Partial<Record<'from' | 'to', string>> = {}
    if (!d.from.trim()) out.from = 'Type what dictation writes.'
    else if (plan.refused.has(d)) out.from = `“${d.from.trim()}” is already in the dictionary.`
    if (!d.to.trim()) out.to = 'Type how it should be written.'
    return out
  }
  private valid(d: TermDraft) { return Object.keys(this.reasons(d)).length === 0 }

  /** Exactly the planned list: valid rows as they are now, the others as the file has them. */
  private payload(): Term[] { return this.plan().terms }

  private saveTerms() {
    this.termsError = null
    let sent: [TermDraft, Term][] = []
    this.terms.save({
      key: 'terms',
      send: revision => {
        sent = this.plan().rows
        return call('prefs_dictionary_save', { revision, terms: sent.map(([, term]) => term) })
      },
      // What this request wrote becomes each row's original, whatever the row looks like now: a row cleared
      // while the reply was on its way still stands for the term the file holds.
      saved: () => { for (const [d, term] of sent) d.origin = term },
      matches: pane => JSON.stringify(pane.dictionary.terms) === JSON.stringify(sent.map(([, term]) => term)),
      invalid: text => { this.termsError = text },
      failed: text => { this.termsError = text },
    })
  }

  private commit(d: TermDraft) {
    d.tried = true
    if (!this.valid(d) || !this.dirty() || this.plan().clash) {
      this.render()
      document.getElementById(`term-error-${d.key}`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    settle(SCOPE)
    this.saveTerms()
    this.render()
  }

  private add() {
    settle(SCOPE)
    const d: TermDraft = { key: ++keys, from: '', to: '', origin: null, edited: ++edits, tried: false }
    this.work.push(d)
    this.filter = ''
    this.render()
    this.terms.changed()
    const input = document.getElementById(`term-from-${d.key}`)
    input?.focus()
    input?.scrollIntoView({ block: 'nearest' })
  }

  private remove(d: TermDraft) {
    const at = this.work.indexOf(d)
    this.work.splice(at, 1)
    // A new term may be in a save still in flight: the list without it goes after it.
    if (d.origin || this.terms.busy) this.saveTerms()
    this.render()
    this.terms.changed()
    const next = this.work[at] ?? this.work[at - 1]
    document.getElementById(next ? `term-from-${next.key}` : 'terms-add')?.focus()
    offerUndo(`Deleted ${d.from.trim() ? `“${d.from.trim()}”` : 'the new term'}`, SCOPE, () => {
      this.work.splice(Math.min(at, this.work.length), 0, d)
      if (d.origin || this.valid(d)) this.saveTerms()
      this.render()
      this.terms.changed()
      document.getElementById(`term-from-${d.key}`)?.focus()
    })
  }

  private shown(d: TermDraft) {
    const q = fold(this.filter)
    return !q || !d.origin || fold(d.from + ' ' + d.to).includes(q)
  }

  private termsGroup(): HTMLElement {
    const pane = this.terms.pane.dictionary
    const writable = pane.file.writable && !this.terms.conflict
    const broken = pane.file.status === 'invalid' || pane.file.status === 'unreadable'
    const notice = fileNotice(this.terms, {
      subject: 'The dictionary', resave: () => this.saveTerms(), reset: prefs => this.ctx.applyReset(prefs, 'dictionary.json'),
      difference: () => {
        const fresh = this.terms.conflict?.fresh.dictionary.terms.length
        const mine = this.payload().length
        return fresh === undefined || fresh === mine ? null : `The file has ${fresh} terms; yours has ${mine}.`
      },
    })
    const filter = h('input', { type: 'search', class: 'text small filter', id: 'terms-filter', 'aria-label': 'Filter terms', placeholder: 'Filter terms', autocomplete: 'off' })
    filter.value = this.filter
    filter.addEventListener('input', () => { this.filter = filter.value; this.render() })
    const add = button({ label: 'Add term', icon: 'plus', id: 'terms-add', disabled: !writable || broken, onClick: () => this.add() })
    const visible = this.work.filter(d => this.shown(d))
    const body = h('div', { role: 'rowgroup' }, ...visible.map(d => this.termRow(d, writable)))
    const table = card(
      h('div', { role: 'rowgroup' }, h('div', { class: 'term-head', role: 'row' },
        h('span', { role: 'columnheader', text: 'Heard as' }), h('span', { 'aria-hidden': 'true' }),
        h('span', { role: 'columnheader', text: 'Written as' }), h('span', { role: 'columnheader' }, h('span', { class: 'visually-hidden', text: 'Delete' })))),
      body,
      !this.work.length ? h('div', { class: 'empty' },
        h('div', { class: 'empty-title', text: 'No terms yet' }),
        h('div', { text: 'Add the words dictation gets wrong, such as “mac whisper” written as MacWhisper.' }))
      : !visible.length ? h('div', { class: 'empty' },
        h('div', { class: 'empty-title', text: 'No matching terms' }),
        button({ label: 'Clear filter', id: 'terms-clear', onClick: () => { this.filter = ''; this.render(); document.getElementById('terms-filter')?.focus() } }))
      : null)
    table.classList.add('terms')
    table.setAttribute('role', 'table')
    table.setAttribute('aria-label', 'Dictionary terms')
    return group('Dictionary',
      notice,
      h('p', { class: 'lead', text: 'Look up these spellings in the Library (⌘L). Sushi does not replace text with them.' }),
      broken ? null : h('div', { class: 'toolbar' }, filter, h('span', { class: 'spacer' }), add),
      broken ? null : table,
      this.termsError ? fieldError(this.termsError, 'terms-error') : null,
      this.termsBar.root)
  }

  private termRow(d: TermDraft, writable: boolean): HTMLElement {
    const why = this.reasons(d)
    // An error shows once the row was committed, or at once for a duplicate the user just typed.
    const shown = (field: 'from' | 'to') => d.tried || (field === 'from' && why.from && d.from.trim() && this.changedRow(d)) ? why[field] : undefined
    const cell = (field: 'from' | 'to', label: string, placeholder: string) => {
      const error = shown(field)
      const input = h('input', {
        type: 'text', class: 'cell' + (error ? ' invalid' : ''), id: `term-${field}-${d.key}`, 'aria-label': label, placeholder, autocomplete: 'off', spellcheck: 'false',
        'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `term-error-${d.key}-${field}` : undefined,
      })
      input.value = d[field]
      input.disabled = !writable
      input.addEventListener('input', () => {
        d[field] = input.value
        d.edited = ++edits
        this.terms.changed()
      })
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !composing(event)) { event.preventDefault(); this.commit(d) } })
      return h('div', { role: 'cell', class: 'term-cell' }, input, error ? fieldError(error, `term-error-${d.key}-${field}`) : null)
    }
    const remove = button({ label: 'Delete', kind: 'icon', icon: 'trash', id: `term-delete-${d.key}`, aria: `Delete the term ${d.from.trim() || 'new term'}`, disabled: !writable, onClick: () => this.remove(d) })
    const node = h('div', { class: 'term' + (this.changedRow(d) && !this.terms.busy && d.tried && !this.valid(d) ? ' unsaved' : ''), role: 'row', 'data-key': String(d.key) },
      cell('from', 'Heard as', 'mac whisper'), h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), cell('to', 'Written as', 'MacWhisper'),
      h('div', { role: 'cell' }, remove))
    if (shown('from') || shown('to')) node.id = `term-error-${d.key}`
    node.addEventListener('focusout', event => {
      // A redraw removes the row with the focus in it: that is not the user leaving it.
      if (drawing() || node.contains(event.relatedTarget as Node | null)) return
      afterFocus(() => { if (this.work.includes(d) && (this.changedRow(d) || !d.origin)) this.commit(d) })
    })
    return node
  }

  render() {
    this.sync()
    this.root.replaceChildren(this.folderGroup(), this.termsGroup())
    this.folderBar.update()
    this.termsBar.update()
  }
}
