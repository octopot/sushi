// Actions (rules.json): the ⌘K list in its order, an editor in place, phrases as chips, delete with Undo.
// The page keeps a working copy; a valid record saves on its commit boundary, an invalid one stays a
// draft marked Not saved while the file keeps its last valid version.
import { phrase } from '../../fuzzy'
import type { ActionsPane } from '../../bindings/ActionsPane'
import type { Rule } from '../../bindings/Rule'
import { call } from '../../ipc'
import { FileBar, fileNotice } from '../filebar'
import { icon } from '../icons'
import type { Context, Pane } from '../pane'
import type { Slot } from '../store'
import { afterFocus, button, card, chevron, composing, fieldError, group, h, offerUndo, segmented, settle } from '../ui'
import { marks, wsField } from '../whitespace'

type Kind = 'instruction' | 'prefix'
interface Draft {
  key: number
  /** Made from the name when a new action is first committed; never changed afterwards. */
  id: string | null
  name: string
  kind: Kind
  /** Both texts are kept until a change of kind commits. */
  instruction: string
  prefix: string
  aliases: string[]
  /** A phrase typed into the chips field and not added yet: part of the draft, kept through redraws. */
  typing: string
  /** The last value of this action in the file, kept by a delete so that Undo can write it back while the draft stays a draft. */
  saved?: Rule
  /** Done was pressed, the editor was closed, or a field of an existing action was committed: reasons show as errors. */
  tried: boolean
}

const SAMPLE = 'Summarize the release notes.'
const SCOPE = 'actions'
const REORDER = 'Drag to reorder, or press ⌥↑ / ⌥↓ on a row.'
let keys = 0

export function slug(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
/** A new id from the name, unique among `taken`; a name with no Latin letters or digits gives `action`. */
export function makeId(name: string, taken: Set<string>): string {
  const base = slug(name) || 'action'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

const fromRule = (rule: Rule, key = ++keys): Draft => ({
  key, id: rule.id, name: rule.name, kind: rule.prefix !== undefined ? 'prefix' : 'instruction',
  instruction: rule.instruction ?? '', prefix: rule.prefix ?? '', aliases: [...rule.aliases], typing: '', tried: false,
})
const text = (d: Draft) => d.kind === 'instruction' ? d.instruction : d.prefix
const toRule = (d: Draft, id: string): Rule => d.kind === 'instruction'
  ? { id, name: d.name.trim(), instruction: d.instruction, aliases: d.aliases }
  : { id, name: d.name.trim(), prefix: d.prefix, aliases: d.aliases }
const same = (a: Rule, b: Rule) => JSON.stringify([a.id, a.name, a.instruction, a.prefix, a.aliases]) === JSON.stringify([b.id, b.name, b.instruction, b.prefix, b.aliases])
const label = (d: Draft) => d.name.trim() || (d.id === null ? 'New action' : 'Untitled')

type Reason = 'name' | 'text'
/** Why a record cannot be saved yet, by field; empty when it can. */
function reasons(d: Draft): Partial<Record<Reason, string>> {
  const out: Partial<Record<Reason, string>> = {}
  if (!d.name.trim()) out.name = 'Give the action a name.'
  if (!text(d).trim()) out.text = d.kind === 'instruction' ? 'Write what the model should do.' : 'Write the text to insert.'
  return out
}
const valid = (d: Draft) => Object.keys(reasons(d)).length === 0

export class ActionsSettings implements Pane {
  readonly id = 'actions'
  readonly title = 'Actions'
  readonly root = h('div', { class: 'pane-body' })
  private readonly bar: FileBar<ActionsPane>
  private work: Draft[] = []
  private open: number | null = null
  /** File details opened, per action. */
  private readonly details = new Set<number>()
  /** The last chip chosen by Backspace in an empty phrase field: the next Backspace removes it. */
  private chosenChip: number | null = null
  /** The validator's or the write's message for the last save, shown in the open editor. */
  private saveError: string | null = null
  /** Undo records of deleted actions, by id: their saved version follows saves that succeed after the delete. */
  private readonly undoRecords = new Map<string, { saved: Rule | undefined }>()

  constructor(private readonly slot: Slot<ActionsPane>, private readonly ctx: Context) {
    slot.host = {
      file: pane => pane.file,
      hasDraft: () => this.dirty(),
      // A half-typed phrase whose action the fresh file removes or changes would be lost: that is a conflict.
      loses: fresh => this.work.some(d => {
        if (!d.typing.trim() || d.id === null) return false
        const now = fresh.rules.find(r => r.id === d.id), before = this.committed.get(d.id)
        return !now || !before || !same(now, before)
      }),
      // Not saved: an action that cannot be saved as it is, or a valid change whose write failed.
      blocked: () => this.work.some(d => d.tried && !valid(d) && this.changedRecord(d)) || (this.saveError !== null && this.dirty()),
      dropDraft: () => { this.work = []; this.saveError = null },
      rebase: () => this.rebuild(),
      render: () => this.render(),
    }
    this.bar = new FileBar(slot, 'actions')
    this.rebuild()
  }

  pending() { return this.dirty() || this.work.some(d => d.typing.trim() !== '') }

  private get committed() { return new Map(this.slot.pane.rules.map(rule => [rule.id, rule])) }

  private changedRecord(d: Draft, committed = this.committed): boolean {
    if (d.id === null || !committed.has(d.id)) return true
    return !same(toRule(d, d.id), committed.get(d.id)!)
  }

  /** Something in the list differs from the file: a record, the order or the count. */
  private dirty(): boolean {
    const committed = this.committed
    if (this.work.some(d => this.changedRecord(d, committed))) return true
    return this.work.map(d => d.id).join('\n') !== this.slot.pane.rules.map(r => r.id).join('\n')
  }

  /** The list as the file has it, keeping each action's key, open editor and half-typed phrase. */
  private rebuild() {
    const old = new Map(this.work.map(d => [d.id, d]))
    this.work = this.slot.pane.rules.map(rule => {
      const before = old.get(rule.id)
      const d = fromRule(rule, before?.key)
      if (before) d.typing = before.typing
      return d
    })
    if (this.open !== null && !this.work.some(d => d.key === this.open)) this.open = null
  }

  /** A clean list follows the file (after its own save, for one). */
  private sync() {
    if (this.slot.busy || this.slot.conflict || (this.work.length && this.dirty())) return
    this.rebuild()
  }

  /** What goes to the file: valid records as they are now, invalid ones as the file has them. */
  private payload(): Rule[] {
    const committed = this.committed
    const out: Rule[] = []
    for (const d of this.work) {
      if (valid(d) && d.id) out.push(toRule(d, d.id))
      else if (d.id && committed.has(d.id)) out.push(committed.get(d.id)!)
      else if (d.id && d.saved) out.push(d.saved)
    }
    return out
  }

  private taken(except?: Draft) {
    return new Set([...this.work.filter(d => d !== except).map(d => d.id), ...this.slot.pane.rules.map(r => r.id)].filter((id): id is string => !!id))
  }

  private saveAll() {
    this.saveError = null
    let sent: Rule[] = []
    this.slot.save({
      key: 'rules',
      send: revision => {
        sent = this.payload()
        return call('prefs_actions_save', { revision, rules: sent })
      },
      // A reply describes what this save wrote; anything else is a change from outside, not ours to adopt.
      matches: pane => pane.rules.length === sent.length && pane.rules.every((rule, i) => same(rule, sent[i])),
      saved: () => {
        // A save that wrote a since-deleted action is that action's last saved version now.
        for (const rule of sent) { const record = this.undoRecords.get(rule.id); if (record) record.saved = rule }
        // The other kind's text goes once the kind that was sent is in the file, judged by the request,
        // not by the draft as it is when the reply arrives.
        const kinds = new Map(sent.map(r => [r.id, r.prefix !== undefined ? 'prefix' : 'instruction']))
        for (const d of this.work) if (d.id && kinds.get(d.id) === d.kind) { if (d.kind === 'instruction') d.prefix = ''; else d.instruction = '' }
      },
      invalid: message => { this.saveError = message },
      failed: message => { this.saveError = message },
    })
  }

  /** A commit boundary of one record: saves when it is valid, leaves it a draft when it is not. */
  private commit(d: Draft) {
    if (d.id !== null) d.tried = true
    if (!valid(d)) return this.render()
    if (!this.dirty()) return this.render()
    if (d.id === null) d.id = makeId(d.name, this.taken(d))
    this.saveAll()
    this.render()
  }

  private find(key: number) { return this.work.find(d => d.key === key) }

  // ——— List operations ———

  private add() {
    settle(SCOPE)
    const d: Draft = { key: ++keys, id: null, name: '', kind: 'instruction', instruction: '', prefix: '', aliases: [], typing: '', tried: false }
    this.work.push(d)
    this.open = d.key
    this.render()
    this.focus(`action-name-${d.key}`)
    this.reveal(d)
  }

  /** Scrolls the open editor into view, as much of it as fits. */
  private reveal(d: Draft) {
    this.root.querySelector(`.action[data-key="${d.key}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  private duplicate(d: Draft) {
    settle(SCOPE)
    const copy: Draft = { ...d, key: ++keys, id: null, name: `${d.name.trim()} copy`, aliases: [...d.aliases], typing: '', tried: false }
    this.work.splice(this.work.indexOf(d) + 1, 0, copy)
    this.open = copy.key
    this.commit(copy)
    this.focus(`action-name-${copy.key}`, true)
  }

  private remove(d: Draft) {
    const at = this.work.indexOf(d)
    // An action with an id was sent in a save, maybe one still in flight: the list without it goes after it.
    const wasSaved = d.id !== null
    // The undo record: the draft, and the last version a save wrote for it. It starts as what the file holds
    // now and follows any save still in flight that wrote this action, once (and only if) that save succeeds.
    const record = { saved: d.id ? this.committed.get(d.id) : undefined }
    if (d.id) this.undoRecords.set(d.id, record)
    this.work.splice(at, 1)
    if (this.open === d.key) this.open = null
    if (wasSaved) this.saveAll()
    this.render()
    const neighbour = this.work[Math.min(at, this.work.length - 1)]
    this.focus(neighbour ? `action-head-${neighbour.key}` : 'actions-add')
    offerUndo(`Deleted “${label(d)}”`, SCOPE, () => {
      if (d.id && this.work.some(o => o.id === d.id)) return
      // An invalid draft comes back as a draft, with its last saved value written under it.
      if (d.id) this.undoRecords.delete(d.id)
      d.saved = record.saved
      this.work.splice(Math.min(at, this.work.length), 0, d)
      if (wasSaved) this.saveAll()
      this.render()
      this.focus(`action-head-${d.key}`)
      this.ctx.announce(`Restored “${label(d)}”`)
    })
  }

  private move(d: Draft, to: number) {
    const from = this.work.indexOf(d)
    to = Math.max(0, Math.min(this.work.length - 1, to))
    if (from === to) return
    settle(SCOPE)
    this.work.splice(from, 1)
    this.work.splice(to, 0, d)
    if (d.id !== null) this.saveAll()
    this.render()
    this.ctx.announce(`${label(d)} moved to position ${to + 1} of ${this.work.length}`)
  }

  /** Move up / Move down keep the focus on the button that was used, or on the row once it turns off. */
  private step(d: Draft, by: -1 | 1, from: string) {
    this.move(d, this.work.indexOf(d) + by)
    if ((document.getElementById(from) as HTMLButtonElement | null)?.disabled === false) this.focus(from)
    else this.focus(`action-head-${d.key}`)
  }

  private focus(id: string, select = false) {
    const go = () => {
      const node = document.getElementById(id) as HTMLInputElement | null
      if (!node || node.disabled) return false
      node.focus()
      if (select) node.select?.()
      return true
    }
    if (!go()) requestAnimationFrame(go)
  }

  /** Done: an action that cannot be saved stays open with the focus on what is missing. */
  private done(d: Draft) {
    d.tried = true
    // Done also adds a phrase still in the field.
    const typed = d.typing.trim()
    if (typed && !d.aliases.some(a => phrase(a) === phrase(typed))) d.aliases.push(typed)
    d.typing = ''
    const why = reasons(d)
    if (why.name || why.text) {
      this.render()
      this.focus(why.name ? `action-name-${d.key}` : `action-text-${d.key}`)
      return
    }
    this.close(d)
  }

  /** Esc or the row's disclosure: the editor closes, a draft that cannot be saved stays a draft. */
  private close(d: Draft) {
    this.open = null
    d.tried = true
    this.commit(d)
    this.focus(`action-head-${d.key}`)
  }

  // ——— Drawing ———

  render() {
    this.sync()
    const pane = this.slot.pane
    const writable = pane.file.writable && !this.slot.conflict
    const notice = fileNotice(this.slot, {
      subject: 'Actions',
      resave: () => this.saveAll(),
      reset: prefs => this.ctx.applyReset(prefs, 'rules.json'),
      difference: () => this.difference(),
    })
    const broken = pane.file.status === 'invalid' || pane.file.status === 'unreadable'
    const list = card(...this.work.map(d => this.item(d, writable)))
    list.classList.add('action-list')
    list.setAttribute('role', 'list')
    list.setAttribute('aria-label', 'Actions in ⌘K order')
    const empty = h('div', { class: 'empty' },
      h('div', { class: 'empty-title', text: 'No actions yet' }),
      h('div', { text: 'Add one to see it in ⌘K: a name, what the model should do, and the phrases that find it.' }))
    const add = button({ label: 'Add action', icon: 'plus', id: 'actions-add', disabled: !writable || broken, onClick: () => this.add() })
    const parts: Node[] = notice ? [notice] : []
    if (!broken) parts.push(group(null,
      h('div', { class: 'toolbar' }, h('p', { class: 'lead', text: 'Actions appear in this order in ⌘K.' }), h('span', { class: 'spacer' }), add),
      this.work.length ? list : card(empty),
      this.saveError && this.open === null ? fieldError(`Not saved: ${this.saveError}`, 'actions-save-error') : null,
      h('span', { id: 'actions-reorder-help', hidden: true, text: REORDER }),
      this.bar.root))
    else parts.push(group(null, this.bar.root))
    this.root.replaceChildren(...parts)
    this.bar.update()
  }

  /** One line on what differs between the file and the draft, for the conflict banner. */
  private difference(): string | null {
    const conflict = this.slot.conflict
    if (!conflict) return null
    const fresh = conflict.fresh.rules, base = new Map(conflict.base.rules.map(r => [r.id, r]))
    const mine = this.payload().length + this.work.filter(d => d.id === null).length
    const changed = fresh.filter(r => !base.has(r.id) || !same(r, base.get(r.id)!)).map(r => r.name)
    const removed = conflict.base.rules.filter(r => !fresh.some(f => f.id === r.id)).map(r => r.name)
    const out: string[] = []
    if (fresh.length !== mine) out.push(`The file has ${fresh.length} actions; yours has ${mine}.`)
    if (changed.length) out.push(`Changed in the file: ${changed.join(', ')}.`)
    if (removed.length) out.push(`Removed from the file: ${removed.join(', ')}.`)
    return out.join(' ') || null
  }

  private item(d: Draft, writable: boolean): HTMLElement {
    const isOpen = this.open === d.key
    const changed = this.changedRecord(d)
    const unsaved = !this.slot.busy && changed && d.tried && !valid(d)
    const clash = [d.name, ...d.aliases].some(a => this.clash(d, a))
    const index = this.work.indexOf(d)
    const head = h('button', {
      type: 'button', class: 'action-head', id: `action-head-${d.key}`, 'aria-expanded': String(isOpen),
      'aria-describedby': 'actions-reorder-help',
      'aria-label': `${label(d)}${d.kind === 'prefix' ? ', inserts text' : ''}${unsaved ? ', not saved' : ''}. ${isOpen ? 'Close' : 'Edit'}`,
    },
      chevron(isOpen),
      h('span', { class: 'action-name' + (d.name.trim() ? '' : ' placeholder'), text: label(d) }),
      d.kind === 'prefix' ? h('span', { class: 'kind', text: 'Prefix' }) : null,
      h('span', { class: 'action-phrases', text: d.aliases.join(', ') }),
      clash ? h('span', { class: 'pill warning', text: 'Phrase used twice' }) : null,
      unsaved ? h('span', { class: 'pill error', text: 'Not saved' }) : null)
    head.addEventListener('click', () => {
      if (isOpen) return this.close(d)
      this.open = d.key
      this.render()
      this.focus(`action-head-${d.key}`)
      this.reveal(d)
    })
    head.addEventListener('keydown', event => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !writable) return
      event.preventDefault()
      this.move(d, index + (event.key === 'ArrowUp' ? -1 : 1))
      this.focus(`action-head-${d.key}`)
    })
    const grip = h('span', { class: 'grip', 'aria-hidden': 'true', title: REORDER }, icon('grip'))
    if (writable) grip.addEventListener('pointerdown', event => this.startDrag(event, d))
    const tools = h('span', { class: 'row-tools' },
      button({ label: 'Move up', kind: 'icon', icon: 'up', id: `action-row-up-${d.key}`, aria: `Move ${label(d)} up`, disabled: !writable || index === 0, onClick: () => this.step(d, -1, `action-row-up-${d.key}`) }),
      button({ label: 'Move down', kind: 'icon', icon: 'down', id: `action-row-down-${d.key}`, aria: `Move ${label(d)} down`, disabled: !writable || index === this.work.length - 1, onClick: () => this.step(d, 1, `action-row-down-${d.key}`) }))
    const node = h('div', { class: 'action' + (isOpen ? ' open' : ''), role: 'listitem', 'data-key': String(d.key) }, h('div', { class: 'action-row' }, grip, head, tools))
    if (isOpen) node.append(this.editor(d, writable))
    return node
  }

  /** Another action that the same spoken or typed phrase finds, by its name or one of its phrases. */
  private clash(d: Draft, alias: string): Draft | undefined {
    const spoken = phrase(alias)
    return spoken ? this.work.find(o => o !== d && [o.name, ...o.aliases].some(n => phrase(n) === spoken)) : undefined
  }

  /** What really happens in ⌘K (src/main.ts): a pasted or dictated phrase runs the first action in the list
      that has it as its name or a phrase; typed, it lists every action it matches. */
  private clashText(d: Draft, alias: string, other: Draft) {
    const first = this.work.indexOf(other) < this.work.indexOf(d) ? `“${label(other)}”` : 'this action'
    return `“${alias.trim()}” also finds “${label(other)}”. Dictated or pasted in ⌘K, it runs ${first}, which comes first in the list; typed, both are listed.`
  }

  private editor(d: Draft, writable: boolean): HTMLElement {
    const why = reasons(d)
    const show = (field: Reason) => why[field] && d.tried
      ? fieldError(why[field], `action-${field}-error-${d.key}`)
      : why[field] ? h('div', { class: 'field-reason', id: `action-${field}-error-${d.key}`, text: why[field] }) : null

    const name = h('input', {
      type: 'text', class: 'text', id: `action-name-${d.key}`, 'aria-label': 'Name', placeholder: d.id === null ? 'Shorten' : 'Action name',
      autocomplete: 'off', 'aria-describedby': `action-name-error-${d.key}`, 'aria-invalid': why.name && d.tried ? 'true' : undefined,
    })
    name.value = d.name
    name.disabled = !writable
    name.addEventListener('input', () => { d.name = name.value; this.slot.changed() })
    name.addEventListener('keydown', event => { if (event.key === 'Enter' && !composing(event)) { event.preventDefault(); this.commit(d) } })
    name.addEventListener('change', () => afterFocus(() => this.commit(d)))
    const nameClash = this.clash(d, d.name)

    const kind = segmented({
      label: 'Action type', id: `action-kind-${d.key}`, value: d.kind, disabled: !writable,
      choices: [{ value: 'instruction', label: 'Edit with the model' }, { value: 'prefix', label: 'Insert before the prompt' }],
      onChange: value => { d.kind = value as Kind; settle(SCOPE); this.commit(d); this.focus(`action-kind-${d.key}-${value}`) },
    })

    const field = wsField({
      id: `action-text-${d.key}`, label: d.kind === 'instruction' ? 'Instruction' : 'Text to insert', value: text(d), disabled: !writable,
      placeholder: d.kind === 'instruction' ? 'Make the text concise. Keep all essential conditions.' : '/goal ',
      describedBy: `action-text-error-${d.key}`,
      onInput: value => {
        if (d.kind === 'instruction') d.instruction = value; else d.prefix = value
        if (d.kind === 'prefix') this.root.querySelector(`#action-preview-${d.key}`)?.replaceChildren(...this.preview(d))
        this.slot.changed()
      },
      onCommit: () => this.commit(d),
    })

    const index = this.work.indexOf(d)
    const detailsOpen = this.details.has(d.key)
    const disclosure = h('button', { type: 'button', class: 'disclosure', id: `action-details-${d.key}`, 'aria-expanded': String(detailsOpen) },
      chevron(detailsOpen), h('span', { text: 'File details' }))
    disclosure.addEventListener('click', () => { if (detailsOpen) this.details.delete(d.key); else this.details.add(d.key); this.render() })
    const changed = this.changedRecord(d)
    const state = !valid(d) && changed
      ? h('div', { class: 'draft-state', role: 'status' }, icon('warning'), d.id === null || !this.committed.has(d.id)
        ? `New action — not saved: complete the name and ${d.kind === 'instruction' ? 'the instruction' : 'the text to insert'} to add it.`
        : 'Not saved: ⌘K still uses the previous version.')
      : null

    return h('div', { class: 'action-editor', role: 'group', 'aria-label': `Edit ${label(d)}` },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: name.id, text: 'Name' }), name, show('name'),
        nameClash ? h('div', { class: 'field-warning', text: this.clashText(d, d.name, nameClash) }) : null),
      h('div', { class: 'field' }, h('div', { class: 'field-label', id: `action-kind-label-${d.key}`, text: 'Action type' }), kind,
        h('div', { class: 'field-help', text: d.kind === 'instruction' ? 'Edits the selected text, or the whole prompt if nothing is selected.' : 'Inserted before the whole prompt, even when text is selected. The model is not asked.' })),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: `action-text-${d.key}`, text: d.kind === 'instruction' ? 'Instruction' : 'Text to insert' }),
        field, show('text')),
      d.kind === 'prefix' ? h('div', { class: 'field' }, h('div', { class: 'field-label', text: 'Preview' }),
        h('div', { class: 'preview-text', id: `action-preview-${d.key}` }, ...this.preview(d))) : null,
      h('div', { class: 'field' },
        h('div', { class: 'field-label', id: `action-phrases-label-${d.key}`, text: 'Phrases' }),
        this.chips(d, writable),
        h('div', { class: 'field-help', text: 'Find this action in ⌘K by typing or dictating any of these. Press Return to add one.' })),
      state,
      this.saveError ? fieldError(`Not saved: ${this.saveError}`, `action-save-error-${d.key}`) : null,
      h('div', { class: 'editor-footer' },
        disclosure,
        h('span', { class: 'spacer' }),
        button({ label: 'Move up', kind: 'icon', icon: 'up', id: `action-up-${d.key}`, disabled: !writable || index === 0, onClick: () => this.step(d, -1, `action-up-${d.key}`) }),
        button({ label: 'Move down', kind: 'icon', icon: 'down', id: `action-down-${d.key}`, disabled: !writable || index === this.work.length - 1, onClick: () => this.step(d, 1, `action-down-${d.key}`) }),
        button({ label: 'Duplicate', kind: 'icon', icon: 'duplicate', id: `action-duplicate-${d.key}`, disabled: !writable || !valid(d), onClick: () => this.duplicate(d) }),
        button({ label: 'Delete', kind: 'icon', icon: 'trash', id: `action-delete-${d.key}`, aria: `Delete ${label(d)}`, disabled: !writable, onClick: () => this.remove(d) }),
        button({ label: 'Done', id: `action-done-${d.key}`, onClick: () => this.done(d) })),
      detailsOpen ? h('div', { class: 'file-details-body' },
        h('span', { text: 'Action ID' }), h('code', { text: d.id ?? 'made from the name when it is saved' }),
        d.id ? h('span', { class: 'muted', text: 'Unchanged when renamed.' }) : null) : null,
    )
  }

  private preview(d: Draft): Node[] {
    return [h('span', { class: 'preview-prefix' }, ...marks(d.prefix)), document.createTextNode(SAMPLE)]
  }

  private chips(d: Draft, writable: boolean): HTMLElement {
    const input = h('input', { type: 'text', class: 'chip-input', id: `action-phrase-${d.key}`, 'aria-label': 'Add a phrase', placeholder: d.aliases.length ? 'Add a phrase' : 'make shorter', autocomplete: 'off' })
    input.disabled = !writable
    input.value = d.typing
    const note = h('div', { class: 'field-reason', role: 'status', id: `action-phrase-note-${d.key}` })
    input.setAttribute('aria-describedby', note.id)
    input.addEventListener('input', () => { d.typing = input.value; this.unchoose(); this.slot.changed() })
    const add = () => {
      const value = input.value.trim()
      if (!value) return false
      if (d.aliases.some(a => phrase(a) === phrase(value))) { note.textContent = `“${value}” is already here.`; return true }
      d.aliases.push(value)
      input.value = d.typing = ''
      this.commit(d)
      this.focus(input.id)
      return true
    }
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !composing(event)) { event.preventDefault(); add() }
      else if (event.key === 'Backspace' && !input.value && d.aliases.length) {
        event.preventDefault()
        // The first Backspace chooses the last phrase, the second removes it.
        if (this.chosenChip !== d.key) {
          this.chosenChip = d.key
          this.root.querySelector(`#action-chip-${d.key}-${d.aliases.length - 1}`)?.closest('.chip')?.classList.add('chosen')
          this.ctx.announce(`“${d.aliases.at(-1)}” chosen. Press Delete again to remove it.`)
          return
        }
        this.chosenChip = null
        const gone = d.aliases.pop()
        this.commit(d)
        this.focus(input.id)
        this.ctx.announce(`Removed “${gone}”`)
      } else if (event.key !== 'Shift') this.unchoose()
    })
    // A phrase not added yet stays in the field as part of the draft, through redraws and pane changes.
    input.addEventListener('blur', () => this.unchoose())
    const chips = d.aliases.map((alias, i) => {
      const other = this.clash(d, alias)
      const remove = button({ label: 'Remove', kind: 'icon', icon: 'close', id: `action-chip-${d.key}-${i}`, aria: `Remove the phrase ${alias}`, disabled: !writable,
        onClick: () => {
          d.aliases.splice(i, 1)
          this.commit(d)
          this.focus(d.aliases.length ? `action-chip-${d.key}-${Math.min(i, d.aliases.length - 1)}` : input.id)
        } })
      return h('span', { class: 'chip' + (other ? ' clash' : '') + (this.chosenChip === d.key && i === d.aliases.length - 1 ? ' chosen' : '') },
        h('span', { class: 'chip-text', text: alias }),
        other ? h('span', { class: 'chip-flag', text: 'used twice' }) : null,
        remove)
    })
    const clashes = d.aliases.map(alias => [alias, this.clash(d, alias)] as const).filter(([, o]) => o)
    return h('div', { class: 'chips-wrap' },
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': `action-phrases-label-${d.key}` }, ...chips, input),
      ...clashes.map(([alias, other]) => h('div', { class: 'field-warning', text: this.clashText(d, alias, other!) })),
      note)
  }

  private unchoose() {
    if (this.chosenChip === null) return
    this.chosenChip = null
    this.root.querySelectorAll('.chip.chosen').forEach(chip => chip.classList.remove('chosen'))
  }

  // ——— Dragging by the grip ———

  private startDrag(event: PointerEvent, d: Draft) {
    event.preventDefault()
    const list = this.root.querySelector<HTMLElement>('.action-list')!
    const scroller = document.getElementById('pane')!
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > .action')]
    const from = this.work.indexOf(d)
    const node = rows[from]
    node.classList.add('dragging')
    let to = from
    let y = event.clientY
    const marker = h('div', { class: 'drop-marker' })
    list.append(marker)
    const place = () => {
      const top = list.getBoundingClientRect().top
      let at = rows.length
      for (let i = 0; i < rows.length; i++) {
        const box = rows[i].getBoundingClientRect()
        if (y < box.top + box.height / 2) { at = i; break }
      }
      const edge = at < rows.length ? rows[at].getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom
      marker.style.top = `${edge - top - 1}px`
      to = at > from ? at - 1 : at
    }
    place()
    // Near the top or the bottom of the pane, the pane scrolls on by itself.
    const scroll = window.setInterval(() => {
      const box = scroller.getBoundingClientRect()
      const by = y < box.top + 36 ? -8 : y > box.bottom - 36 ? 8 : 0
      if (by) { scroller.scrollTop += by; place() }
    }, 16)
    const moveTo = (e: PointerEvent) => { y = e.clientY; place() }
    const end = (drop: boolean) => {
      window.removeEventListener('pointermove', moveTo)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      clearInterval(scroll)
      marker.remove()
      node.classList.remove('dragging')
      if (drop && to !== from) this.move(d, to)
    }
    const up = () => end(true)
    // A cancelled pointer leaves the order as it was.
    const cancel = () => end(false)
    window.addEventListener('pointermove', moveTo)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  escape() {
    if (this.open === null) return false
    const d = this.find(this.open)
    if (d) this.close(d)
    else this.open = null
    return true
  }
}
