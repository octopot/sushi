// Report a problem (docs/specs/report.md): describe, answer up to three questions, optionally
// record while repeating the steps, then read, edit and copy or save one text. The flow lives in
// a window of its own (src/report-window.ts); the native side builds the snapshot and never sends
// anything (RP-1, RP-8).
import { el, keys } from './icons'

export interface ReportHost {
  /** The hosted provider the description would go to, or nothing for Ollama (report_start). */
  start(): Promise<{ provider?: string; fixed: string[] }>
  /** `consent` names the hosted provider the user agreed to, or is null. */
  questions(description: string, consent: string | null): Promise<string[]>
  record(on: boolean): Promise<void>
  /** The flow ended: a recording stops and is forgotten. */
  end(): Promise<void>
  draft(description: string, answers: { question: string; answer: string }[]): Promise<{ text: string; recording?: number }>
  copy(text: string): Promise<void>
  save(text: string, recording: boolean): Promise<void>
  /** The flow ended: the host closes its window. */
  onClose(): void
}

type Step = 'describe' | 'consent' | 'questions' | 'record' | 'report'

/** The flow, as the whole content of its window. */
export class Report {
  readonly root: HTMLElement
  private readonly host: ReportHost
  private readonly body: HTMLElement
  private readonly footer: HTMLElement
  private readonly status: HTMLElement
  private step: Step = 'describe'
  private description = ''
  private provider: string | undefined
  private fixed: string[] = []
  private answers: { question: string; answer: string }[] = []
  /** The recording runs while the user repeats the steps in the panel. */
  recording = false
  /** Bumped by every new step, so a late answer of an earlier one is ignored. */
  private ticket = 0
  private primary: (() => void) | undefined
  /** Bumped by every new flow, so a late start of an earlier one is ignored. */
  private flows = 0
  /** Sushi has said which provider the description would go to. */
  private ready = false

  constructor(parent: HTMLElement, host: ReportHost) {
    this.host = host
    this.body = el('div', 'report-body')
    this.status = el('div', 'report-status')
    this.status.setAttribute('role', 'status')
    this.footer = el('div', 'report-footer')
    const title = el('div', 'report-title', 'Report a problem')
    this.root = el('div', 'report', title, this.body, this.status, this.footer)
    // The window has no title bar of its own: its title, its edges and the gaps between its parts
    // move it. Tauri starts a drag only from the element that carries the mark.
    for (const handle of [this.root, title, this.body, this.status, this.footer]) handle.setAttribute('data-tauri-drag-region', '')
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', 'Report a problem')
    this.root.hidden = true
    parent.append(this.root)
  }

  /** ⌘↵: the step's main button. The window calls it wherever the focus is: in the app's WebKit
   *  a click on a button or a checkbox takes the focus from the field and gives it to nothing. */
  submit() { this.primary?.() }

  get isOpen() { return !this.root.hidden }
  /** The flow is under way, open or waiting for a recording. */
  get active() { return this.isOpen || this.recording }

  /** Starts the flow from its first step; nothing is recorded or sent (RP-1). */
  async open() {
    if (this.active) return this.show()
    this.description = ''
    this.answers = []
    this.provider = undefined
    this.fixed = []
    this.ready = false
    this.root.hidden = false
    // The empty form first: the user may start typing before Sushi answers, and the answer only
    // fills in who would get the description, read when they press Next.
    this.describe()
    const flow = ++this.flows
    const start = await this.host.start().catch(() => ({ provider: undefined, fixed: [] as string[] }))
    if (flow !== this.flows) return
    this.provider = start.provider
    this.fixed = start.fixed
    this.ready = true
    if (this.status.textContent === 'One moment…') this.status.textContent = ''
  }

  /** Shows the flow where it is, when its window is asked for again. */
  show() {
    this.root.hidden = false
    this.focus()
  }

  /** While it records, the only way on is to finish: skipping would leave it running under a
   *  report the user then edits. */
  private running() {
    const finish = () => void this.host.record(false).then(() => this.recorded())
    this.render('record', [
      el('h2', '', 'Recording…'),
      el('p', '', 'Repeat the steps that lead to the problem in Sushi; this window stays open. Then finish the recording, here, at the top of the panel or in the menu bar menu, to see your report.'),
    ], [this.button('Cancel', () => this.close(), false, ['esc']), this.button('Finish recording', finish, true, ['⌘', '↵'])], finish)
  }

  focus() { (this.root.querySelector<HTMLElement>('textarea, input, button.primary') ?? this.root).focus() }

  /** Leaves the flow at any step; a recording stops with it (RP-1, RP-5). */
  close() {
    if (!this.active) return
    this.ticket++
    this.flows++
    this.root.hidden = true
    this.recording = false
    void this.host.end()
    this.step = 'describe'
    this.host.onClose()
  }

  /** The recording finished, here, in the panel or in the menu bar menu: on to the report. */
  recorded() {
    if (!this.recording) return
    this.recording = false
    // A report the user already sees, and may have edited, is never built again.
    if (this.step !== 'report') void this.finish()
  }

  private render(step: Step, nodes: Node[], buttons: HTMLButtonElement[], primary?: () => void, status = '') {
    this.step = step
    this.ticket++
    this.body.replaceChildren(...nodes)
    this.footer.replaceChildren(...buttons)
    this.status.textContent = status
    this.primary = primary
    this.focus()
  }

  private button(label: string, run: () => void, primary = false, key?: string[]) {
    const button = el('button', primary ? 'primary' : '', label, ...(key ? [keys(...key)] : []))
    button.type = 'button'
    button.addEventListener('click', run)
    return button
  }

  private field(label: string, value: string, rows: number) {
    const area = el('textarea')
    Object.assign(area, { value, rows, spellcheck: true })
    area.setAttribute('aria-label', label)
    return area
  }

  private describe() {
    const area = this.field('What went wrong', this.description, 6)
    area.placeholder = 'Type or dictate what happened, in your own words.'
    const next = () => {
      this.description = area.value.trim()
      if (!this.description) { this.status.textContent = 'Describe the problem first.'; return }
      // Who would get the description is known only once Sushi answers; never guess Ollama.
      if (!this.ready) { this.status.textContent = 'One moment…'; return }
      this.provider ? this.consent() : void this.ask(null)
    }
    this.render('describe', [el('h2', '', 'What went wrong?'), area],
      [this.button('Cancel', () => this.close(), false, ['esc']), this.button('Next', next, true, ['⌘', '↵'])], next)
  }

  /** A hosted provider gets the description only with the user's yes (RP-3). */
  private consent() {
    const provider = this.provider!
    const ask = () => void this.ask(provider)
    this.render('consent', [
      el('h2', '', 'Ask follow-up questions?'),
      el('p', '', `Sushi can suggest up to three questions about your description. Model in the menu bar menu is set to ${provider}, so the description would go to ${provider}; nothing else of the report does. Without it you get three standard questions.`),
    ], [this.button('Use standard questions', () => this.questions(this.fixed)), this.button(`Ask ${provider}`, ask, true, ['⌘', '↵'])], ask)
  }

  private async ask(consent: string | null) {
    this.render('questions', [el('h2', '', 'A few questions'), el('p', 'muted', 'Thinking of questions…')],
      [this.button('Skip', () => this.questions([]))])
    const ticket = this.ticket
    const found = await this.host.questions(this.description, consent).catch(() => this.fixed)
    if (ticket === this.ticket && this.step === 'questions') this.questions(found.length ? found : this.fixed)
  }

  private questions(questions: string[]) {
    if (!questions.length) { this.answers = []; return this.offer() }
    const areas = questions.slice(0, 3).map((question, i) => {
      const area = this.field(question, this.answers[i]?.answer ?? '', 2)
      area.placeholder = 'Optional'
      return { question, area }
    })
    const next = () => {
      this.answers = areas.map(({ question, area }) => ({ question, answer: area.value.trim() }))
      this.offer()
    }
    this.render('questions', [el('h2', '', 'A few questions'), ...areas.flatMap(({ question, area }) => [el('label', '', question), area])],
      [this.button('Skip', () => { this.answers = questions.map(question => ({ question, answer: '' })); this.offer() }),
        this.button('Next', next, true, ['⌘', '↵'])], next)
  }

  /** Reproducing is optional; the recording lives in memory and stops with the flow (RP-5). */
  private offer() {
    const start = () => {
      this.recording = true
      void this.host.record(true)
      this.running()
    }
    this.render('record', [
      el('h2', '', 'Reproduce it now?'),
      el('p', '', 'Sushi records when the panel shows and hides, the keys you press with ⌘ or ⌃, and which app takes the keyboard. It never records your text. Repeat the steps in Sushi, then choose Finish recording in this window, at the top of the panel or in the menu bar menu.'),
    ], [this.button('Skip', () => void this.finish()), this.button('Start recording', start, true, ['⌘', '↵'])], start)
  }

  /** The whole report as one editable text; the recording can be left out (RP-8). */
  private async finish() {
    this.render('report', [el('h2', '', 'Your report'), el('p', 'muted', 'Collecting the report…')], [this.button('Cancel', () => this.close(), false, ['esc'])])
    const ticket = this.ticket
    let draft: { text: string; recording?: number }
    try { draft = await this.host.draft(this.description, this.answers) } catch (e) {
      if (ticket === this.ticket) this.status.textContent = e instanceof Error ? e.message : String(e)
      return
    }
    if (ticket !== this.ticket) return
    const area = this.field('Report', draft.text, 12)
    area.classList.add('text')
    const include = el('input')
    include.type = 'checkbox'
    include.checked = draft.recording !== undefined
    const attachment = draft.recording === undefined
      ? el('p', 'muted', 'No recording.')
      : el('label', 'attachment', include, `Save the recording with the report (report-recording.log, ${size(draft.recording)})`)
    const copy = async () => {
      try { await this.host.copy(area.value); this.status.textContent = 'Copied. Paste it into a message to the developer; Sushi sends nothing.' } catch (e) { this.status.textContent = String(e) }
    }
    const save = async () => {
      try { await this.host.save(area.value, include.checked && draft.recording !== undefined); this.status.textContent = 'Saved. Finder shows the folder; attach the files to your message.' } catch (e) { this.status.textContent = String(e) }
    }
    this.render('report', [
      el('h2', '', 'Your report'),
      el('p', 'muted', 'Read it, change or remove anything, then copy or save it. Sushi never sends it.'),
      area, attachment,
    ], [this.button('Done', () => this.close(), false, ['esc']), this.button('Save…', () => void save()), this.button('Copy', () => void copy(), true, ['⌘', '↵'])],
    () => void copy())
  }
}

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
