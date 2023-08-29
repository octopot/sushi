// The window of Report a problem (docs/specs/report.md, RP-1): a normal window that holds the
// flow of src/report.ts. It stays open while the user looks at other apps or uses the panel, and
// closing it keeps the flow where it was.
import './report.css'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { call, on } from './ipc'
import { Report } from './report'

const desktop = isTauri()
// Closing asks Rust, which hides the window and gives the keyboard back to where the user came
// from; the flow stays as it is, here in the page.
const hideWindow = () => { if (desktop) void getCurrentWindow().close().catch(() => undefined) }

const report = new Report(document.getElementById('report')!, {
  start: () => call('report_start'),
  questions: (description, consent) => call('report_questions', { description, consent }),
  record: async on => { await call('report_record', { on }) },
  end: async () => { await call('report_end') },
  draft: (description, answers) => call('report_draft', { description, answers }),
  // After a copy the window closes, so ⌘V lands in the app the user came from.
  copy: async text => {
    await (desktop ? call('copy_text', { text }) : navigator.clipboard.writeText(text))
    hideWindow()
  },
  // After Save… Finder shows the folder and has the keyboard: the window only steps out of the way.
  save: async (text, recording) => {
    await call('report_save', { text, recording })
    if (desktop) void getCurrentWindow().hide().catch(() => undefined)
  },
  // Leaving the flow closes its window; the next Report a problem… starts a new one.
  onClose: hideWindow,
})

document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey) return
  const stop = (action: () => unknown) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) void action()
  }
  if (event.key === 'Escape' && !event.metaKey) return stop(() => report.close())
  if (!event.metaKey) return
  // ⌘↵ is the step's main button wherever the focus is: a click on a button or a checkbox
  // takes it from the field and gives it to nothing in the app's WebKit (RP-8).
  if (event.code === 'Enter' || event.code === 'NumpadEnter') return stop(() => report.submit())
  if (!event.shiftKey && event.code === 'KeyS') return stop(() => report.save())
  // ⌘W hides the window and keeps the flow, as its close button does.
  if (!event.shiftKey && event.code === 'KeyW') return stop(hideWindow)
}, true)

if (desktop) {
  // The menu and Settings ▸ About ask for the window again: the flow shows where it is.
  void on('report-open', () => void report.open())
  // Finish recording at the top of the panel or in the menu bar menu: on to the report.
  void on('report-recording', recording => { if (!recording) report.recorded() })
}
void report.open()
