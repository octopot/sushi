// The settings window's own glyphs, drawn like src/icons.ts: a 24-unit grid, 1.6 strokes, round joins.
import { icon as panelIcon } from '../icons'

const shapes: Record<string, string> = {
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14.5h8"/>',
  model: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75h.01"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.7l2 2h7.3a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  external: '<path d="M10 5.5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V14M14 4.5h5.5V10M19.5 4.5 11 13"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grip: '<path d="M9.5 6.5h.01M14.5 6.5h.01M9.5 12h.01M14.5 12h.01M9.5 17.5h.01M14.5 17.5h.01" stroke-width="2.4"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  warning: '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z"/><path d="M12 9.5v4M12 16.5h.01"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 15.75h.01"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5M14.25 11.5v5.5M11.5 14.25H17"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  docs: '<path d="M6.5 3.5h8l4 4v11a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5"/>',
  log: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3"/>',
}

export function icon(name: string): SVGSVGElement {
  if (!(name in shapes)) return panelIcon(name)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon icon-' + name)
  svg.innerHTML = shapes[name]
  return svg
}
