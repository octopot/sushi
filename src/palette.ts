import { el, icon, keys } from './icons'

export interface Row {
  id: string
  name: string
  detail?: string
  icon?: string
  /** Muted text on the right, e.g. a relative date. */
  hint?: string
  /** A keycap on the right, e.g. a quick-pick digit. */
  key?: string
  run: () => void
}
export interface Header { header: string; key?: string }
export type Item = Row | Header

export interface PaletteOptions {
  label: string
  className: string
  placeholder: string
  icon?: string
  accessory?: HTMLElement
  onQuery: (query: string) => void
  /** Called before the palette's own handling; return true when the host consumed the key. */
  onKey?: (event: KeyboardEvent) => boolean
  onPaste?: (query: string) => void
  onSelect?: (row: Row | undefined) => void
  onClose: () => void
}

let counter = 0

/** An input with a filtered list: ↑/↓ move, Enter runs, Esc closes (the host routes Esc). */
export class Palette {
  readonly root: HTMLElement
  readonly input: HTMLInputElement
  readonly footer: HTMLElement
  private readonly list: HTMLElement
  /** Announces the selected row: the input stays a plain text field so dictation tools can type into it. */
  private readonly live: HTMLElement
  private readonly options: PaletteOptions
  private rows: Row[] = []
  private selected = 0
  /** Set once the user picks a row with arrows or the mouse; until then re-renders keep the first row. */
  private picked = false
  private readonly prefix = 'palette' + ++counter

  constructor(host: HTMLElement, options: PaletteOptions) {
    this.options = options
    this.input = el('input')
    Object.assign(this.input, { type: 'text', placeholder: options.placeholder, spellcheck: false, autocomplete: 'off' })
    this.list = el('div', 'list')
    this.list.id = this.prefix + '-list'
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', options.label)
    this.input.setAttribute('aria-label', options.label)
    this.live = el('div', 'visually-hidden')
    this.live.setAttribute('aria-live', 'polite')
    const field = el('div', 'field', ...(options.icon ? [icon(options.icon)] : []), this.input, ...(options.accessory ? [options.accessory] : []))
    this.footer = el('div', 'footer')
    this.root = el('div', 'palette ' + options.className, field, this.list, this.footer, this.live)
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', options.label)
    this.root.hidden = true
    host.append(this.root)

    this.input.addEventListener('input', () => options.onQuery(this.input.value))
    this.input.addEventListener('keydown', event => this.key(event))
    this.input.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain')
      if (text === undefined) return
      event.preventDefault()
      this.input.setRangeText(text.replace(/\s+/gu, ' '), this.input.selectionStart ?? 0, this.input.selectionEnd ?? 0, 'end')
      this.input.scrollLeft = this.input.scrollWidth
      options.onQuery(this.input.value)
      options.onPaste?.(this.input.value)
    })
    // Keep the caret in the input: clicks choose rows but never take focus.
    this.root.addEventListener('mousedown', event => { if (event.target !== this.input) event.preventDefault() })
  }

  get isOpen() { return !this.root.hidden }
  get query() { return this.input.value }
  set query(value: string) { this.input.value = value; this.options.onQuery(value) }

  open() {
    this.input.value = ''
    this.root.hidden = false
    this.options.onQuery('')
    this.focus()
  }
  close() {
    if (this.root.hidden) return
    this.root.hidden = true
    this.options.onClose()
  }
  focus() { this.input.focus() }

  /** Replaces the rows; keeps the selected row when it is still present. */
  render(items: Item[], empty = '', keepSelection = false) {
    if (!keepSelection) this.picked = false
    const previous = this.picked ? this.rows[this.selected]?.id : undefined
    this.rows = items.filter((item): item is Row => 'run' in item)
    this.selected = Math.max(0, this.rows.findIndex(row => row.id === previous))
    const nodes = items.map(item => 'run' in item ? this.row(item, this.rows.indexOf(item)) : el('div', 'section', item.header, ...(item.key ? [keys(item.key)] : [])))
    if (!this.rows.length && empty) nodes.push(el('div', 'empty', empty))
    this.list.replaceChildren(...nodes)
    this.list.scrollTop = 0
    this.highlight()
  }

  private row(row: Row, index: number) {
    const node = el('div', 'row', ...(row.icon ? [icon(row.icon)] : []), el('span', 'name', row.name))
    if (row.detail) node.append(el('span', 'detail', row.detail))
    node.append(el('span', 'spacer'))
    if (row.hint) node.append(el('span', 'hint', row.hint))
    if (row.key) node.append(keys(row.key))
    node.id = this.prefix + '-' + index
    node.setAttribute('role', 'option')
    node.addEventListener('click', () => { this.selected = index; this.picked = true; this.highlight(); row.run() })
    return node
  }

  private highlight() {
    const row = this.rows[this.selected]
    for (const node of this.list.querySelectorAll('[role=option]')) {
      const active = node.id === this.prefix + '-' + this.selected
      node.setAttribute('aria-selected', String(active))
      if (active) node.scrollIntoView({ block: 'nearest' })
    }
    this.live.textContent = row ? row.name + (row.hint ? ', ' + row.hint : '') : ''
    this.options.onSelect?.(row)
  }

  /** Runs the selected row. */
  run() { this.rows[this.selected]?.run() }

  move(step: number) {
    if (!this.rows.length) return
    this.selected = (this.selected + step + this.rows.length) % this.rows.length
    this.picked = true
    this.highlight()
  }

  private key(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229 || this.options.onKey?.(event)) return
    const handled = event.key === 'ArrowDown' ? (this.move(1), true)
      : event.key === 'ArrowUp' ? (this.move(-1), true)
      : event.key === 'Enter' ? (this.run(), true)
      : event.key === 'Tab'
    if (handled) event.preventDefault()
  }
}
