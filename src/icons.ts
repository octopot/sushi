const shapes: Record<string, string> = {
  action: '<path d="M12 3.5 13.7 9a2 2 0 0 0 1.3 1.3l5.5 1.7-5.5 1.7a2 2 0 0 0-1.3 1.3L12 20.5 10.3 15A2 2 0 0 0 9 13.7L3.5 12 9 10.3A2 2 0 0 0 10.3 9z"/>',
  library: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h2A1.5 1.5 0 0 1 9 5.5v13A1.5 1.5 0 0 1 7.5 20h-2A1.5 1.5 0 0 1 4 18.5zM9 8h4.5v12H9m6.3-14.6 2-.5a1 1 0 0 1 1.2.7l3 11.6a1 1 0 0 1-.7 1.2l-2 .5a1 1 0 0 1-1.2-.7l-3-11.6a1 1 0 0 1 .7-1.2"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  template: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8h7m-7 4h7m-7 4h4"/>',
  prompt: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4h0A1 1 0 0 1 5 15z"/>',
  term: '<path d="M4 18 9 6l5 12M5.8 14h6.4M15 10.5h5M15 14.5h5"/>',
  instruction: '<path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13 7 4 4"/>',
  spinner: '<circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3.3"/>',
}

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon icon-' + name)
  svg.innerHTML = shapes[name]
  return svg
}

/** Raycast-style keycaps: one rounded square per key. */
export function keys(...glyphs: string[]): HTMLElement {
  const group = document.createElement('span')
  group.className = 'keys'
  group.setAttribute('aria-hidden', 'true')
  for (const glyph of glyphs) {
    const key = document.createElement('kbd')
    key.textContent = glyph
    if (glyph.length > 1) key.className = 'wide'
    group.append(key)
  }
  return group
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string)[]) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children)
  return node
}
