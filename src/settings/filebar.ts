// Every pane names its file: a quiet line under all the controls of that file with Show in Finder and
// Open in editor, and, when something is wrong with the file, a banner that says what, what Sushi
// does meanwhile, and the way out.
import type { FileName } from '../bindings/FileName'
import type { FileState } from '../bindings/FileState'
import type { Prefs } from '../bindings/Prefs'
import { call } from '../ipc'
import { icon } from './icons'
import type { Slot } from './store'
import { banner, button, chevron, h } from './ui'

/** What each file is to the user, what Sushi does while it is broken, and what its defaults are. */
const FILES: Record<FileName, { feature: string; meanwhile: string; recover: string; restore: string; confirm: string; confirmButton: string }> = {
  'rules.json': {
    feature: 'Actions couldn’t be loaded.',
    meanwhile: 'Sushi keeps using the actions it read before.',
    recover: 'Restore the defaults, or fix the settings file.',
    restore: 'Restore default actions…',
    confirm: 'Replace your actions with Sushi’s defaults?',
    confirmButton: 'Restore defaults',
  },
  'dictionary.json': {
    feature: 'The dictionary couldn’t be loaded.',
    meanwhile: 'The Library keeps the terms it read before.',
    recover: 'Restore the defaults, or fix the settings file.',
    restore: 'Restore default dictionary…',
    confirm: 'Replace your terms with Sushi’s defaults?',
    confirmButton: 'Restore defaults',
  },
  'hotkey.json': {
    feature: 'The shortcut settings couldn’t be loaded.',
    meanwhile: '',
    recover: 'Restore the defaults (Caps Lock, with ⌃⇧Space as the backup), or fix the settings file.',
    restore: 'Restore default shortcut…',
    confirm: 'Go back to Caps Lock and ⌃⇧Space?',
    confirmButton: 'Restore defaults',
  },
  'model.json': {
    feature: 'The model settings couldn’t be loaded.',
    meanwhile: 'Edits are stopped until it is fixed.',
    recover: 'Restore the default, which runs edits with Ollama on this Mac, or fix the settings file.',
    restore: 'Restore default model…',
    confirm: 'Run edits with Ollama on this Mac again? Your providers stay connected.',
    confirmButton: 'Use Ollama',
  },
  'diagnostics.json': {
    feature: 'The logging setting couldn’t be loaded.',
    meanwhile: '',
    recover: 'Restore the default, which is logging off, or fix the settings file.',
    restore: 'Turn logging off…',
    confirm: 'Go back to the default, with logging off?',
    confirmButton: 'Turn logging off',
  },
  'library-path.txt': {
    feature: 'The library folder setting couldn’t be loaded.',
    meanwhile: '',
    recover: 'Restore the default folder, or fix the settings file.',
    restore: 'Use the default folder…',
    confirm: 'Read the library from the default folder again?',
    confirmButton: 'Use default folder',
  },
}
/** Files Sushi runs fine without. */
const OPTIONAL = new Set<FileName>(['hotkey.json', 'model.json', 'library-path.txt', 'diagnostics.json'])

export let reportError: (e: unknown) => void = e => console.error(e)
export function onError(handler: (e: unknown) => void) { reportError = handler }
export const message = (e: unknown) => e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)

export async function fileAction(name: FileName, action: 'reveal' | 'edit') {
  try { await call('prefs_file', { name, action }) } catch (e) { reportError(e) }
}

const slug = (name: FileName) => name.replace(/[^a-z]+/g, '-')

export class FileBar<P> {
  readonly root: HTMLElement
  private readonly label: HTMLElement
  private readonly name: HTMLElement
  private readonly edit: HTMLButtonElement
  private readonly reveal: HTMLButtonElement

  constructor(private readonly slot: Slot<P>, id: string) {
    this.name = h('span', { class: 'file-name' })
    this.label = h('span', { class: 'file-state' })
    this.edit = button({ label: 'Open in editor', kind: 'quiet', id: `${id}-file-edit`, onClick: () => fileAction(this.slot.file.name, 'edit') })
    this.reveal = button({ label: 'Show in Finder', kind: 'quiet', id: `${id}-file-reveal`, onClick: () => fileAction(this.slot.file.name, 'reveal') })
    this.root = h('div', { class: 'file-bar' }, icon('docs'), this.name, this.label, h('span', { class: 'spacer' }), this.reveal, this.edit)
    slot.subscribe(() => this.update())
  }

  update() {
    const file = this.slot.file
    this.name.textContent = file.name
    this.root.setAttribute('aria-label', 'Settings file ' + file.name)
    const state = file.status === 'invalid' ? 'Needs fixing' : file.status === 'unreadable' ? 'Cannot be read'
      : file.status === 'linked' ? 'A link' : file.status === 'absent' ? (OPTIONAL.has(file.name) ? 'Using defaults' : 'Not created yet') : ''
    this.label.textContent = state
    this.label.className = 'file-state ' + file.status
    // The banner of a file that is not ok carries these buttons itself.
    this.edit.hidden = this.reveal.hidden = file.status === 'invalid' || file.status === 'unreadable' || file.status === 'linked'
    this.edit.disabled = file.status === 'absent'
    this.edit.title = file.status === 'absent' ? 'There is no file: Sushi uses its defaults.' : ''
  }
}

/** Error details: the validator's exact words, behind a disclosure. */
function details(id: string, text: string) {
  const node = h('details', { class: 'error-details' },
    h('summary', { id }, chevron(false), h('span', { text: 'Error details' })),
    h('code', { class: 'message', text }))
  node.addEventListener('toggle', () => node.querySelector('summary')!.firstElementChild!.replaceWith(chevron(node.open)))
  return node
}

/**
 * The banner of a file that is not simply ok: a conflict with a draft, a failed save, an invalid,
 * unreadable or linked file. `reset` receives what prefs_reset returned.
 */
export function fileNotice<P>(slot: Slot<P>, o: {
  resave: () => void
  reset: (prefs: Prefs) => void
  /** "Actions": the subject of the conflict line. */
  subject: string
  /** One line on what differs between the file and the draft. */
  difference?: () => string | null
  /** What Sushi does while the file is invalid, from the state the pane carries; replaces the generic sentence. */
  meanwhile?: string
  /** The conflict's second button and its sentence, when it does something else than writing a draft. */
  replace?: { label: string; text: string }
}): HTMLElement | null {
  const file: FileState = slot.file
  const id = slug(file.name)
  if (slot.conflict) {
    const difference = o.difference?.()
    return banner({
      tone: 'warning', title: `${o.subject} changed outside Settings.`,
      detail: h('span', {}, o.replace?.text ?? 'Your edits are not saved. Choose which version to keep.',
        difference ? h('span', { class: 'difference' }, h('br'), difference) : null),
      actions: [
        button({ label: 'Use the file’s version', id: `${id}-use-file`, onClick: () => slot.useFile() }),
        button({ label: o.replace?.label ?? 'Replace with my version', id: `${id}-keep-mine`, onClick: () => slot.keepMine(o.resave) }),
      ],
    })
  }
  const open = [
    button({ label: 'Open settings file…', id: `${id}-banner-edit`, onClick: () => fileAction(file.name, 'edit') }),
    button({ label: 'Show in Finder', id: `${id}-banner-reveal`, onClick: () => fileAction(file.name, 'reveal') }),
  ]
  if (file.status === 'invalid') {
    const copy = FILES[file.name]
    const actions = h('div', { class: 'banner-actions' })
    const error = h('div', { class: 'field-error', role: 'alert', id: `${id}-reset-error` })
    error.hidden = true
    const trigger = button({ label: copy.restore, id: `${id}-restore`, onClick: () => ask() })
    const first = () => { actions.replaceChildren(trigger, ...open) }
    const cancel = () => { first(); trigger.focus() }
    const ask = () => {
      const yes = button({ label: copy.confirmButton, kind: 'primary', id: `${id}-restore-yes`, onClick: run })
      actions.replaceChildren(
        h('div', { class: 'confirm' },
          h('div', { class: 'confirm-title', text: copy.confirm }),
          h('div', { class: 'confirm-text', text: 'A copy of the current file is kept in the settings folder.' })),
        button({ label: 'Cancel', id: `${id}-restore-cancel`, onClick: cancel }),
        yes)
      yes.focus()
    }
    actions.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !actions.querySelector('.confirm')) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    })
    const run = async () => {
      error.hidden = true
      try { o.reset(await call('prefs_reset', { name: file.name, revision: file.revision })) } catch (e) {
        // Rust refuses with a plain sentence: the file changed again, or it is no longer invalid.
        error.textContent = message(e)
        error.hidden = false
        cancel()
      }
    }
    first()
    return banner({
      tone: 'error', title: copy.feature,
      detail: h('div', {}, h('div', { text: [o.meanwhile ?? copy.meanwhile, copy.recover].filter(Boolean).join(' ') }), details(`${id}-details`, file.message ?? '')),
      actions: [actions, error],
    })
  }
  if (file.status === 'unreadable') {
    return banner({
      tone: 'error', title: `Sushi cannot read ${file.name}.`,
      detail: h('div', {}, h('div', { text: 'Check the file’s permissions in Finder. The other settings keep working.' }), details(`${id}-details`, file.message ?? '')),
      actions: open,
    })
  }
  if (file.status === 'linked') {
    // Rust's sentence about the link, then the validator's message when the file it points to has a problem.
    const problem = (file.message ?? '').split('Edit it where it points.')[1]?.trim()
    return banner({
      tone: problem ? 'error' : 'note', title: 'These settings are managed in another file.',
      detail: h('div', {}, h('div', { text: `${file.name} is a link to it. Edit the original file to change them.${problem ? ` It has a problem, so Sushi cannot use it as it is.${(o.meanwhile ?? FILES[file.name].meanwhile) ? ' ' + (o.meanwhile ?? FILES[file.name].meanwhile) : ''}` : ''}` }),
        problem ? details(`${id}-details`, problem) : null),
      actions: [
        button({ label: 'Edit original file…', id: `${id}-banner-edit`, onClick: () => fileAction(file.name, 'edit') }),
        button({ label: 'Show link in Finder', id: `${id}-banner-reveal`, onClick: () => fileAction(file.name, 'reveal') }),
      ],
    })
  }
  if (slot.failure) return banner({ tone: 'error', title: 'The last change was not saved.', detail: slot.failure })
  return null
}
