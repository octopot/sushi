/** Keycaps as the app draws them: one rounded square per key. */
export function Keys({ keys, className = '' }) {
  return (
    <span className={`keycaps ${className}`} aria-hidden="true">
      {keys.map((key, i) => <kbd key={i} className={key.length > 1 ? 'wide' : undefined}>{key}</kbd>)}
    </span>
  )
}

/** Keycaps with a text equivalent for screen readers, e.g. ⌘K → "Command K". */
export function Shortcut({ keys }) {
  const names = { '⌘': 'Command', '⇧': 'Shift', '↵': 'Return', '←': 'Left Arrow', '→': 'Right Arrow', '↑': 'Up Arrow', '↓': 'Down Arrow', '⇥': 'Tab', '⌃': 'Control', '⌥': 'Option' }
  return (
    <>
      <Keys keys={keys} />
      <span className="sr-only">{keys.map(key => names[key] || key).join(' ')}</span>
    </>
  )
}
