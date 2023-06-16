// Runs before the real src/main.ts in the landing-page demo. It answers the Tauri IPC calls the app
// makes (see tests/composer.test.mjs for the same boundary), keeps the panel's theme in step with the
// page around it, and exposes `window.sushiDemo` so the page can drive a guided tour and touch buttons.
// Nothing here changes the app's own code: the panel is the product, only the native side is stubbed.
import { EditorView } from '@codemirror/view'
import shipped from '../specs/examples/rules.json'
import dictionary from '../specs/examples/dictionary.json'
import taskBrief from '../specs/examples/task-brief.md?raw'
import bugReport from '../specs/examples/bug-report.md?raw'
import releaseReview from '../specs/examples/release-review.md?raw'
import { answer } from './answers'
import type { Commands, Events } from '../../src/ipc'

/** What the panel tells the page around it (docs/components/stage.jsx), by `type`. */
type Detail =
  | { type: 'ready' } | { type: 'interact' } | { type: 'hide' }
  | { type: 'notice'; text: string }
  | { type: 'copy'; text: string; tour: boolean }
  | { type: 'rewrite'; instruction: string }
  | ReturnType<typeof snapshot>
const emit = (detail: Detail) => window.frameElement?.dispatchEvent(new CustomEvent('sushi', { detail }))

// Every visit starts with an empty prompt; the visitor's draft lives only as long as the page.
try { localStorage.removeItem('sushi.draft.v3') } catch {}

// ——— Theme: follow the page, not the system ———

const schemes = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules] } catch { return [] } })
  .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && /prefers-color-scheme:\s*light/.test(rule.conditionText))
function setTheme(theme: 'light' | 'dark') {
  for (const rule of schemes) rule.media.mediaText = theme === 'light' ? 'all' : 'not all'
  document.documentElement.style.colorScheme = theme
}
const initial = new URLSearchParams(location.search).get('theme')
if (initial === 'light' || initial === 'dark') setTheme(initial)

// ——— Tour mode: the page drives the panel without taking keyboard focus from the visitor ———

// Starts on: the app focuses its editor at startup, and some engines (WebKit) would let that take
// keyboard focus away from the page around the panel. The visitor's first click or key turns it off.
let tour = true
/** Bumped when the tour stops, so that a typing loop in progress gives up at its next character. */
let run = 0
const focus = HTMLElement.prototype.focus
HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) { if (!tour) focus.call(this, options) }
const style = document.createElement('style')
// While the tour types, show the caret even though the editor is not focused.
style.textContent = 'html.tour .cm-editor .cm-cursorLayer { display: block !important; animation: none !important; } html.tour .cm-cursor { display: block !important; }'
document.head.append(style)
document.documentElement.classList.add('tour')
function setTour(on: boolean) {
  if (!on) run++
  tour = on
  document.documentElement.classList.toggle('tour', on)
  if (on && document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

// ——— The native side ———

const rules = shipped.rules
const hour = 3_600_000
const body = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
const title = (markdown: string) => /^---\n[\s\S]*?^title:\s*(.+)$/m.exec(markdown)?.[1].trim()
const templates: Record<string, string> = { 'bug-report': bugReport, 'release-review': releaseReview, 'task-brief': taskBrief }
const documents: Record<string, { ago: number; text: string }> = {
  'Refactor settings store': { ago: 2 * hour, text: 'Move the settings store to a single module.\nKeep the public API and the migration of saved preferences.\nAdd tests for the defaults.' },
  'Flaky login test': { ago: 26 * hour, text: 'The login test fails about one run in ten on CI.\nFind the race, fix it in the test or the code, and explain which one it was.' },
  'Review onboarding copy': { ago: 9 * 24 * hour, text: 'Read the onboarding screens and list every sentence longer than 20 words.\nSuggest a shorter version for each, without changing the steps.' },
}
const callbacks: ((payload: unknown) => void)[] = []
const listeners: Partial<Record<keyof Events, (message: unknown) => void>> = {}
/** Delivers an event from the native side, with the payload src/ipc.ts declares for it. */
/** Every event of src/ipc.ts; one the page listens for but the demo never sends stops it here. */
const events: string[] = Object.keys({ 'launcher-shown': true, 'startup-notes': true, 'report-open': true, 'report-recording': true, 'prefs-changed': true, 'prefs-pane': true } satisfies Record<keyof Events, true>)
const fire = <K extends keyof Events>(event: K, payload: Events[K]) => listeners[event]?.({ event, payload })
const pending = new Map<string, () => void>()

const noWindow = () => Promise.reject(new Error('The demo has no settings window.'))

/** The model the demo's hint names: the one the app runs locally by default. */
const model = 'qwen3.5:4b-mlx'
type Handlers = { [K in keyof Commands]: (args: Commands[K]['args']) => Commands[K]['reply'] | Promise<Commands[K]['reply']> }
// Typed against src/ipc.ts: `npm run build` type-checks this file, so a reply the app reads differently fails there.
const commands: Handlers = {
  settings_load: () => ({ rules, terms: dictionary.terms, error: null }),
  startup_notes: () => null,
  warm_model: () => null,
  ollama_download: () => (emit({ type: 'notice', text: 'In the app, this opens the Ollama download page in your browser.' }), null),
  async copy_text({ text }) {
    // Only a copy the visitor asked for reaches the real clipboard; the tour never does.
    if (!tour) await navigator.clipboard?.writeText(text).catch(() => {})
    emit({ type: 'copy', text, tour })
    return null
  },
  hide_launcher: () => (emit({ type: 'hide' }), null),
  rewrite({ instruction, text, requestId }) {
    const { reply, known } = answer(instruction, text, rules)
    if (!known) emit({ type: 'notice', text: 'The demo knows a few instructions. In the app, every instruction goes to the local model.' })
    emit({ type: 'rewrite', instruction })
    const wait = speed * Math.min(2200, 650 + text.length * 6)
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ text: reply, model }) }, wait)
      pending.set(requestId, () => clearTimeout(timer))
    })
  },
  cancel_rewrite({ requestId }) { pending.get(requestId)?.(); pending.delete(requestId); return null },
  library_list: ({ kind }) => kind === 'templates'
    ? Object.entries(templates).map(([name, text]) => ({ name, title: title(text), updatedAt: null }))
    : Object.entries(documents).map(([name, { ago }]) => ({ name, updatedAt: Date.now() - ago })),
  library_read: ({ kind, name }) => kind === 'templates' ? body(templates[name] ?? '') : documents[name]?.text ?? '',
  dictionary_open: () => (emit({ type: 'notice', text: 'In the app, this opens dictionary.json in your text editor.' }), null),
  diagnostics_key: () => null,
  diagnostics_state: () => ({ file: false, report: false }),
  provider_connect: () => (emit({ type: 'notice', text: 'In the app, this connects a hosted model from the menu bar menu.' }), null),
  // The demo has no menu bar menu, so Report a problem never opens; these only keep the contract.
  report_start: () => ({ fixed: [] }),
  report_questions: () => Promise.reject(new Error('The demo asks no questions.')),
  report_record: () => null,
  report_end: () => null,
  report_draft: () => ({ text: 'In the app, the report holds your description, the build and the state of Sushi.' }),
  report_save: () => null,
  // The demo has no settings window: ⌘, says what it does in the app; the window's own calls never come.
  prefs_open: () => (emit({ type: 'notice', text: 'In the app, ⌘, opens the settings window.' }), null),
  prefs_load: noWindow,
  prefs_keyboard_save: noWindow,
  prefs_capture: () => null,
  prefs_model_select: noWindow,
  prefs_model_option: noWindow,
  prefs_connect: noWindow,
  prefs_disconnect: noWindow,
  prefs_actions_save: noWindow,
  prefs_dictionary_save: noWindow,
  prefs_library_choose: noWindow,
  prefs_library_default: noWindow,
  prefs_diagnostics_save: noWindow,
  prefs_reset: noWindow,
  prefs_file: noWindow,
  prefs_action: noWindow,
}

declare global { interface Window { isTauri?: boolean; __TAURI_INTERNALS__?: unknown; sushiDemo?: typeof api } }
window.isTauri = true
window.__TAURI_INTERNALS__ = {
  transformCallback: (callback: (payload: unknown) => void) => callbacks.push(callback),
  async invoke(command: string, args: Record<string, any> = {}) {
    if (command === 'plugin:event|listen') {
      if (!events.includes(args.event)) throw new Error('Unexpected event: ' + args.event)
      listeners[args.event as keyof Events] = callbacks[args.handler - 1]
      return 1
    }
    if (!Object.hasOwn(commands, command)) throw new Error('Unexpected IPC call: ' + command)
    return (commands[command as keyof Commands] as (args: unknown) => unknown)(args)
  },
}
/** 1 is real time for the canned rewrites; reduced motion and tests can make them instant. */
let speed = 1

// ——— Visitor activity and state for the page ———

for (const type of ['pointerdown', 'keydown', 'paste'] as const)
  addEventListener(type, event => { if (event.isTrusted) emit({ type: 'interact' }) }, true)

// Caps Lock (or the fallback ⌃⇧Space) while the panel has focus hides it, as the hotkey does in the app.
// Browsers on macOS report Caps Lock as keydown when it turns on and keyup when it turns off.
for (const type of ['keydown', 'keyup'] as const)
  document.addEventListener(type, event => {
    const space = type === 'keydown' && event.code === 'Space' && event.shiftKey && event.ctrlKey
    if (event.isTrusted && (event.code === 'CapsLock' || space)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      emit({ type: 'hide' })
    }
  }, true)

// Outside macOS, Ctrl stands in for ⌘ on the app's own shortcuts. This listener runs before the app's.
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
document.addEventListener('keydown', event => {
  if (mac || !event.isTrusted || !event.ctrlKey || event.metaKey || event.altKey) return
  const review = !!document.querySelector('#hint .keys')
  if (!['KeyK', 'KeyL', 'Enter', 'NumpadEnter'].includes(event.code) && !(review && /^Arrow(?:Left|Right)$/.test(event.code))) return
  event.preventDefault()
  event.stopImmediatePropagation()
  event.target?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, code: event.code, shiftKey: event.shiftKey, metaKey: true, bubbles: true, cancelable: true }))
}, true)

function view(): EditorView {
  const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
  if (!found) throw new Error('The editor is not ready')
  return found
}
const openPalette = () => document.querySelector<HTMLElement>('.palette:not([hidden])')
function snapshot() {
  const palette = openPalette()
  return {
    type: 'state' as const,
    text: view().state.doc.toString(),
    selection: !view().state.selection.main.empty,
    canBack: !document.getElementById('previous')!.hidden,
    canForward: !document.getElementById('next')!.hidden,
    diff: !!document.querySelector('.cm-diff-ins, .cm-diff-del'),
    busy: document.getElementById('action')!.classList.contains('busy'),
    palette: palette ? (palette.classList.contains('library') ? 'library' : 'actions') : null,
    hint: document.getElementById('hint')!.textContent ?? '',
  }
}
let queued = 0
const report = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(() => emit(snapshot())) }

// ——— The API the page uses ———

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const keyNames: Record<string, string> = { KeyK: 'k', KeyL: 'l', Enter: 'Enter', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Escape: 'Escape', KeyT: 't', Digit1: '1' }

const api = {
  setTheme,
  setTour,
  /** 0 makes canned rewrites instant. */
  setSpeed(value: number) { speed = value },
  state: snapshot,
  /** The launcher was shown again, as after Caps Lock: the app selects a copied prompt. */
  show() { fire('launcher-shown', null); report() },
  focus() { if (!openPalette()) view().focus() },
  /** A key as the app receives it; ⌘ by default. */
  key(code: string, { meta = true, shift = false } = {}) {
    const target = openPalette()?.querySelector('input') ?? document.activeElement ?? document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: keyNames[code] ?? code, code, metaKey: meta, shiftKey: shift, bubbles: true, cancelable: true }))
    report()
  },
  /** Types into the editor at the caret, one character at a time. */
  async type(text: string, delay = 26) {
    const id = run
    for (const char of text) {
      if (id !== run) break
      const v = view()
      v.dispatch({ ...v.state.replaceSelection(char), userEvent: 'input.type', scrollIntoView: true })
      if (delay) await sleep(char === ' ' ? delay * 0.6 : delay * (0.6 + Math.random() * 0.8))
    }
    report()
  },
  /** Inserts dictated text in phrases, the way a dictation tool delivers it. */
  async dictate(text: string, delay = 160) {
    const id = run
    for (const words of text.match(/\S+(?:\s+\S+){0,2}\s*/g) ?? []) {
      if (id !== run) break
      const v = view()
      v.dispatch({ ...v.state.replaceSelection(words), userEvent: 'input.type', scrollIntoView: true })
      if (delay) await sleep(delay)
    }
    report()
  },
  /** Selects the first occurrence of `text`; returns false when it is not in the prompt. */
  select(text: string) {
    const v = view(), at = v.state.doc.toString().indexOf(text)
    if (at < 0) return false
    v.dispatch({ selection: { anchor: at, head: at + text.length }, scrollIntoView: true })
    report()
    return true
  },
  /** Selects the sentence at the caret, or the longest one when the caret is at the end. */
  selectSentence() {
    const v = view(), doc = v.state.doc.toString(), head = v.state.selection.main.head
    const parts = [...doc.matchAll(/[^.!?\n]+[.!?]?/g)].map(m => ({ from: m.index! + (m[0].length - m[0].trimStart().length), to: m.index! + m[0].trimEnd().length }))
      .filter(p => p.to > p.from)
    if (!parts.length) return false
    const at = head < doc.length ? parts.find(p => head >= p.from && head <= p.to) : undefined
    const pick = at ?? parts.reduce((a, b) => b.to - b.from > a.to - a.from ? b : a)
    v.dispatch({ selection: { anchor: pick.from, head: pick.to }, scrollIntoView: true })
    report()
    return true
  },
  /** Types into the open palette's field. */
  async query(text: string, delay = 70) {
    const input = openPalette()?.querySelector('input')
    if (!input) return
    const id = run
    for (const char of text) {
      if (id !== run) break
      input.value += char
      input.dispatchEvent(new Event('input', { bubbles: true }))
      if (delay) await sleep(delay * (0.7 + Math.random() * 0.6))
    }
    report()
  },
  /** Pastes into the open palette's field, as MacWhisper does after dictation. */
  paste(text: string) {
    const input = openPalette()?.querySelector('input')
    if (!input) return
    const data = new DataTransfer()
    data.setData('text/plain', text)
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    report()
  },
  /** Enter in the open palette: runs the selected row. */
  enter() {
    openPalette()?.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    report()
  },
  /** Closes palettes and starts a new, empty prompt, as select-all and delete would. */
  clear() {
    while (openPalette()) api.key('Escape', { meta: false })
    const v = view()
    if (v.state.doc.length) v.dispatch({ changes: { from: 0, to: v.state.doc.length }, selection: { anchor: 0 }, userEvent: 'delete' })
    report()
  },
}
window.sushiDemo = api

addEventListener('DOMContentLoaded', () => {
  new MutationObserver(report).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['hidden', 'class', 'aria-selected'] })
  document.addEventListener('selectionchange', report)
  report()
  emit({ type: 'ready' })
})
