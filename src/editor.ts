import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Text } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { diffArrays } from 'diff'

export interface DiffPart { type: 'same' | 'ins' | 'del'; value: string }

/** Word-sized changes stay readable in prose; offsets are UTF-16 units as in CodeMirror. */
export function textDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [{ type: 'same', value: after }]
  // An apostrophe inside a word belongs to it: user’s, don't.
  const tokenize = (s: string) => s.match(/\s+|[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*|[^\s\p{L}\p{N}\p{M}_]+/gu) ?? []
  const old = tokenize(before), next = tokenize(after)
  let prefix = 0, suffix = 0
  const shared = Math.min(old.length, next.length)
  while (prefix < shared && old[prefix] === next[prefix]) prefix++
  while (suffix < shared - prefix && old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  const removed = old.slice(prefix, old.length - suffix), inserted = next.slice(prefix, next.length - suffix)
  const parts: DiffPart[] = []
  const append = (type: DiffPart['type'], tokens: string[]) => { if (tokens.length) parts.push({ type, value: tokens.join('') }) }
  append('same', old.slice(0, prefix))
  const chunks = removed.length && inserted.length && removed.length + inserted.length <= 20_000
    ? diffArrays(removed, inserted, { timeout: 70, maxEditLength: 1500 }) : undefined
  if (chunks && chunks.length <= 3000) {
    for (const chunk of chunks) append(chunk.added ? 'ins' : chunk.removed ? 'del' : 'same', chunk.value)
  } else {
    append('del', removed)
    append('ins', inserted)
  }
  append('same', old.slice(old.length - suffix))
  return merge(parts)
}

/** Changes separated only by whitespace or one short token read better as "old phrase → new phrase". */
function merge(parts: DiffPart[]): DiffPart[] {
  const result: DiffPart[] = []
  const bridge = (part?: DiffPart) => part?.type === 'same' && /^\s*(?:\S{1,2}\s*)?$/u.test(part.value)
  for (let i = 0; i < parts.length;) {
    if (parts[i].type === 'same') { result.push(parts[i++]); continue }
    let del = '', ins = ''
    for (; i < parts.length; i++) {
      const part = parts[i]
      if (part.type === 'del') del += part.value
      else if (part.type === 'ins') ins += part.value
      else if (bridge(part) && parts[i + 1] && parts[i + 1].type !== 'same') { del += part.value; ins += part.value }
      else break
    }
    // Whitespace both sides end with stays outside the highlight.
    const space = del && ins ? /\s*$/u.exec(del)![0] : ''
    const tail = space && ins.endsWith(space) ? space : ''
    if (del.length > tail.length) result.push({ type: 'del', value: del.slice(0, del.length - tail.length) })
    if (ins.length > tail.length) result.push({ type: 'ins', value: ins.slice(0, ins.length - tail.length) })
    if (tail) result.push({ type: 'same', value: tail })
  }
  return result
}

class Deleted extends WidgetType {
  readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(other: Deleted) { return this.text === other.text }
  get lineBreaks() { return this.text.split('\n').length - 1 }
  toDOM() {
    const node = document.createElement('del')
    node.className = 'cm-diff-del'
    node.textContent = /\S/u.test(this.text) ? this.text : this.text.includes('\n') ? '↵' + this.text : '·'
    node.setAttribute('aria-hidden', 'true')
    return node
  }
}

function diffDecorations(before: string, after: string): DecorationSet {
  let at = 0
  const ranges: Range<Decoration>[] = []
  for (const part of textDiff(before, after)) {
    if (part.type === 'del') ranges.push(Decoration.widget({ widget: new Deleted(part.value), side: -1 }).range(at))
    else {
      if (part.type === 'ins') ranges.push(Decoration.mark({ class: 'cm-diff-ins' }).range(at, at + part.value.length))
      at += part.value.length
    }
  }
  return Decoration.set(ranges, true)
}

/** Inline diff: cleared by the first edit, which accepts it. */
const inlineDiff = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => tr.docChanged ? Decoration.none : value,
  provide: field => EditorView.decorations.from(field),
})

const setPending = StateEffect.define<{ from: number; to: number } | null>()
const pending = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPending)) {
      const range = effect.value
      value = range && range.to > range.from ? Decoration.set([Decoration.mark({ class: 'cm-pending' }).range(range.from, range.to)]) : Decoration.none
    }
    return value.map(tr.changes)
  },
  provide: field => EditorView.decorations.from(field),
})

export interface Change {
  text: string
  /** The edit replaced or deleted the whole non-empty document: a new prompt. */
  replacedAll: boolean
}

export interface EditorOptions {
  onChange: (change: Change) => void
  transformPaste?: (text: string) => string
}

export function createEditor(parent: HTMLElement, options: EditorOptions) {
  const locked = new Compartment()
  const extensions = [
    history(), EditorState.allowMultipleSelections.of(true), EditorView.lineWrapping, drawSelection(), dropCursor(),
    EditorView.contentAttributes.of({ 'aria-label': 'Prompt', spellcheck: 'true', autocorrect: 'on' }),
    placeholder('Write or dictate a prompt…'),
    options.transformPaste ? EditorView.clipboardInputFilter.of(options.transformPaste) : [],
    keymap.of([...historyKeymap, ...defaultKeymap]),
    locked.of([]),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      let replacedAll = false
      for (const tr of update.transactions) {
        if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) continue
        const length = tr.startState.doc.length
        tr.changes.iterChangedRanges((fromA, toA) => { if (length > 0 && fromA === 0 && toA === length) replacedAll = true })
      }
      options.onChange({ text: update.state.doc.toString(), replacedAll })
    }),
  ]

  const makeState = (text: string, before?: string, cursor?: number) => {
    const doc = Text.of(text.split(/\r\n?|\n/))
    const decorations = before === undefined ? Decoration.none : diffDecorations(before, doc.toString())
    return EditorState.create({
      doc, selection: { anchor: Math.min(cursor ?? doc.length, doc.length) },
      extensions: [extensions, inlineDiff.init(() => decorations), pending],
    })
  }

  const view = new EditorView({ parent, state: makeState('') })
  return {
    focus: () => view.focus(),
    text: () => view.state.doc.toString(),
    selection: () => view.state.selection.main,
    /** The full selection, including a bare caret, a reversed range and multiple ranges. */
    selections: () => view.state.selection,
    restore: (selection: EditorSelection) => view.dispatch({ selection }),
    selectAll: () => view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) }),
    /** Replaces the document without an editing event; `before` renders the inline diff. */
    show(text: string, before?: string, cursor?: number) {
      view.setState(makeState(text, before, cursor ?? view.state.selection.main.head))
      view.dispatch({ scrollIntoView: true })
    },
    /** Read-only with a shimmer over the range that is being rewritten. */
    lock(range: { from: number; to: number } | null) {
      view.dispatch({
        selection: range ? { anchor: range.to } : undefined,
        effects: [setPending.of(range), locked.reconfigure(range ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [])],
      })
    },
  }
}
