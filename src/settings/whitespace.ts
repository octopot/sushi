// Text whose whitespace matters (an instruction, a prefix): kept exactly, and made visible as a layer
// under the text instead of as characters in it. The layer mirrors the field with transparent text and
// draws marks only where whitespace is easy to miss: at the start or end of a line, in runs, tabs, and
// line breaks at the very end or on empty lines.
import { afterFocus, h } from './ui'

export function marks(text: string): Node[] {
  const out: Node[] = []
  const lines = text.split('\n')
  // Line breaks after the last visible character.
  const lastVisible = text.search(/\S[^\S]*$/)
  let offset = 0
  lines.forEach((line, n) => {
    const lead = line.match(/^[ \t]*/)![0].length
    const trail = line.length - line.trimEnd().length
    let plain = ''
    const flush = () => { if (plain) { out.push(document.createTextNode(plain)); plain = '' } }
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      const run = c === ' ' && (line[i - 1] === ' ' || line[i + 1] === ' ')
      if (c === '\t' || (c === ' ' && (i < lead || i >= line.length - trail || run))) {
        flush()
        out.push(h('span', { class: c === '\t' ? 'ws-tab' : 'ws-space', text: c }))
      } else plain += c
    }
    flush()
    offset += line.length
    if (n < lines.length - 1) {
      if (!line.trim() || offset >= lastVisible + 1 || lastVisible < 0) out.push(h('span', { class: 'ws-break' }))
      out.push(document.createTextNode('\n'))
      offset += 1
    }
  })
  // A trailing newline needs a character after it for the mirror to keep the empty last line.
  if (text.endsWith('\n')) out.push(document.createTextNode('​'))
  return out
}

/** A multi-line field that grows with its text, over a layer that shows its whitespace. */
export function wsField(o: { id: string; label: string; value: string; placeholder?: string; describedBy?: string; disabled?: boolean; onInput: (value: string) => void; onCommit: () => void }) {
  const area = h('textarea', { id: o.id, 'aria-label': o.label, rows: '1', spellcheck: 'false', placeholder: o.placeholder, 'aria-describedby': o.describedBy })
  area.value = o.value
  area.disabled = !!o.disabled
  const layer = h('div', { class: 'ws-layer', 'aria-hidden': 'true' })
  const wrap = h('div', { class: 'ws-field' }, layer, area)
  const sync = () => {
    layer.replaceChildren(...marks(area.value))
    area.style.height = '0px'
    area.style.height = area.scrollHeight + 'px'
  }
  area.addEventListener('input', () => { sync(); o.onInput(area.value) })
  area.addEventListener('change', () => afterFocus(o.onCommit))
  // Drawn once the field is in the document and has a width.
  requestAnimationFrame(sync)
  layer.replaceChildren(...marks(area.value))
  return wrap
}
