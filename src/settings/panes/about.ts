// About: the version, the build info and the links first; Troubleshooting (Report a problem, the
// activity log in diagnostics.json, saved reports, the settings folder) below.
import mark from '../../mark.svg'
import type { AboutPane } from '../../bindings/AboutPane'
import { call } from '../../ipc'
import { FileBar, fileNotice } from '../filebar'
import { icon } from '../icons'
import type { Context, Pane } from '../pane'
import type { Slot } from '../store'
import { button, card, chevron, fieldError, group, h, row, switchControl } from '../ui'

type Action = 'copy-build' | 'log' | 'reports' | 'folder' | 'docs' | 'notes' | 'github' | 'report'

export class AboutSettings implements Pane {
  readonly id = 'about'
  readonly title = 'About'
  readonly root = h('div', { class: 'pane-body' })
  private readonly bar: FileBar<AboutPane>
  private recordIntent: boolean | null = null
  private error: string | null = null
  private copied = 0
  private details = false

  constructor(private readonly slot: Slot<AboutPane>, private readonly ctx: Context) {
    slot.host = {
      file: pane => pane.diagnostics.file,
      hasDraft: () => this.recordIntent !== null,
      dropDraft: () => { this.recordIntent = null },
      render: () => this.render(),
    }
    this.bar = new FileBar(slot, 'about')
  }

  pending() { return false }

  /** True when the action went through; a failure says so in the window's message line. */
  private async act(action: Action): Promise<boolean> {
    try {
      await call('prefs_action', { action, provider: null })
      return true
    } catch (e) {
      this.ctx.error(e)
      return false
    }
  }

  private record(on: boolean) {
    this.recordIntent = on
    this.error = null
    const done = () => { if (this.recordIntent === on) this.recordIntent = null }
    const fail = (text: string) => { done(); this.error = text }
    this.slot.save({ key: 'record', send: revision => call('prefs_diagnostics_save', { revision, record: on }), saved: done, invalid: fail, failed: fail,
      matches: pane => pane.diagnostics.file.status !== 'ok' || pane.diagnostics.record === on })
    this.render()
  }

  render() {
    const pane = this.slot.pane
    const file = pane.diagnostics.file
    const on = this.recordIntent ?? pane.diagnostics.record
    const writable = file.writable && !this.slot.conflict
    const justCopied = Date.now() - this.copied < 2000
    const copy = button({
      label: justCopied ? 'Copied' : 'Copy build info', icon: justCopied ? 'check' : 'copy', id: 'about-copy',
      onClick: async () => {
        // "Copied" only once the copy went through.
        if (!await this.act('copy-build')) return
        this.copied = Date.now()
        this.render()
        this.ctx.announce('Build info copied')
        setTimeout(() => this.render(), 2100)
      },
    })
    const notice = fileNotice(this.slot, {
      subject: 'The logging setting',
      resave: () => { if (this.recordIntent !== null) this.record(this.recordIntent) },
      reset: prefs => this.ctx.applyReset(prefs, 'diagnostics.json'),
      // Whether a log is written now, from `record` as Rust reports the running state; a broken file says nothing about it.
      meanwhile: pane.recording ? 'A problem report is recording, so the log is still written.'
        : pane.diagnostics.record ? 'The log is still being written.' : 'Nothing is logged meanwhile.',
    })
    const broken = file.status === 'invalid' || file.status === 'unreadable'
    const link = (label: string, action: Action) =>
      button({ label, id: 'about-' + action, onClick: () => { void this.act(action) } })
    const disclosure = h('button', { type: 'button', class: 'disclosure', id: 'about-details', 'aria-expanded': String(this.details), 'aria-controls': 'about-build' },
      chevron(this.details), h('span', { text: 'Build details' }))
    disclosure.addEventListener('click', () => { this.details = !this.details; this.render() })
    // While a problem report records, the log is written whatever the file says: no switch that would say otherwise.
    const logging = pane.recording
      ? h('span', { class: 'recording-mark' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Recording for a problem report')
      : switchControl({ label: 'Log panel activity', id: 'about-diagnostics', checked: on, disabled: !writable || broken, onChange: value => this.record(value) })

    this.root.replaceChildren(
      h('div', { class: 'about-head' },
        h('img', { class: 'mark', src: mark, alt: '' }),
        h('div', { class: 'about-title' },
          h('div', { class: 'about-name' }, h('span', { text: 'Sushi ' }), h('span', { class: 'about-version', text: pane.version })),
          h('div', { class: 'about-tag', text: 'A prompt composer one keystroke away.' }))),
      h('div', { class: 'about-actions' }, copy, link('Documentation', 'docs'), link('Release notes', 'notes'), link('GitHub', 'github')),
      h('div', { class: 'build-block' }, disclosure,
        this.details ? h('div', { class: 'build', id: 'about-build' },
          h('p', { class: 'lead small', text: 'Include this in a problem report.' }),
          h('pre', { class: 'build-text', tabindex: '0', 'aria-label': 'Build info' }, pane.build),
          h('div', { class: 'build-actions' }, h('span', { class: 'card-note', text: `Commit ${pane.hash}` }))) : null),
      group('Troubleshooting',
        card(
          row({ title: 'Report a problem', detail: 'Describe what went wrong. Sushi helps you write a report you can send.',
            control: button({ label: 'Report a problem…', id: 'about-report', onClick: () => { void this.act('report') } }) }),
          h('div', { class: 'log-group' },
            notice,
            row({
              title: 'Log panel activity',
              detail: 'Records when the panel shows and hides, to diagnose problems. Stays on this Mac.',
              control: h('div', { class: 'controls' },
                button({ label: 'Show log', id: 'about-log', disabled: !pane.diagnostics.logExists, title: pane.diagnostics.logExists ? '' : 'There is no log yet.', onClick: () => { void this.act('log') } }),
                logging),
            }),
            this.error ? h('div', { class: 'row-message' }, fieldError(this.error, 'about-error')) : null),
          row({ title: 'Saved reports', detail: 'The reports you saved, with their recordings.', control: button({ label: 'Show in Finder', id: 'about-reports', aria: 'Show saved reports in Finder', onClick: () => { void this.act('reports') } }) }),
          row({ title: 'Settings folder', detail: 'The folder with Sushi’s settings files.', control: button({ label: 'Open settings folder', id: 'about-folder', onClick: () => { void this.act('folder') } }) })),
        this.bar.root),
    )
    this.bar.update()
  }
}
