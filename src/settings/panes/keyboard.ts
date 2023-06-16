// Keyboard (hotkey.json): Caps Lock or a keyboard shortcut, the recorder, what is in effect and why,
// and the panel's shortcuts as a reference.
import type { KeyboardPane } from '../../bindings/KeyboardPane'
import { call } from '../../ipc'
import { FileBar, fileNotice, message } from '../filebar'
import { icon } from '../icons'
import { canonical, display, glyphs, heldModifiers, isModifierCode, modifierGlyphs, spoken, type Modifier } from '../keys'
import type { Context, Pane } from '../pane'
import type { Slot } from '../store'
import { button, card, group, h, keys, row, segmented } from '../ui'

/** The panel's keys, grouped and worded as docs/content/guide/keyboard.mdx has them; a group may say when its keys apply. */
const REFERENCE: [string, string | null, [string[][], string][]][] = [
  ['In the panel', null, [
    [[['⌘', 'K']], 'Actions on the selection, or on the whole prompt'],
    [[['⌘', 'L']], 'The library: templates, prompts and dictionary'],
    [[['⌘', '↵']], 'Copy the prompt, hide Sushi, return to the previous app; on a diff, the copy accepts the edit'],
    [[['⇧', '⌘', '↵']], 'Copy the same, then start an empty prompt'],
    [[['⌘', ',']], 'Open Settings'],
    [[['Esc']], 'Close the open list; otherwise cancel a running edit; otherwise hide Sushi without copying'],
  ]],
  ['Versions', 'Right after an edit or a step, until you type.', [
    [[['⌘', '←'], ['⌘', 'Z']], 'One step back: from a diff to the text before it'],
    [[['⌘', '→'], ['⇧', '⌘', 'Z']], 'One step forward; on a diff, accept the edit'],
  ]],
  ['Actions list (⌘K)', null, [
    [[['↑'], ['↓']], 'Move through the list'],
    [[['↵']], 'Run the selected action or send your instruction'],
    [[['⌘', 'K'], ['Esc']], 'Close the list'],
  ]],
  ['Library (⌘L)', null, [
    [[['Tab'], ['⇧', 'Tab']], 'Next or previous section: All, Templates, Prompts, Dictionary'],
    [[['T'], ['P'], ['D']], 'On an empty field: jump to Templates, Prompts or Dictionary'],
    [[['1–9']], 'On an empty field: open the numbered entry'],
    [[['↑'], ['↓'], ['↵']], 'Choose and open an entry'],
    [[['⌘', 'L'], ['Esc']], 'Close the library'],
  ]],
]

interface Intent { capsLock: boolean; shortcut: string }
interface Recording {
  /** Physical keys down right now, by event.code. */
  pressed: Set<string>
  held: Modifier[]
  /** The first combination with a modifier and one key; it stays once taken. */
  candidate: string | null
  bare: boolean
}

/** The key that Caps Lock is remapped to while Sushi runs: never part of a shortcut. */
const REMAPPED = 'F18'

export class KeyboardSettings implements Pane {
  readonly id = 'keyboard'
  readonly title = 'Keyboard'
  readonly root = h('div', { class: 'pane-body' })
  private readonly bar: FileBar<KeyboardPane>
  /** The choice being saved, shown at once; kept through a conflict for Replace with my version. */
  private intent: Intent | null = null
  private error: string | null = null
  private recording: Recording | null = null
  private starting = false
  /** Bumped by every way a recording ends or is abandoned, so a capture that answers late knows it is too late. */
  private generation = 0
  private readonly teardown: (() => void)[] = []

  constructor(private readonly slot: Slot<KeyboardPane>, private readonly ctx: Context) {
    slot.host = {
      file: pane => pane.file,
      hasDraft: () => this.intent !== null,
      dropDraft: () => { this.intent = null; this.error = null },
      render: () => this.render(),
    }
    this.bar = new FileBar(slot, 'keyboard')
  }

  pending() { return this.intent !== null }

  private get value(): Intent {
    return this.intent ?? { capsLock: this.slot.pane.capsLock, shortcut: this.slot.pane.shortcut }
  }

  private save(intent: Intent, after?: () => void) {
    const before = this.value.shortcut
    this.intent = intent
    this.error = null
    const done = () => { if (this.intent === intent) this.intent = null }
    const fail = (reason: string) => {
      done()
      this.error = intent.shortcut !== before
        ? `Couldn’t use ${display(intent.shortcut)}. Your previous shortcut still works. ${reason}`
        : reason
    }
    // Rust's refusal of a combination it cannot register already says what happened and what works now.
    const failed = (reason: string) => { done(); this.error = reason }
    this.slot.save({
      key: 'hotkey',
      send: async revision => {
        try { return await call('prefs_keyboard_save', { revision, ...intent }) } finally { after?.() }
      },
      saved: done, invalid: fail, failed,
      matches: pane => pane.capsLock === intent.capsLock && pane.shortcut === intent.shortcut,
    })
    this.render()
  }

  render() {
    const pane = this.slot.pane
    const file = pane.file
    const writable = file.writable && !this.slot.conflict
    const { capsLock, shortcut } = this.value
    const notice = fileNotice(this.slot, {
      subject: 'The shortcut settings',
      resave: () => { if (this.intent) this.save(this.intent) },
      reset: prefs => this.ctx.applyReset(prefs, 'hotkey.json'),
      meanwhile: pane.effective ? `Meanwhile ${pane.effective === 'caps-lock' ? 'Caps Lock' : display(pane.effective)} shows Sushi.` : 'No key shows Sushi meanwhile.',
    })
    const capsWorks = capsLock && pane.effective === 'caps-lock'

    const choice = segmented({
      label: 'Show Sushi with', id: 'keyboard-mode', value: capsLock ? 'caps' : 'shortcut', disabled: !writable,
      choices: [{ value: 'caps', label: 'Caps Lock' }, { value: 'shortcut', label: 'Keyboard shortcut' }],
      onChange: value => this.save({ capsLock: value === 'caps', shortcut }),
    })
    const reset = button({
      label: 'Restore ' + display(pane.defaultShortcut), kind: 'icon', icon: 'reset', id: 'keyboard-reset',
      aria: 'Restore the default shortcut, ' + spoken(pane.defaultShortcut),
      disabled: !writable || shortcut === pane.defaultShortcut || !!this.recording,
      onClick: () => this.save({ capsLock, shortcut: pane.defaultShortcut }),
    })
    const broken = file.status === 'invalid' || file.status === 'unreadable'
    const form = broken ? card(this.status(pane)) : card(
      row({
        title: 'Show Sushi with',
        detail: capsWorks ? 'While Sushi runs, Caps Lock shows Sushi instead of switching capitals.' : undefined,
        control: choice,
      }),
      h('div', { class: 'recorder-block' + (capsWorks ? ' quiet' : '') },
        row({
          title: capsLock ? 'Backup shortcut' : 'Shortcut',
          detail: capsLock ? (capsWorks ? 'Used if Caps Lock is unavailable.' : 'In use now, because Caps Lock is unavailable.')
            : 'Press it anywhere on your Mac to show or hide Sushi.',
          control: h('div', { class: 'recorder-line' }, this.recorderButton(shortcut, writable), reset),
          class: 'recorder-row',
        }),
        this.hint()),
      this.status(pane),
    )
    this.root.replaceChildren(
      ...(notice ? [notice] : []),
      group(null, form, this.bar.root),
      group('Panel shortcuts', h('p', { class: 'lead', text: 'These shortcuts cannot be changed.' }), ...REFERENCE.map(([title, note, items]) => h('div', { class: 'reference' },
        h('h3', { class: 'reference-title', text: title }),
        note ? h('p', { class: 'reference-note', text: note }) : null,
        card(...items.map(([combos, text]) => h('div', { class: 'reference-row' },
          h('span', { class: 'reference-text', text }),
          h('span', { class: 'reference-keys' }, ...combos.flatMap((combo, i) => [i ? h('span', { class: 'or', text: 'or' }) : null, keys(...combo)]))))),
      ))),
    )
    this.bar.update()
  }

  /** The line under the recorder: what to do while recording, or why the last shortcut was not used. */
  private hint(): HTMLElement {
    const node = h('div', { class: 'recorder-hint', id: 'keyboard-hint', 'aria-live': 'polite' })
    const r = this.recording
    if (r?.candidate) node.append('Release all keys to finish.')
    else if (r?.bare) { node.classList.add('error'); node.append('Hold Control, Option, Shift or Command with another key.') }
    else if (r) node.append(keys('esc'), ' to cancel')
    else if (this.error) { node.classList.add('error'); node.setAttribute('role', 'alert'); node.append(this.error) }
    else node.hidden = true
    return node
  }

  /** One compact line: what shows Sushi right now and, when it is not the chosen key, the cause first. */
  private status(pane: KeyboardPane): HTMLElement {
    const caps = (key: string) => key === 'caps-lock' ? keys('Caps Lock') : keys(...glyphs(key))
    const problem = pane.problem
    const tone = pane.effective === null ? 'error' : problem ? 'warning' : 'ok'
    const text = h('div', { class: 'status-text' })
    if (!problem && pane.effective) {
      text.append(h('div', { class: 'status-title' }, caps(pane.effective), ' shows Sushi.'))
    } else {
      const cause = problem?.kind === 'input-sources' ? 'Caps Lock is used to switch input sources.' : problem?.message ?? 'No shortcut shows Sushi right now.'
      text.append(h('div', { class: 'status-title', text: cause }))
      const detail = h('div', { class: 'status-detail' })
      if (pane.effective) detail.append('Use ', caps(pane.effective), ' to show Sushi.')
      // One sentence flow: "To use Caps Lock, turn off …"; Sushi tries Caps Lock again when Settings comes back.
      if (problem?.advice) detail.append(' ', problem.kind === 'input-sources'
        ? 'To use Caps Lock, ' + problem.advice.charAt(0).toLowerCase() + problem.advice.slice(1)
        : problem.advice)
      if (detail.childNodes.length) text.append(detail)
      if (problem?.kind === 'input-sources') text.append(h('div', { class: 'status-actions' },
        button({ label: 'Open macOS keyboard settings…', id: 'keyboard-settings', onClick: () => call('prefs_action', { action: 'keyboard-settings', provider: null }).catch(e => this.ctx.error(e)) })))
    }
    return h('div', { class: 'status-line ' + tone, role: 'status', 'aria-label': 'In effect' },
      icon(tone === 'ok' ? 'check' : tone === 'warning' ? 'warning' : 'error'), text)
  }

  // ——— The recorder ———

  private recorderButton(shortcut: string, writable: boolean): HTMLButtonElement {
    const node = h('button', { type: 'button', id: 'keyboard-recorder', class: 'recorder', 'aria-describedby': 'keyboard-hint' })
    node.disabled = !writable || this.starting
    const r = this.recording
    if (r) {
      node.classList.add('recording')
      node.setAttribute('aria-label', 'Recording a shortcut. Press the keys, or Escape to cancel.')
      const caps = r.candidate ? glyphs(r.candidate) : modifierGlyphs(r.held)
      node.append(caps.length ? keys(...caps) : h('span', { class: 'recorder-prompt', text: 'Press a shortcut…' }))
    } else {
      node.setAttribute('aria-label', `Shortcut: ${spoken(shortcut)}. Press to change it.`)
      node.append(keys(...glyphs(shortcut)), h('span', { class: 'recorder-change', text: 'Change…' }))
    }
    node.addEventListener('click', () => { if (!this.recording) void this.start() })
    return node
  }

  /** Redraws only the recorder and its hint, so the focus and the pane stay where they are. */
  private refresh() {
    const old = this.root.querySelector('#keyboard-recorder')
    if (!old) return this.render()
    const next = this.recorderButton(this.value.shortcut, true)
    old.replaceWith(next)
    next.focus()
    this.root.querySelector('#keyboard-hint')?.replaceWith(this.hint())
    const reset = this.root.querySelector<HTMLButtonElement>('#keyboard-reset')
    if (reset) reset.disabled = !!this.recording || this.value.shortcut === this.slot.pane.defaultShortcut
  }

  private async start() {
    if (this.starting || this.recording) return
    const generation = ++this.generation
    this.starting = true
    this.error = null
    // Leaving the window or the pane while the capture is being turned on abandons the start.
    const abandon = () => { if (this.generation === generation) { this.generation++; this.starting = false } }
    window.addEventListener('blur', abandon, { once: true })
    try {
      // The key that shows Sushi is paused first; until it is, the page does not pretend to record.
      await call('prefs_capture', { on: true })
    } catch (e) {
      window.removeEventListener('blur', abandon)
      if (this.generation !== generation) return
      this.starting = false
      // Rust says why it could not pause the key; its sentence is shown as it is.
      this.error = message(e)
      this.render()
      this.root.querySelector<HTMLElement>('#keyboard-recorder')?.focus()
      return
    }
    window.removeEventListener('blur', abandon)
    if (this.generation !== generation) {
      // Too late: the user left meanwhile. The capture goes off again and the recorder stays idle.
      void call('prefs_capture', { on: false }).catch(e => this.ctx.error(e))
      return
    }
    this.starting = false
    this.recording = { pressed: new Set(), held: [], candidate: null, bare: false }
    const down = (event: KeyboardEvent) => this.keydown(event)
    const up = (event: KeyboardEvent) => this.keyup(event)
    const blur = () => this.stop(null)
    const press = (event: PointerEvent) => { if (!(event.target as Element).closest?.('#keyboard-recorder')) this.stop(null) }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    window.addEventListener('pointerdown', press, true)
    this.teardown.push(() => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pointerdown', press, true)
    })
    this.refresh()
  }

  private keydown(event: KeyboardEvent) {
    const r = this.recording
    if (!r) return
    if (event.code === REMAPPED) { event.preventDefault(); event.stopPropagation(); return }
    const held = heldModifiers(event)
    // Tab and Shift-Tab leave the recorder as they leave any control.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.stop(null, false)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat || event.isComposing || event.key === 'Process' || event.key === 'Dead' || !event.code) return
    if (event.code === 'Escape' && !held.length) return this.stop(null)
    r.pressed.add(event.code)
    if (isModifierCode(event.code)) {
      if (!r.candidate) { r.held = held; r.bare = false; this.refresh() }
      return
    }
    if (r.candidate) return
    if (!held.length) { r.held = []; r.bare = true; return this.refresh() }
    r.candidate = canonical({ modifiers: held, code: event.code })
    r.bare = false
    this.refresh()
  }

  private keyup(event: KeyboardEvent) {
    const r = this.recording
    if (!r) return
    event.preventDefault()
    event.stopPropagation()
    if (event.code === REMAPPED) return
    r.pressed.delete(event.code)
    // macOS sends no key up for a key released while ⌘ is down: when ⌘ goes up, those keys are up too.
    if (/^Meta|^OS/.test(event.code)) for (const code of [...r.pressed]) if (!isModifierCode(code)) r.pressed.delete(code)
    // A modifier whose flag is gone is up, whichever side's key up was missed.
    const flags: Record<string, boolean> = { Shift: event.shiftKey, Control: event.ctrlKey, Alt: event.altKey, Meta: event.metaKey }
    for (const code of [...r.pressed]) {
      const kind = code.replace(/(Left|Right)$/, '')
      if (kind in flags && !flags[kind]) r.pressed.delete(code)
    }
    // Taken on key down, committed once every key is up, so a held shortcut never toggles the panel.
    if (r.candidate) { if (!r.pressed.size) this.stop(r.candidate) }
    else { r.held = heldModifiers(event); this.refresh() }
  }

  /** Ends the recording; `shortcut` is the one to save, or null to cancel. */
  private stop(shortcut: string | null, refocus = true) {
    this.generation++
    if (this.starting) { this.starting = false; this.render() }
    if (!this.recording) return
    this.recording = null
    for (const undo of this.teardown.splice(0)) undo()
    const captureOff = () => call('prefs_capture', { on: false }).catch(e => this.ctx.error(e))
    if (shortcut && shortcut !== this.value.shortcut && !this.slot.conflict) this.save({ capsLock: this.value.capsLock, shortcut }, captureOff)
    else { void captureOff(); this.render() }
    if (refocus) this.root.querySelector<HTMLElement>('#keyboard-recorder')?.focus()
  }

  escape() {
    if (!this.recording) return false
    this.stop(null)
    return true
  }

  leave() { this.stop(null, false) }

  /** Rust ends a capture by itself (after a minute, or when the window loses the keyboard) and says so with hotkey.json. */
  external(file: string) {
    if (file !== 'hotkey.json' || !(this.recording || this.starting)) return
    this.stop(null, false)
    this.error = 'Recording stopped. Click the shortcut to record again.'
    this.render()
  }
}
