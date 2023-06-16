// Combinations as hotkey.json writes them ("Control+Shift+Space") and as the window shows them (⌃⇧Space).

export const MODIFIERS = ['Control', 'Option', 'Shift', 'Command'] as const
export type Modifier = typeof MODIFIERS[number]
const GLYPH: Record<Modifier, string> = { Control: '⌃', Option: '⌥', Shift: '⇧', Command: '⌘' }
const ALIAS: Record<string, Modifier> = {
  control: 'Control', ctrl: 'Control', option: 'Option', alt: 'Option', shift: 'Shift',
  command: 'Command', cmd: 'Command', super: 'Command', meta: 'Command',
}

const NAMES: Record<string, string> = {
  Space: 'Space', Enter: '↩', NumpadEnter: '⌤', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: '↖', End: '↘', PageUp: '⇞', PageDown: '⇟',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'',
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '§',
}
const SPOKEN: Record<string, string> = {
  Enter: 'Return', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Delete', Delete: 'Forward Delete', Escape: 'Escape',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
}

/** The readable name of a physical key code: KeyP → P, Digit1 → 1, Numpad1 → Num 1. */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6)
  if (/^[A-Za-z0-9]$/.test(code)) return code.toUpperCase()
  return NAMES[code] ?? code
}

export interface Combination { modifiers: Modifier[]; code: string }

/** Parses the file's form, accepting the aliases the file accepts; null when it is not a combination. */
export function parse(shortcut: string): Combination | null {
  const parts = shortcut.split('+').map(part => part.trim())
  const code = parts.pop()
  if (!code) return null
  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    const modifier = ALIAS[part.toLowerCase()]
    if (!modifier) return null
    modifiers.add(modifier)
  }
  return { modifiers: MODIFIERS.filter(m => modifiers.has(m)), code }
}

export const canonical = ({ modifiers, code }: Combination) =>
  [...MODIFIERS.filter(m => modifiers.includes(m)), code].join('+')

/** The keycaps of a combination: ['⌃', '⇧', 'Space']. */
export function glyphs(shortcut: string): string[] {
  const combination = parse(shortcut)
  if (!combination) return [shortcut]
  return [...combination.modifiers.map(m => GLYPH[m]), keyName(combination.code)]
}

/** One string for running text: ⌃⇧Space. */
export const display = (shortcut: string) => glyphs(shortcut).join('')

/** What VoiceOver reads: "Control Shift Space". */
export function spoken(shortcut: string): string {
  const combination = parse(shortcut)
  if (!combination) return shortcut
  return [...combination.modifiers, SPOKEN[combination.code] ?? keyName(combination.code)].join(' ')
}

export const modifierGlyphs = (modifiers: Modifier[]) => modifiers.map(m => GLYPH[m])

/** Modifier keys and keys that are never the key of a combination. */
export const isModifierCode = (code: string) =>
  /^(Shift|Control|Alt|Meta|OS|CapsLock|Fn|FnLock|Hyper|Super)(Left|Right)?$/.test(code)

export function heldModifiers(event: KeyboardEvent): Modifier[] {
  const held: Modifier[] = []
  if (event.ctrlKey) held.push('Control')
  if (event.altKey) held.push('Option')
  if (event.shiftKey) held.push('Shift')
  if (event.metaKey) held.push('Command')
  return held
}
