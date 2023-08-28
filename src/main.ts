import { isTauri } from '@tauri-apps/api/core'
import shipped from '../docs/specs/examples/rules.json'
import './style.css'
import { Chain, type Version } from './history'
import { changedPlaces, createEditor } from './editor'
import { Palette, type Row } from './palette'
import { Library, type Entry, type Kind } from './library'
import { instructionFirst, phrase, rank } from './fuzzy'
import { el, icon, keys } from './icons'
import { call, on, type Diagnostics, type Edit, type Rule, type Term } from './ipc'
import { Report } from './report'


// Dictation tools post-process text themselves; flip to re-enable dictionary replacement on paste.
const APPLY_DICTIONARY = false

const desktop = isTauri()
if (!desktop) document.documentElement.classList.add('stage')
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const windowRoot = document.querySelector<HTMLElement>('.window')!
const workspace = $('workspace')
const [actionButton, libraryButton, copyButton, previousButton, nextButton] =
  ['action', 'library', 'copy', 'previous', 'next'].map(id => $<HTMLButtonElement>(id))
const hintSlot = $('hint')
const statusSlot = $('status')

// ——— Draft ———

const KEY = 'sushi.draft.v3'
function loadChain(): Chain {
  const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return undefined } }
  return Chain.restore(read(KEY))
}
const chain = loadChain()
let saveTimer = 0
/** Debounced unless `now`; returns false when the draft could not be stored even after compacting. */
function save(now = false): boolean {
  clearTimeout(saveTimer)
  if (!now) {
    saveTimer = window.setTimeout(() => save(true), 200)
    return true
  }
  const write = () => localStorage.setItem(KEY, JSON.stringify(chain))
  try { write(); return true } catch (e) {
    try {
      if (!chain.compact()) throw e
      write()
      update()
      return true
    } catch (e) {
      fail(new Error('Could not save the draft: ' + message(e)))
      return false
    }
  }
}

// ——— Settings ———

/** rules.json and dictionary.json are read independently (LF-4): an invalid one keeps what was last read for it. */
const settings: { rules: Rule[]; terms: Term[] } = { rules: desktop ? [] : shipped.rules, terms: [] }
async function loadSettings() {
  if (!desktop) return settings
  try {
    const loaded = await call('settings_load')
    if (loaded.rules) settings.rules = loaded.rules
    if (loaded.terms) settings.terms = loaded.terms
    settingsError = loaded.error ?? ''
  } catch (e) {
    settingsError = message(e)
  }
  if (settingsError && library.isOpen) library.showError(settingsError)
  update()
  return settings
}

/** Dictionary terms replace whole words, case-insensitively, in text pasted into the editor. */
function replaceTerms(text: string) {
  const lookup = new Map(settings.terms.filter(t => t.from).map(t => [t.from.toLocaleLowerCase(), t.to]))
  if (!lookup.size) return text
  const words = [...lookup.keys()].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + words.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu')
  return text.replace(pattern, match => lookup.get(match.toLocaleLowerCase()) ?? match)
}

// ——— Hint slot: error > notice > outcome of an edit > review hint ———

let error = ''
/** Kept apart so that the next successful settings_load clears it. */
let settingsError = ''
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
let notice = ''
let noticeTimer = 0
function fail(e: unknown) {
  if (library.isOpen) return library.showError(message(e))
  error = message(e)
  update()
}
/**
 * The last model edit returned the text as it was. Unlike a notice it stays until the next step
 * (typing, ⌘← ⌘→, ⌘K, ⌘L), so a refusal is not mistaken for a lost request (SUSI-5).
 */
let unchanged = false
/** How long the model took for each version it produced, and which model it was; kept in memory only. */
const took = new WeakMap<Version, number>()
const madeBy = new WeakMap<Version, string>()
/** The number of changed places of each diff, counted once. */
const places = new WeakMap<Version, number>()
function summary(): string {
  const version = chain.current, before = chain.before
  if (before === undefined) return ''
  let count = places.get(version)
  if (count === undefined) places.set(version, count = changedPlaces(before, version.text))
  const seconds = took.get(version), model = madeBy.get(version)
  return (model === undefined ? '' : `${model} · `) + (seconds === undefined ? '' : `${seconds.toFixed(1)} s · `) +
    (count === 1 ? '1 change' : `${count} changes`)
}
function notify(message: string) {
  clearTimeout(noticeTimer)
  notice = message
  noticeTimer = window.setTimeout(() => { notice = ''; update() }, 3000)
  update()
}
/**
 * The messages of src-tauri/src/rewrite.rs that carry an action, word for word; a Rust test keeps them in step.
 * Only these exact strings get one, so text from elsewhere (an error Ollama returned, say) always stays plain.
 */
const ollamaActions: { message: string; phrase: string; download?: true }[] = [
  { message: 'Ollama is not installed on this Mac. Download Ollama', phrase: 'Download Ollama', download: true },
  { message: 'Install the local model with ollama pull qwen3.5:4b-mlx', phrase: 'ollama pull qwen3.5:4b-mlx' },
  { message: 'Ollama did not start. Run ollama serve and try again.', phrase: 'ollama serve' },
]

/**
 * Gives one of Sushi's own Ollama messages its action: "Download Ollama" opens the download page through a command
 * that takes no address, a command is copied and `done` shows the confirmation. Other text comes back as it is.
 */
function actionable(text: string, done: (message: string) => void): (Node | string)[] {
  // A failed hosted edit ends with this phrase (docs/specs/model.md, MD-6); the button repeats it locally.
  // A rejected or missing key also offers Connect again, which starts the native connect flow.
  const hosted = /^(OpenRouter|OpenAI|Claude)\b/u.exec(text)?.[1] as keyof typeof providerIds | undefined
  if (text.endsWith(EDIT_WITH_OLLAMA) && (hosted || text.startsWith('model.json'))) {
    let rest = text.slice(0, -EDIT_WITH_OLLAMA.length)
    const parts: (Node | string)[] = []
    if (hosted && rest.endsWith(CONNECT_AGAIN)) {
      rest = rest.slice(0, -CONNECT_AGAIN.length)
      const connect = el('button', 'link', CONNECT_AGAIN.replace(' ·', '').trim())
      connect.type = 'button'
      connect.title = `Connect ${hosted} from the menu bar menu's flow`
      connect.addEventListener('mousedown', event => event.preventDefault())
      connect.addEventListener('click', () => { call('provider_connect', { provider: providerIds[hosted] }).catch(fail) })
      parts.push(' ', connect)
    }
    if (retry) {
      const button = el('button', 'link', EDIT_WITH_OLLAMA.trim())
      button.type = 'button'
      button.title = 'Run the same edit on the same text with the local model'
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () => editLocally())
      parts.push(parts.length ? ' · ' : ' ', button)
    }
    if (parts.length) return [rest, ...parts]
  }
  const known = ollamaActions.find(action => action.message === text)
  if (!known) return [text]
  const { phrase, download } = known
  const button = download ? el('button', 'link', phrase) : el('button', 'command', phrase, icon('copy'))
  button.type = 'button'
  button.title = download ? 'Open ollama.com/download' : 'Copy'
  if (!download) button.setAttribute('aria-label', 'Copy ' + phrase)
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', async () => {
    try {
      if (download) return await call('ollama_download')
      await (desktop ? call('copy_text', { text: phrase }) : navigator.clipboard.writeText(phrase))
      done('Copied. Run it in Terminal, then try again.')
    } catch (e) { fail(e) }
  })
  const at = text.lastIndexOf(phrase)
  return [text.slice(0, at), button, text.slice(at + phrase.length)].filter(part => part !== '')
}
function hint(): (Node | string)[] {
  // Tab from the prompt reaches a button here; after a copy the caret goes back to the prompt.
  const problem = error || settingsError || diagnostics.error
  if (problem) return actionable(problem, message => { error = ''; notify(message); editor.focus() })
  if (notice) return [notice]
  if (busy) return []
  if (unchanged) return ['No changes: the model returned the text as it was · ', keys('⌘', 'K'), ' Try other words']
  if (chain.diff) return [el('span', 'label', chain.current.label ?? ''), ' · ', summary(), ' · ', keys('⌘', '←'), ' Back · ', keys('⌘', '→'), ' Accept']
  if (!chain.review) return []
  const parts: (Node | string)[] = []
  if (chain.canBack) parts.push(keys('⌘', '←'), ' Back')
  if (chain.canBack && chain.canForward) parts.push(' · ')
  if (chain.canForward) parts.push(keys('⌘', '→'), ' Forward')
  return parts
}

// ——— Editor ———

const editor = createEditor($('editor'), {
  onChange({ text, replacedAll }) {
    unchanged = false
    if (replacedAll) chain.reset(text)
    else chain.edit(text)
    update()
    save()
  },
  transformPaste: APPLY_DICTIONARY ? replaceTerms : undefined,
})

function show(cursor?: number) {
  editor.show(chain.text, chain.before, cursor)
  update()
  save()
}

let busy: { id: string } | undefined
let shownBusy: boolean | undefined
function update() {
  const blank = !chain.text.trim()
  copyButton.disabled = !!busy || blank
  libraryButton.disabled = !!busy
  previousButton.hidden = !!busy || !chain.canBack
  nextButton.hidden = !!busy || !chain.canForward
  const forward = chain.diff ? 'Accept changes' : 'Next version'
  nextButton.setAttribute('aria-label', forward)
  nextButton.title = forward + ' (⌘→)'
  if (shownBusy !== !!busy) {
    shownBusy = !!busy
    actionButton.replaceChildren(...busy
      ? [icon('spinner'), el('span', 'label', 'Rewriting…'), keys('esc')]
      : [icon('action'), el('span', 'label', 'Action'), keys('⌘', 'K')])
    actionButton.classList.toggle('busy', !!busy)
    actionButton.setAttribute('aria-label', busy ? 'Cancel rewriting' : 'Action')
  }
  hintSlot.replaceChildren(...hint())
  hintSlot.classList.toggle('error', !!(error || settingsError || diagnostics.error))
  showStatus()
}

function navigate(forward: boolean) {
  if (busy) return
  error = ''
  unchanged = false
  if (forward ? chain.forward() : chain.back()) show()
}

// ——— Actions (⌘K) ———

let target = { from: 0, to: 0 }
const actions = new Palette(windowRoot, {
  label: 'Actions', className: 'actions', placeholder: 'Rewrite prompt…',
  onQuery: query => {
    const rows: Row[] = rank(settings.rules, query).map(rule => ({ id: rule.id, name: rule.name, icon: 'action', run: () => run(rule) }))
    // A free-form instruction is always offered; it comes first when no action matches well.
    const custom = query.trim().replace(/\s+/gu, ' ')
    const free: Row = { id: '\u0000custom', name: custom, icon: 'instruction', hint: 'Instruction', key: '↵', run: () => rewrite(custom, custom) }
    if (custom) rows.splice(instructionFirst(settings.rules, custom) ? 0 : rows.length, 0, free)
    actions.render(rows)
  },
  // Tab and Shift-Tab move between the field and a button in the note (see openActions); the palette keeps them otherwise.
  onKey: event => {
    const button = actions.footer.querySelector('button')
    if (event.key !== 'Tab' || !button) return false
    event.preventDefault()
    button.focus()
    return true
  },
  onPaste: query => {
    // Dictation: a pasted phrase that names a rule runs it right away.
    const spoken = phrase(query)
    const rule = spoken && settings.rules.find(r => [r.name, ...r.aliases].some(name => phrase(name) === spoken))
    if (rule) run(rule)
  },
  onClose: closed,
})

/** Bumped on every ⌘K opening, so that a late warm-up answer of an earlier one is ignored. */
let warming = 0
actions.footer.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return
  event.preventDefault()
  actions.focus()
})

function openActions() {
  if (busy) return
  library.close()
  if (!chain.text.trim()) return notify('Write a prompt first')
  const selection = editor.selection()
  target = selection.empty ? { from: 0, to: editor.text().length } : { from: selection.from, to: selection.to }
  actions.input.placeholder = selection.empty ? 'What to do with the prompt?' : 'What to do with the selection?'
  opened(actions)
  // The warm-up also says when an edit is bound to fail; a quiet note, the actions stay usable.
  // Only the answer to this opening counts: an earlier one may arrive late.
  const ticket = ++warming
  const note = (...parts: (Node | string)[]) => actions.footer.replaceChildren(...parts.length ? [el('span', 'note', ...parts)] : [])
  note()
  if (desktop) call('warm_model')
    .then(text => {
      if (ticket !== warming || !actions.isOpen) return
      if (!text) return note()
      note(...actionable(text, message => { note(message); actions.focus() }))
    })
    .catch(() => {})
}

function run(rule: Rule) {
  if (rule.prefix !== undefined) prepend(rule.prefix, rule.name)
  else void rewrite(rule.instruction ?? '', rule.name)
}

/** A local action: puts `prefix` at the very beginning of the whole prompt, shown as a diff. */
function prepend(prefix: string, label: string) {
  actions.close()
  error = ''
  if (busy) return
  if (chain.text.startsWith(prefix) || !chain.apply(prefix + chain.text, label)) return notify('No changes')
  show(prefix.length)
}

/** The phrases that end a hosted failure; Rust tests keep them in step with src-tauri/src/hosted.rs. */
const EDIT_WITH_OLLAMA = ' Edit with Ollama'
const CONNECT_AGAIN = ' Connect again ·'
/** The name a failure starts with, and the provider id Connect again sends (src-tauri/src/providers.rs). */
const providerIds = { OpenRouter: 'openrouter', OpenAI: 'openai', Claude: 'anthropic' } as const
/** The last edit that failed, so that Edit with Ollama repeats it on the same text. */
let retry: { instruction: string; label: string; from: number; to: number; text: string } | undefined

function editLocally() {
  const last = retry
  if (!last || busy) return
  if (editor.text().slice(last.from, last.to) !== last.text) {
    error = ''
    retry = undefined
    return notify('The text has changed. Press ⌘K to edit it again.')
  }
  target = { from: last.from, to: last.to }
  void rewrite(last.instruction, last.label, true)
}

async function rewrite(instruction: string, label: string, local = false) {
  actions.close()
  const full = editor.text()
  const { from, to } = target
  const text = full.slice(from, to)
  error = ''
  retry = undefined
  if (!text.trim()) return notify('Write a prompt first')
  if (!desktop) return notify('Rewrites run in the Sushi app')
  const id = crypto.randomUUID()
  busy = { id }
  original = editor.selections()
  editor.lock({ from, to })
  update()
  const started = performance.now()
  let raw: Edit
  try {
    raw = await call('rewrite', { instruction, text, requestId: id, local })
  } catch (e) {
    if (busy?.id === id) { retry = { instruction, label, from, to, text }; settle(); fail(e) }
    return
  }
  if (busy?.id !== id) return
  settle(false)
  // A reply of another shape is a broken contract, never text: String() would turn it into "undefined".
  if (typeof raw?.text !== 'string') return settle(), fail(new Error('The edit came back without text.'))
  const reply = raw.text.replace(/\r\n?/g, '\n').trim()
  if (!reply) return settle(), fail(new Error('The model returned an empty edit.'))
  const lead = /^\s*/u.exec(text)![0], trail = /\s*$/u.exec(text)![0]
  if (chain.apply(full.slice(0, from) + lead + reply + trail + full.slice(to), label)) {
    took.set(chain.current, (performance.now() - started) / 1000)
    madeBy.set(chain.current, raw.model)
    show(from + lead.length + reply.length)
  } else { unchanged = true; settle() }
}

/** Ends the pending state; unless a result is about to be shown, the original selection comes back. */
let original: ReturnType<typeof editor.selections> | undefined
function settle(restore = true) {
  busy = undefined
  editor.lock(null)
  if (restore && original) editor.restore(original)
  update()
  if (!actions.isOpen && !library.isOpen) editor.focus()
}

function cancel() {
  if (!busy) return
  const { id } = busy
  settle()
  call('cancel_rewrite', { requestId: id }).catch(fail)
}

// ——— Library (⌘L) ———

let reading = 0
const library = new Library(windowRoot, {
  list: kind => desktop ? call('library_list', { kind }) : Promise.resolve([]),
  terms: async () => (await loadSettings()).terms,
  async open(kind: Kind, entry: Entry) {
    const ticket = ++reading
    try {
      let text = (await call('library_read', { kind, name: entry.name })).replace(/\r\n?/g, '\n')
      if (kind === 'templates') text = text.replace(/^(?:[ \t]*\n)+/, '')
      if (ticket !== reading || !library.isOpen) return
      chain.open(text)
      const blank = /^[ \t]*$/m.exec(text)
      library.close()
      error = ''
      show(blank ? blank.index : text.length)
    } catch (e) { fail(e) }
  },
  openDictionary: () => { call('dictionary_open').catch(fail) },
  onClose: closed,
})

function openLibrary() {
  if (busy) return
  actions.close()
  opened(library)
}

function opened(panel: Palette | Library | Report) {
  unchanged = false
  workspace.inert = true
  windowRoot.classList.toggle('library-open', panel === library)
  windowRoot.classList.toggle('actions-open', panel === actions)
  windowRoot.classList.toggle('report-open', panel === report)
  if (panel === library) library.open()
  else if (panel === report) void report.open()
  else actions.open()
}
function closed() {
  if (actions.isOpen || library.isOpen || report.isOpen) return
  reading++
  workspace.inert = false
  windowRoot.classList.remove('library-open', 'actions-open', 'report-open')
  editor.focus()
}

// ——— Report a problem (docs/specs/report.md) ———

/** Which view was open when the flow started: the snapshot names it (RP-6). */
let reportedView: 'editor' | 'actions' | 'library' = 'editor'
/** Where the flow started. From Settings ▸ About, leaving it hides the panel, so the keyboard
    goes back to Settings; from the menu the panel stays (RP-1). */
let reportOrigin: 'menu' | 'settings' = 'menu'
/** How the flow was left, for the hide that follows from Settings (LF-22). */
let reportLeft: 'esc' | 'copy' = 'esc'
const report = new Report(windowRoot, {
  start: () => call('report_start'),
  questions: (description, consent) => call('report_questions', { description, consent }),
  record: on => call('report_record', { on }).then(() => refreshDiagnostics()),
  end: () => call('report_end').then(() => refreshDiagnostics()),
  draft: (description, answers) => call('report_draft', {
    description, answers, panel: { view: reportedView, versions: chain.versions.length, editing: !!busy },
  }),
  copy: async text => {
    await (desktop ? call('copy_text', { text }) : navigator.clipboard.writeText(text))
    // Copying finishes a flow started from Settings: the user goes back to where they came from.
    if (reportOrigin === 'settings') { reportLeft = 'copy'; report.close() }
  },
  save: async (text, recording) => { await call('report_save', { text, recording }) },
  onClose: () => {
    closed()
    void refreshDiagnostics()
    if (reportOrigin === 'settings') {
      const reason = reportLeft
      reportOrigin = 'menu'
      reportLeft = 'esc'
      void hide(false, reason)
    }
  },
  onRecording: () => { closed(); void refreshDiagnostics() },
})

function openReport(origin: 'menu' | 'settings' = 'menu') {
  if (report.isOpen) return report.focus()
  // The view the flow started from: reopening it during a recording keeps that one (RP-6).
  if (!report.active) {
    reportedView = actions.isOpen ? 'actions' : library.isOpen ? 'library' : 'editor'
    reportOrigin = origin
  }
  actions.close()
  library.close()
  if (report.recording) { windowRoot.classList.add('report-open'); workspace.inert = true; return report.show() }
  opened(report)
}

// ——— Diagnostics (docs/specs/local-files.md, LF-21 to LF-23) ———

let diagnostics: Diagnostics = { file: false, report: false }
async function refreshDiagnostics() {
  if (!desktop) return
  try { diagnostics = await call('diagnostics_state') } catch { return }
  update()
}

/** While the recording runs, the panel says so on every show, apart from errors and edit hints. */
function showStatus() {
  const parts: (Node | string)[] = []
  if (diagnostics.report) {
    const finish = el('button', '', 'Finish recording')
    finish.type = 'button'
    finish.addEventListener('mousedown', event => event.preventDefault())
    finish.addEventListener('click', () => { void call('report_record', { on: false }).then(() => { report.recorded(); openRecorded() }) })
    parts.push('Recording for a problem report · ', finish)
  }
  if (diagnostics.file) parts.push(parts.length ? ' · ' : '', 'Diagnostics on · diagnostics.json turns it off')
  statusSlot.replaceChildren(...parts)
  statusSlot.hidden = !parts.length
}

/** The report after a recording; a palette opened while it ran gives way, as in openReport. */
function openRecorded() {
  actions.close()
  library.close()
  windowRoot.classList.remove('library-open', 'actions-open')
  windowRoot.classList.add('report-open')
  workspace.inert = true
}

/** The last combination with ⌘ or ⌃, never typed text: a modifier set and a key name (LF-22). */
function recordCombination(event: KeyboardEvent) {
  if (!desktop || !(diagnostics.file || diagnostics.report) || !(event.metaKey || event.ctrlKey) || event.repeat) return
  const key = event.code.replace(/^(Key|Digit)/u, '')
  if (!key || /^(Meta|Control|Shift|Alt|OS)(Left|Right)?$/u.test(key)) return
  const mods = (event.ctrlKey ? '⌃' : '') + (event.altKey ? '⌥' : '') + (event.shiftKey ? '⇧' : '') + (event.metaKey ? '⌘' : '')
  void call('diagnostics_key', { combination: mods + key }).catch(() => {})
}

// ——— Copy and hide ———

/** Hides the window, but never with an unsaved draft: the text would be lost. */
async function hide(copied = false, reason: 'esc' | 'copy' = 'esc') {
  // Hiding without a copy means the user kept this prompt: the next launch must not select it again.
  chain.copied = copied
  if (save(true) && desktop) await call('hide_launcher', { reason }).catch(fail)
}

/** Copies the whole prompt. A copy on a diff accepts the edit; `clear` then starts an empty prompt. */
async function copy(clear = false) {
  if (busy || !chain.text.trim()) return
  actions.close()
  library.close()
  error = ''
  try {
    if (desktop) await call('copy_text', { text: chain.text })
    else await navigator.clipboard.writeText(chain.text)
  } catch (e) { return fail(e) }
  if (clear) chain.reset('')
  if (clear || (chain.diff && chain.forward())) show()
  if (desktop) await hide(!clear, 'copy')
  else { chain.copied = !clear; if (save(true)) notify('Copied') }
}

// ——— Keys ———

document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return
  recordCombination(event)
  const stop = (action: () => unknown) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) void action()
  }
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return stop(() => report.isOpen ? report.close() : actions.isOpen ? actions.close() : library.isOpen ? library.close() : busy ? cancel() : hide())
  }
  // Tab moves between the prompt and a button in the hint line, and back: WebKit's own Tab order skips buttons.
  const hinted = event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && !workspace.inert
    ? hintSlot.querySelector('button') : null
  if (hinted) {
    const inHint = hintSlot.contains(document.activeElement)
    if (inHint || $('editor').contains(document.activeElement)) return stop(() => inHint ? editor.focus() : hinted.focus())
  }
  if (!event.metaKey || event.ctrlKey || event.altKey) return
  // ⌘, opens the settings window, from any view of the panel (SUSI-12).
  if (!event.shiftKey && event.code === 'Comma' && desktop) return stop(() => call('prefs_open', { pane: null }).catch(fail))
  const code = event.code
  if (report.isOpen) return code === 'Enter' || code === 'NumpadEnter' ? stop(() => report.submit()) : undefined
  if (!event.shiftKey && code === 'KeyK') return stop(() => actions.isOpen ? actions.close() : openActions())
  if (!event.shiftKey && code === 'KeyL') return stop(() => library.isOpen ? library.close() : openLibrary())
  if (code === 'Enter' || code === 'NumpadEnter') return stop(() => workspace.inert || copy(event.shiftKey))
  if (!chain.review || busy || workspace.inert) return
  const back = !event.shiftKey && (code === 'ArrowLeft' || code === 'KeyZ')
  const forward = (!event.shiftKey && code === 'ArrowRight') || (event.shiftKey && code === 'KeyZ')
  if (back && chain.canBack) stop(() => navigate(false))
  else if (forward && chain.canForward) stop(() => navigate(true))
  else if (back || forward) event.preventDefault()
}, true)

actionButton.addEventListener('click', () => busy ? cancel() : openActions())
libraryButton.addEventListener('click', openLibrary)
copyButton.addEventListener('click', () => copy())
previousButton.addEventListener('click', () => navigate(false))
nextButton.addEventListener('click', () => navigate(true))
for (const button of [actionButton, libraryButton, copyButton, previousButton, nextButton])
  button.addEventListener('mousedown', event => event.preventDefault())
for (const node of document.querySelectorAll<HTMLElement>('[data-icon]')) node.replaceWith(icon(node.dataset.icon!))

// ——— Window lifecycle ———

function refocus() {
  if (report.isOpen) report.focus()
  else if (actions.isOpen) actions.focus()
  else if (library.isOpen) library.focus()
  else if (!busy) editor.focus()
}
window.addEventListener('focus', () => { refocus(); void loadSettings() })
window.addEventListener('pagehide', () => save(true))
document.addEventListener('visibilitychange', () => { if (document.hidden) save(true) })

/** After a copy the next prompt starts fresh: typing replaces the selection, → or a click keeps editing. */
function selectAfterCopy(shown: boolean) {
  if (!chain.copied || workspace.inert) return
  editor.selectAll()
  // A hidden cold start must not use up the flag: only a real launcher-shown clears it.
  if (!shown) return
  chain.copied = false
  save(true)
}

editor.show(chain.text, chain.before)
update()
editor.focus()
// The first launcher-shown can fire before the listener below is registered.
selectAfterCopy(false)
if (desktop) {
  void loadSettings()
  void on('launcher-shown', () => {
    selectAfterCopy(true)
    refocus()
    void loadSettings()
    void refreshDiagnostics()
  })
  void on('report-open', payload => openReport(payload?.origin ?? 'menu'))
  void on('report-recording', recording => {
    void refreshDiagnostics()
    if (!recording && report.recording) { report.recorded(); openRecorded() }
  })
  void refreshDiagnostics()
  call('startup_notes').then(message => { if (message) fail(message) }).catch(fail)
  void on('startup-notes', fail)
}
