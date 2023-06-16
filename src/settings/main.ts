// The settings window: a sidebar of five panes over the settings files. Every read comes from
// prefs_load, every write goes through a Slot (store.ts), and nothing outlives a focus but drafts.
import '../tokens.css'
import './settings.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { FileName } from '../bindings/FileName'
import type { PaneId } from '../bindings/PaneId'
import type { Prefs } from '../bindings/Prefs'
import { call, on } from '../ipc'
import { message, onError } from './filebar'
import { icon } from './icons'
import { PANES, type Context, type Pane } from './pane'
import { AboutSettings } from './panes/about'
import { ActionsSettings } from './panes/actions'
import { KeyboardSettings } from './panes/keyboard'
import { LibrarySettings } from './panes/library'
import { ModelSettings } from './panes/model'
import { Slot } from './store'
import { button, h, redraw, toast, undoLast } from './ui'

const NAV: Record<PaneId, { title: string; icon: string }> = {
  keyboard: { title: 'Keyboard', icon: 'keyboard' },
  model: { title: 'Model', icon: 'model' },
  actions: { title: 'Actions', icon: 'action' },
  library: { title: 'Library', icon: 'library' },
  about: { title: 'About', icon: 'about' },
}

const $ = (id: string) => document.getElementById(id)!
const nav = $('nav'), paneSlot = $('pane'), title = $('pane-title'), paneState = $('pane-state'), live = $('live')
const error = (e: unknown) => toast(message(e))
onError(error)

interface Slots {
  hotkey: Slot<Prefs['keyboard']>
  model: Slot<Prefs['model']>
  rules: Slot<Prefs['actions']>
  folder: Slot<Prefs['library']>
  dictionary: Slot<Prefs['library']>
  diagnostics: Slot<Prefs['about']>
}
let slots: Slots | null = null
let panes: Record<PaneId, Pane> | null = null
/** The files of each pane; a pane with more than one names the section in its status. */
const paneSlots = (id: PaneId, s: Slots): [Slot<unknown>, string][] => ({
  keyboard: [[s.hotkey, 'Shortcut settings']], model: [[s.model, 'Model settings']], actions: [[s.rules, 'Actions']],
  library: [[s.folder, 'Library folder'], [s.dictionary, 'Dictionary']], about: [[s.diagnostics, 'Logging setting']],
} as Record<PaneId, [Slot<unknown>, string][]>)[id]

/** Which part of a load each slot takes. */
const parts = (prefs: Prefs) => ({
  hotkey: prefs.keyboard, model: prefs.model, rules: prefs.actions,
  folder: prefs.library, dictionary: prefs.library, diagnostics: prefs.about,
})

let announceTimer = 0
const context: Context = {
  applyReset(prefs: Prefs, name: FileName) {
    if (!slots) return
    const fresh = parts(prefs)
    for (const [key, slot] of Object.entries(slots) as [keyof Slots, Slot<never>][]) {
      const pane = fresh[key] as never
      slot.reload(pane, slot.epoch, slot.host.file(pane).name === name)
    }
  },
  reload: () => load(),
  error,
  announce(text: string) {
    live.textContent = ''
    clearTimeout(announceTimer)
    announceTimer = window.setTimeout(() => { live.textContent = text }, 30)
  },
}

// ——— Loading: on open, on every focus of the window, on prefs-changed ———

let loads = 0
async function load() {
  const ticket = ++loads
  const epochs = slots && Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, s.epoch])) as Record<keyof Slots, number>
  let prefs: Prefs
  try {
    prefs = await call('prefs_load')
  } catch (e) {
    if (!slots) showFailure(e)
    else error(e)
    return
  }
  if (ticket !== loads) return
  const fresh = parts(prefs)
  if (!slots) {
    slots = {
      hotkey: new Slot(fresh.hotkey), model: new Slot(fresh.model), rules: new Slot(fresh.rules),
      folder: new Slot(fresh.folder), dictionary: new Slot(fresh.dictionary), diagnostics: new Slot(fresh.diagnostics),
    }
    panes = {
      keyboard: new KeyboardSettings(slots.hotkey, context),
      model: new ModelSettings(slots.model, context),
      actions: new ActionsSettings(slots.rules, context),
      library: new LibrarySettings(slots.folder, slots.dictionary, context),
      about: new AboutSettings(slots.diagnostics, context),
    }
    for (const pane of Object.values(panes)) {
      const draw = pane.render.bind(pane)
      pane.render = () => { keepFocus(pane.root, draw); updateDots(); if (pane.id === current) updateState() }
    }
    for (const slot of Object.values(slots)) slot.subscribe(() => { updateState(); updateDots() })
    show(current, false)
    return
  }
  for (const [key, slot] of Object.entries(slots) as [keyof Slots, Slot<never>][]) slot.reload(fresh[key] as never, epochs![key])
}

function showFailure(e: unknown) {
  title.textContent = 'Settings'
  paneSlot.replaceChildren(h('div', { class: 'failure' },
    icon('error'),
    h('div', { class: 'empty-title', text: 'Sushi could not read its settings.' }),
    h('code', { class: 'message', text: message(e) }),
    button({ label: 'Try again', kind: 'primary', id: 'retry', onClick: () => load() })))
}

/** Redraws keep the focused control: the new one with the same id takes the focus and the selection. */
function keepFocus(root: HTMLElement, draw: () => void) {
  const active = document.activeElement as HTMLElement | null
  const inside = !!active && root.contains(active)
  const id = inside ? active!.id : ''
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
  const range = field ? [field.selectionStart, field.selectionEnd] : null
  const scroll = paneSlot.scrollTop
  redraw(draw)
  paneSlot.scrollTop = scroll
  if (!inside || active!.isConnected) return
  const next = id ? document.getElementById(id) : null
  if (next && root.contains(next) && !(next as HTMLButtonElement).disabled) {
    next.focus({ preventScroll: true })
    if (range && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) next.setSelectionRange(range[0], range[1])
  } else paneSlot.focus({ preventScroll: true })
}

// ——— The pane's state, in the header: problems stay, "Saved" shows briefly after a save ———

let fadeTimer = 0
function updateState() {
  if (!slots) return
  const own = paneSlots(current, slots)
  const scoped = (section: string, plain: string) => own.length > 1 || current === 'about' ? `${section} needs attention` : plain
  let tone = '', text = '', glyph = ''
  for (const [slot, section] of own) {
    const status = slot.file.status
    if (slot.conflict) { tone = 'problem'; glyph = 'warning'; text = scoped(section, 'Changed outside Settings'); break }
    if (status === 'invalid' || status === 'unreadable') { tone = 'broken'; glyph = 'error'; text = scoped(section, status === 'invalid' ? 'Needs fixing' : 'Cannot be read'); break }
    if (slot.state === 'failed' || slot.state === 'unsaved') { tone = 'problem'; glyph = 'warning'; text = scoped(section, 'Not saved'); break }
  }
  if (!text && own.some(([slot]) => slot.busy)) { tone = 'saving'; glyph = 'spinner'; text = 'Saving…' }
  const recent = Math.max(...own.map(([slot]) => slot.savedAt))
  if (!text && Date.now() - recent < 1800) {
    tone = 'saved'; glyph = 'check'; text = 'Saved'
    clearTimeout(fadeTimer)
    fadeTimer = window.setTimeout(updateState, 1800 - (Date.now() - recent))
  }
  if (!text) { paneState.replaceChildren(); paneState.className = 'pane-state'; return }
  if (paneState.dataset.text === text && paneState.classList.contains(tone)) return
  paneState.dataset.text = text
  paneState.className = 'pane-state ' + tone
  paneState.replaceChildren(icon(glyph), h('span', { text }))
}

/** A dot beside each pane that holds something not in its file yet. */
function updateDots() {
  if (!panes) return
  for (const id of PANES) {
    const item = $('nav-' + id)
    const pending = panes[id].pending()
    item.classList.toggle('pending', pending)
    item.setAttribute('aria-label', NAV[id].title + (pending ? ', has unsaved changes' : ''))
  }
}

// ——— Navigation ———

const fromHash = (): PaneId => {
  const id = location.hash.slice(1) as PaneId
  return PANES.includes(id) ? id : 'keyboard'
}
let current: PaneId = fromHash()
/** Each pane comes back where it was left. */
const scrolls = new Map<PaneId, number>()

for (const [i, id] of PANES.entries()) {
  const item = h('button', { type: 'button', class: 'nav-item', id: 'nav-' + id, title: `${NAV[id].title} (⌘${i + 1})` },
    icon(NAV[id].icon), h('span', { text: NAV[id].title }), h('span', { class: 'dot', 'aria-hidden': 'true' }))
  // A click focuses the item, as a sidebar does on macOS, so the arrow keys go on from there.
  item.addEventListener('click', () => { item.focus(); show(id) })
  nav.append(h('li', {}, item))
}
// ↑ ↓ move between the sidebar's items, Home and End to the ends.
nav.addEventListener('keydown', event => {
  const items = [...nav.querySelectorAll<HTMLButtonElement>('.nav-item')]
  const at = items.indexOf(document.activeElement as HTMLButtonElement)
  if (at < 0) return
  const to = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -2
  if (to === -2) return
  event.preventDefault()
  const item = items[Math.max(0, Math.min(items.length - 1, to))]
  item.focus()
  item.click()
})

function show(id: PaneId, focus = true) {
  if (panes && id !== current) {
    panes[current].leave?.()
    scrolls.set(current, paneSlot.scrollTop)
  }
  current = id
  for (const item of nav.querySelectorAll('.nav-item')) {
    if (item.id === 'nav-' + id) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  title.textContent = NAV[id].title
  document.title = `${NAV[id].title} · Sushi settings`
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id)
  if (!panes) return
  const pane = panes[id]
  paneSlot.replaceChildren(pane.root)
  pane.render()
  paneSlot.scrollTop = scrolls.get(id) ?? 0
  paneSlot.setAttribute('aria-labelledby', 'pane-title')
  document.querySelector('.pane-header')!.classList.toggle('scrolled', paneSlot.scrollTop > 2)
  paneState.dataset.text = ''
  updateState()
  if (focus && !nav.contains(document.activeElement)) paneSlot.focus({ preventScroll: true })
}
show(current, false)

paneSlot.addEventListener('scroll', () => document.querySelector('.pane-header')!.classList.toggle('scrolled', paneSlot.scrollTop > 2))

const typing = (node: Element | null) => node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ||
  (node instanceof HTMLInputElement && !['button', 'checkbox', 'radio'].includes(node.type))

window.addEventListener('keydown', event => {
  if (event.defaultPrevented) return
  const command = event.metaKey && !event.ctrlKey && !event.altKey
  if (command && !event.shiftKey && /^Digit[1-5]$/.test(event.code)) {
    event.preventDefault()
    show(PANES[Number(event.code.slice(5)) - 1])
    document.getElementById('nav-' + current)?.focus()
    return
  }
  if (command && !event.shiftKey && event.code === 'KeyW') {
    event.preventDefault()
    // Closing is intercepted natively: the window hides and the app the user came from is active again.
    getCurrentWindow().close().catch(error)
    return
  }
  // ⌘Z outside a text field takes back the latest delete; inside one it stays the field's own undo.
  if (command && !event.shiftKey && event.code === 'KeyZ' && !typing(document.activeElement)) {
    if (undoLast()) event.preventDefault()
    return
  }
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (panes?.[current].escape?.()) event.preventDefault()
  }
})
window.addEventListener('hashchange', () => { if (fromHash() !== current) show(fromHash()) })
window.addEventListener('focus', () => { void load() })
void on('prefs-changed', ({ file }) => {
  for (const pane of Object.values(panes ?? {})) pane.external?.(file)
  void load()
})
void on('prefs-pane', id => { if (PANES.includes(id)) show(id) })
void load()
