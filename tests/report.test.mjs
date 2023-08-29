// The window of Report a problem (docs/specs/report.md) in an isolated headless browser. Every native
// side effect goes through the IPC fixture below: nothing is recorded, saved or copied for real.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, webkit } from 'playwright-core'
import { preview } from 'vite'

test('Report a problem', async t => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  t.after(() => new Promise(resolve => app.httpServer.close(resolve)))
  // SUSHI_ENGINE=webkit runs the same scenarios in the engine the app itself uses.
  const browser = process.env.SUSHI_ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const screens = process.env.SUSHI_REVIEW_SCREENS
  if (screens) await mkdir(screens, { recursive: true })

  async function start(t, { scheme = 'dark' } = {}) {
    const context = await browser.newContext({ viewport: { width: 640, height: 560 }, deviceScaleFactor: 2, colorScheme: scheme })
    t.after(() => context.close())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    t.after(() => assert.deepEqual(errors, [], 'no page errors'))
    await page.addInitScript(() => {
      const state = window.fixture = {
        callbacks: [], listeners: {}, copies: [], closes: 0, hides: 0, questions: [], recordings: [], drafts: [], saves: [], starts: 0, ends: 0,
        reportStart: { fixed: ['What were you doing?', 'What did you expect?', 'Does it repeat?'] },
      }
      window.isTauri = true
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'report' }, currentWebview: { windowLabel: 'report', label: 'report' } },
        transformCallback: callback => state.callbacks.push(callback),
        async invoke(command, args) {
          switch (command) {
            case 'report_start':
              state.starts++
              if (state.holdStart) return new Promise(resolve => { state.releaseStart = () => resolve(state.reportStart) })
              return state.reportStart
            case 'report_questions':
              state.questions.push(args)
              return state.questionReply ?? ['Что вы делали?', 'Повторяется ли?']
            case 'report_record': state.recordings.push(args.on); return
            case 'report_end': state.ends++; return
            case 'report_draft':
              state.drafts.push(args)
              return { text: 'Sushi problem report · format 1\n\n## What went wrong\n\n' + args.description + '\n', recording: state.recordings.includes(true) ? 2048 : undefined }
            case 'report_save': state.saves.push(args); return
            case 'copy_text': state.copies.push(args.text); return
            // The window closes itself when the flow is left, and on ⌘W.
            case 'plugin:window|close': state.closes++; return
            // After Save… the window hides without asking for the keyboard back: Finder has it.
            case 'plugin:window|hide': state.hides++; return
            case 'plugin:event|listen': state.listeners[args.event] = state.callbacks[args.handler - 1]; return 1
            default: throw new Error('Unexpected IPC call: ' + command)
          }
        },
      }
    })
    await page.goto(new URL('report.html', app.resolvedUrls.local[0]).href)
    await page.getByRole('textbox', { name: 'What went wrong' }).waitFor()
    await page.waitForFunction(() => window.fixture.listeners['report-recording'])
    return page
  }
  const emit = (page, event, payload = null) => page.evaluate(([event, payload]) => window.fixture.listeners[event]({ event, payload }), [event, payload])
  async function capture(page, name) {
    if (!screens) return
    await page.mouse.move(0, 0)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(screens, name + '.png'), animations: 'disabled', caret: 'hide' })
  }

  await t.test('describe, answer, record, edit, then copy or save; nothing leaves the Mac (RP-1 to RP-9)', async t => {
    const page = await start(t)
    const outside = []
    page.on('request', request => { if (!request.url().startsWith(new URL(page.url()).origin)) outside.push(request.url()) })
    const field = page.getByRole('textbox', { name: 'What went wrong' })
    // The window has no title bar of its own: its title, edges and gaps move it.
    for (const handle of ['.titlebar', '.report', '.report-title', '.report-body', '.report-footer'])
      assert.equal(await page.locator(handle).getAttribute('data-tauri-drag-region'), '', `${handle} moves the window`)
    assert.equal(await field.getAttribute('data-tauri-drag-region'), null, 'a field is for typing, not for dragging')
    assert.equal(await page.evaluate(() => window.fixture.recordings.length), 0, 'starting records nothing')
    await page.keyboard.press('Meta+Enter')
    await page.locator('.report-status', { hasText: 'Describe the problem first.' }).waitFor()
    await field.fill('Панель закрывается после ⌘A.')
    await capture(page, 'report-describe-dark')
    await page.keyboard.press('Meta+Enter')
    // Ollama asks in the language of the description; the model gets the description only.
    await page.getByRole('textbox', { name: 'Что вы делали?' }).fill('Нажимал ⌘A')
    assert.deepEqual(await page.evaluate(() => window.fixture.questions), [{ description: 'Панель закрывается после ⌘A.', consent: null }])
    await capture(page, 'report-questions-dark')
    await page.keyboard.press('Meta+Enter')
    await page.getByRole('heading', { name: 'Reproduce it now?' }).waitFor()
    await page.getByRole('button', { name: 'Start recording' }).click()
    // The window stays open while the steps are repeated in the panel, and offers only to finish.
    await page.getByRole('heading', { name: 'Recording…' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Skip' }).count(), 0, 'nothing skips past a recording')
    assert.deepEqual(await page.evaluate(() => window.fixture.recordings), [true])
    await capture(page, 'report-recording-dark')
    // Asked for again from the menu while it records: the same step.
    await emit(page, 'report-open')
    await page.getByRole('heading', { name: 'Recording…' }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.starts), 1, 'the flow is not started again')
    await page.keyboard.press('Meta+Enter')
    const report = page.getByRole('textbox', { name: 'Report' })
    await report.waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.recordings), [true, false])
    const [sent] = await page.evaluate(() => window.fixture.drafts)
    assert.deepEqual(sent, { description: 'Панель закрывается после ⌘A.', answers: [{ question: 'Что вы делали?', answer: 'Нажимал ⌘A' }, { question: 'Повторяется ли?', answer: '' }] },
      'the window sends its own words; the panel says what it shows by itself (RP-6)')
    await page.getByText('Save the recording with the report (report-recording.log, 2.0 KB)').waitFor()
    await capture(page, 'report-text-dark')
    await report.fill('Edited by the user.')
    await page.keyboard.press('Meta+Enter')
    await page.locator('.report-status', { hasText: 'Sushi sends nothing' }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.copies.at(-1)), 'Edited by the user.')
    // A copy closes the window, so ⌘V goes to the app underneath; the report stays as it is.
    await page.waitForFunction(() => window.fixture.closes === 1)
    assert.equal(await page.evaluate(() => window.fixture.ends), 0, 'the flow is not left')
    await emit(page, 'report-open')
    assert.equal(await report.inputValue(), 'Edited by the user.', 'asked for again, the report is as it was')
    assert.equal(await page.evaluate(() => window.fixture.starts), 1)
    await page.getByRole('checkbox').uncheck()
    await page.getByRole('button', { name: 'Save…' }).click()
    await page.waitForFunction(() => window.fixture.saves.length === 1 && window.fixture.hides === 1)
    assert.deepEqual(await page.evaluate(() => window.fixture.saves[0]), { text: 'Edited by the user.', recording: false })
    assert.equal(await page.evaluate(() => window.fixture.closes), 1, 'Finder has the keyboard: the window only hides')
    // ⌘S saves too. In the app's WebKit the click on the checkbox took the focus from the field
    // and gave it to nothing: the keys still work.
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Meta+s')
    await page.waitForFunction(() => window.fixture.saves.length === 2 && window.fixture.hides === 2)
    const copied = await page.evaluate(() => window.fixture.copies.length)
    await page.keyboard.press('Meta+Enter')
    await page.waitForFunction(n => window.fixture.copies.length === n + 1, copied)
    await page.waitForFunction(() => window.fixture.closes === 2)
    // A late finish from the menu leaves the report as the user edited it.
    await emit(page, 'report-recording', false)
    await page.waitForTimeout(100)
    assert.equal(await report.inputValue(), 'Edited by the user.')
    assert.equal((await page.evaluate(() => window.fixture.drafts)).length, 1)
    // Esc leaves the flow: the recording belongs to no report any more, and the window closes.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.fixture.closes === 3 && window.fixture.ends === 1)
    assert.deepEqual(outside, [], 'the flow makes no network request')
    // The next Report a problem… starts from an empty description.
    await emit(page, 'report-open')
    await field.waitFor()
    assert.equal(await field.inputValue(), '')
    assert.equal(await page.evaluate(() => window.fixture.starts), 2)
  })

  await t.test('closing the window keeps the flow; the panel or the menu can finish a recording (RP-1, RP-5)', async t => {
    const page = await start(t)
    const field = page.getByRole('textbox', { name: 'What went wrong' })
    await field.fill('It flickers.')
    // ⌘W hides the window, as its close button does; nothing of the flow is lost or ended.
    await page.keyboard.press('Meta+w')
    await page.waitForFunction(() => window.fixture.closes === 1)
    assert.equal(await page.evaluate(() => window.fixture.ends), 0)
    await emit(page, 'report-open')
    assert.equal(await field.inputValue(), 'It flickers.')
    assert.equal(await page.evaluate(() => window.fixture.starts), 1)
    await page.keyboard.press('Meta+Enter')
    await page.getByRole('button', { name: 'Skip' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.getByRole('heading', { name: 'Recording…' }).waitFor()
    // Finish recording at the top of the panel or in the menu bar menu: Rust says so, on to the report.
    await emit(page, 'report-recording', false)
    await page.getByRole('textbox', { name: 'Report' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.recordings), [true], 'the window did not stop it a second time')
    // Cancel while a new one records ends the recording with the flow.
    await page.getByRole('button', { name: 'Done' }).click()
    await page.waitForFunction(() => window.fixture.ends === 1 && window.fixture.closes === 2)
    await emit(page, 'report-open')
    await field.fill('Again.')
    await page.keyboard.press('Meta+Enter')
    await page.getByRole('button', { name: 'Skip' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.getByRole('heading', { name: 'Recording…' }).waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForFunction(() => window.fixture.ends === 2 && window.fixture.closes === 3)
  })

  await t.test('a hosted provider gets the description only with consent (RP-3)', async t => {
    const page = await start(t, { scheme: 'light' })
    await page.evaluate(() => { window.fixture.reportStart = { provider: 'Claude', fixed: ['What were you doing?', 'What did you expect?', 'Does it repeat?'] } })
    // A new flow: the form is there at once, and what the user types before Sushi answers stays.
    await page.keyboard.press('Escape')
    await page.evaluate(() => { window.fixture.holdStart = true })
    await emit(page, 'report-open')
    const field = page.getByRole('textbox', { name: 'What went wrong' })
    await field.fill('It flickers.')
    // Next waits for that answer: Sushi does not yet know the description would go to Claude.
    await page.keyboard.press('Meta+Enter')
    await page.locator('.report-status', { hasText: 'One moment…' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.questions), [])
    await page.evaluate(() => { window.fixture.holdStart = false; window.fixture.releaseStart() })
    await page.waitForTimeout(50)
    assert.equal(await field.inputValue(), 'It flickers.')
    await page.keyboard.press('Meta+Enter')
    await page.getByText('the description would go to Claude').waitFor()
    await capture(page, 'report-consent-light')
    await page.getByRole('button', { name: 'Use standard questions' }).click()
    await page.getByRole('textbox', { name: 'What did you expect?' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.questions), [], 'nothing was asked')
    // With the user's yes, the provider named in the consent gets the description and nothing else.
    await page.keyboard.press('Escape')
    await emit(page, 'report-open')
    await field.fill('Again.')
    await page.keyboard.press('Meta+Enter')
    await page.getByRole('button', { name: 'Ask Claude' }).click()
    await page.getByRole('textbox', { name: 'Что вы делали?' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.questions.at(-1)), { description: 'Again.', consent: 'Claude' })
  })
})
