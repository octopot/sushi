// The controls of the settings window: rows, cards, buttons, a switch, a segmented control, a select,
// chips and a toast. Plain DOM; every control carries an accessible name.
import { keys } from '../icons'
import { icon } from './icons'

let redrawing = 0
/** A pane is being drawn again: the blur and change of the controls it removes are not the user's. */
export const drawing = () => redrawing > 0
export function redraw(draw: () => void) {
  redrawing++
  try { draw() } finally { redrawing-- }
}

/**
 * Runs a commit that a blur or a change started once the focus has moved, so the redraw it causes
 * finds the control the user went to and gives it the focus back.
 */
export function afterFocus(commit: () => void) {
  if (drawing()) return
  // A redraw between a press and its release would take the clicked control away: wait for the click.
  if (pressed) waiting.push(commit)
  else setTimeout(commit, 0)
}
let pressed = false
const waiting: (() => void)[] = []
window.addEventListener('pointerdown', () => { pressed = true }, true)
const release = () => {
  pressed = false
  // After the click the release causes, which comes in the same task.
  for (const commit of waiting.splice(0)) setTimeout(commit, 0)
}
window.addEventListener('pointerup', release, true)
window.addEventListener('pointercancel', release, true)

type Child = Node | string | null | undefined | false
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: { class?: string; text?: string; [attr: string]: string | boolean | undefined } = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (name === 'class') node.className = value as string
    else if (name === 'text') node.textContent = value as string
    else node.setAttribute(name, value === true ? '' : value)
  }
  for (const child of children) if (child) node.append(child)
  return node
}

export { keys }

export interface ButtonOptions {
  label: string
  icon?: string
  /** primary: the one thing to do here; quiet: a link-like text button; icon: an icon alone. */
  kind?: 'plain' | 'primary' | 'quiet' | 'danger' | 'icon'
  /** For an icon button or a label that needs more words for VoiceOver. */
  aria?: string
  title?: string
  disabled?: boolean
  busy?: boolean
  onClick?: (event: MouseEvent) => void
  /** Stable across redraws, so the focus can come back to the new button. */
  id?: string
}
export function button(o: ButtonOptions): HTMLButtonElement {
  const node = h('button', { type: 'button', id: o.id, class: 'btn ' + (o.kind === 'icon' ? 'icon-only' : o.kind ?? 'plain'), 'aria-label': o.aria, title: o.title ?? (o.kind === 'icon' ? o.label : undefined) })
  if (o.busy) node.append(icon('spinner'))
  else if (o.icon) node.append(icon(o.icon))
  if (o.kind !== 'icon') node.append(h('span', { text: o.label }))
  else if (!o.aria) node.setAttribute('aria-label', o.label)
  node.disabled = !!o.disabled || !!o.busy
  if (o.busy) node.setAttribute('aria-busy', 'true')
  if (o.onClick) node.addEventListener('click', o.onClick)
  return node
}

export function switchControl(o: { label: string; checked: boolean; id: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  const node = h('button', { type: 'button', role: 'switch', id: o.id, class: 'switch', 'aria-label': o.label, 'aria-checked': String(o.checked) },
    h('span', { class: 'knob' }))
  node.disabled = !!o.disabled
  node.addEventListener('click', () => o.onChange(node.getAttribute('aria-checked') !== 'true'))
  return node
}

export interface Choice { value: string; label: string }

/** A row of mutually exclusive buttons; ← → move the choice, as a radio group does. */
export function segmented(o: { label: string; choices: Choice[]; value: string; id: string; disabled?: boolean; onChange: (value: string) => void }) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': o.label })
  const items = o.choices.map(choice => {
    const on = choice.value === o.value
    const item = h('button', { type: 'button', role: 'radio', id: `${o.id}-${choice.value}`, 'aria-checked': String(on), tabindex: on ? '0' : '-1', text: choice.label })
    item.disabled = !!o.disabled
    item.addEventListener('click', () => { if (!on) o.onChange(choice.value) })
    return item
  })
  group.addEventListener('keydown', event => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = items[(at + step + items.length) % items.length]
    next.focus()
    next.click()
  })
  group.append(...items)
  return group
}

/** A native popup menu dressed as Sushi's control: the system draws the menu itself. */
export function select(o: { label: string; choices: Choice[]; value: string; id: string; describedBy?: string; disabled?: boolean; onChange: (value: string) => void }) {
  const node = h('select', { 'aria-label': o.label, id: o.id, 'aria-describedby': o.describedBy })
  for (const choice of o.choices) node.append(h('option', { value: choice.value, text: choice.label }))
  node.value = o.value
  node.disabled = !!o.disabled
  node.addEventListener('change', () => o.onChange(node.value))
  return h('span', { class: 'select' }, node, icon('down'))
}

/** A setting: a label, an optional line that explains it, and its control on the right. */
export function row(o: { title: string; detail?: Child; control?: Child; class?: string; id?: string }) {
  return h('div', { class: 'row' + (o.class ? ' ' + o.class : ''), id: o.id },
    h('div', { class: 'row-text' },
      h('div', { class: 'row-title', text: o.title }),
      o.detail ? h('div', { class: 'row-detail' }, o.detail) : null),
    o.control ? h('div', { class: 'row-control' }, o.control) : null)
}

export const card = (...children: Child[]) => h('div', { class: 'card' }, ...children)

export function group(title: string | null, ...children: Child[]) {
  return h('section', { class: 'group' }, title ? h('h2', { class: 'group-title', text: title }) : null, ...children)
}

/** A message inside a pane: a problem, a conflict, a note. */
export function banner(o: { tone: 'warning' | 'error' | 'note'; title: string; detail?: Child; actions?: Child[]; label?: string }) {
  return h('div', { class: 'banner ' + o.tone, role: o.tone === 'note' ? 'note' : 'alert', 'aria-label': o.label },
    icon(o.tone === 'note' ? 'about' : o.tone === 'error' ? 'error' : 'warning'),
    h('div', { class: 'banner-text' },
      h('div', { class: 'banner-title', text: o.title }),
      o.detail ? h('div', { class: 'banner-detail' }, o.detail) : null,
      o.actions?.length ? h('div', { class: 'banner-actions' }, ...o.actions) : null))
}

/** Is the key press part of an input method's composition (Return picks a candidate then)? */
export const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229

/** A disclosure triangle: right when closed, down when open. */
export const chevron = (open: boolean) => icon(open ? 'down' : 'chevron')

export const fieldError = (message: string | null | undefined, id?: string) =>
  message ? h('div', { class: 'field-error', id, role: 'alert', text: message }) : null

// ——— The toast and Undo ———
// A delete offers Undo in the toast until the next operation on the same list, without a timer, and
// ⌘Z outside a text field takes back the latest delete. Other messages leave by themselves, but not
// while the pointer or the focus is on them.

interface Undo { scope: string; run(): void }
const undos: Undo[] = []
let toastTimer = 0
let toastScope: string | null = null

function slot() { return document.getElementById('toast')! }
export function closeToast() {
  clearTimeout(toastTimer)
  const node = slot()
  if (node.contains(document.activeElement)) document.getElementById('pane')?.focus({ preventScroll: true })
  node.hidden = true
  node.replaceChildren()
  toastScope = null
}

function show(message: string, extra: Node[], scope: string | null, ms: number | null) {
  closeToast()
  const node = slot()
  node.replaceChildren(h('span', { class: 'toast-text', text: message }), ...extra,
    button({ label: 'Dismiss', kind: 'icon', icon: 'close', id: 'toast-close', onClick: closeToast }))
  node.hidden = false
  toastScope = scope
  toastMs = ms
  if (ms === null) return
  if (!watched) {
    watched = true
    const hold = () => clearTimeout(toastTimer)
    node.addEventListener('pointerenter', hold)
    node.addEventListener('pointerleave', () => { if (!node.contains(document.activeElement)) arm() })
    node.addEventListener('focusin', hold)
    node.addEventListener('focusout', event => { if (!node.contains(event.relatedTarget as Node | null)) arm() })
  }
  arm()
}
let watched = false
let toastMs: number | null = null
function arm() {
  clearTimeout(toastTimer)
  if (toastMs !== null) toastTimer = window.setTimeout(closeToast, toastMs)
}

/** A message that needs no answer, such as an error with no field. */
export function toast(message: string, ms = 8000) { show(message, [], null, ms) }

/** A delete in `scope` (a list) that can be taken back. */
export function offerUndo(message: string, scope: string, run: () => void) {
  const undo: Undo = { scope, run }
  undos.push(undo)
  show(message, [button({ label: 'Undo', kind: 'quiet', id: 'toast-undo', onClick: () => takeBack(undo) })], scope, null)
}
function takeBack(undo: Undo) {
  const at = undos.indexOf(undo)
  if (at < 0) return
  undos.splice(at, 1)
  closeToast()
  undo.run()
}
/** ⌘Z: the latest delete comes back; false when there is none. */
export function undoLast(): boolean {
  const undo = undos.at(-1)
  if (!undo) return false
  takeBack(undo)
  return true
}
/** Another operation on the list: its Undo leaves the toast (⌘Z still takes the delete back). */
export function settle(scope: string) { if (toastScope === scope) closeToast() }
