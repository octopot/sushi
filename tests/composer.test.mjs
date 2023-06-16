// Playwright drives an isolated headless Chrome. Every native side effect goes through the IPC fixture below;
// the real clipboard is never touched.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, webkit } from 'playwright-core'
import { preview } from 'vite'

const { rules } = JSON.parse(await readFile(new URL('../docs/specs/examples/rules.json', import.meta.url), 'utf8'))
const hour = 3_600_000
const library = {
  // As library_list returns them: sorted by file name.
  templates: [
    { name: 'bug-report', title: 'Bug report', updatedAt: null },
    { name: 'release-review', title: 'Release review', updatedAt: null },
    { name: 'task-brief', title: 'Task brief', updatedAt: null },
  ],
  documents: [
    { name: 'Release notes 2.4', ago: 26 * hour },
    { name: 'Refactor settings store', ago: 2 * hour },
    { name: 'Flaky login test', ago: 74 * hour },
    { name: 'Review onboarding copy', ago: 9 * 24 * hour },
    { name: 'Dark mode toggle', ago: 40 * 24 * hour },
  ],
}
const terms = [
  { from: 'mac whisper', to: 'MacWhisper' },
  { from: 'type script', to: 'TypeScript' },
  { from: 'git hub', to: 'GitHub' },
  { from: 'release please', to: 'release-please' },
]
// The shipped template files; library_read returns the body after the frontmatter, as the Rust side does.
const templates = Object.fromEntries(await Promise.all(library.templates.map(async ({ name }) => [name,
  (await readFile(new URL('../docs/specs/examples/' + name + '.md', import.meta.url), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '')])))
/** What the editor holds after opening a template: leading blank lines are dropped. */
const opened = name => templates[name].replace(/^(?:[ \t]*\n)+/, '')
const brief = [
  'Add a dark mode toggle to the settings screen of the iOS app.',
  'Please make sure that it follows the system appearance by default and also remembers whatever the user chose last time.',
  'Update the snapshot tests and keep the existing accessibility labels.',
  'Do not touch the onboarding flow.',
]
const shortened = 'Follow the system appearance by default and remember the user’s last choice.'

test('Sushi composer', async t => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  t.after(() => new Promise(resolve => app.httpServer.close(resolve)))
  // SUSHI_ENGINE=webkit runs the same scenarios in the engine the app itself uses.
  const browser = process.env.SUSHI_ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const screens = process.env.SUSHI_REVIEW_SCREENS
  if (screens) await mkdir(screens, { recursive: true })

  async function start(t, { scheme = 'dark', storage = {}, shortcutError = null } = {}) {
    const context = await browser.newContext({ viewport: { width: 750, height: 470 }, deviceScaleFactor: 2, colorScheme: scheme })
    t.after(() => context.close())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    t.after(() => assert.deepEqual(errors, [], 'no page errors'))
    await page.addInitScript(({ rules, terms, library, templates, storage, shortcutError, now }) => {
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return
        document.documentElement.classList.add('stage')
        observer.disconnect()
      }).observe(document, { childList: true })
      for (const [key, value] of Object.entries(storage)) if (!localStorage.getItem(key)) localStorage.setItem(key, value)
      const state = window.fixture = {
        copies: [], hidden: 0, reads: [], requests: [], replies: [], cancelled: [], warmed: 0, warmers: [], downloads: 0, openedDictionary: 0,
        delay: false, callbacks: [], listeners: {},
      }
      // Simulates a full localStorage for the draft: 'always', or only for chains longer than three versions.
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'sushi.draft.v3' && (state.full === 'always' || (state.full === 'big' && JSON.parse(value).versions.length > 3)))
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return setItem.call(this, key, value)
      }
      window.isTauri = true
      window.__TAURI_INTERNALS__ = {
        transformCallback: callback => state.callbacks.push(callback),
        async invoke(command, args) {
          switch (command) {
            case 'settings_load':
              if (state.badSettings) throw new Error('rules.json: expected an array')
              return { rules, terms }
            case 'warm_model':
              state.warmed++
              if (state.holdWarm) return new Promise(resolve => state.warmers.push(resolve))
              return state.note ?? null
            case 'ollama_download': state.downloads++; return
            case 'copy_text':
              if (state.badCopy) throw new Error('The clipboard is not available')
              state.copies.push(args.text); return
            case 'hide_launcher': state.hidden++; return
            case 'rewrite':
              state.requests.push(args)
              if (state.failure) throw state.failure
              // The app answers with an Edit (src/bindings/Edit.ts); a string is queued as its text,
              // any other value goes back as it is, to test replies that break the contract.
              const answer = reply => typeof reply === 'string' ? { text: reply, model: args.local ? 'qwen3.5:4b-mlx' : state.model ?? 'qwen3.5:4b-mlx' } : reply
              if (state.delay) return new Promise(resolve => { state.finish = reply => resolve(answer(reply)) })
              if (state.failures?.length && !args.local) throw state.failures.shift()
              return answer(state.replies.shift())
            case 'cancel_rewrite': state.cancelled.push(args.requestId); return
            case 'library_list':
              if (args.kind === 'templates' && state.slowTemplates)
                return new Promise(resolve => { state.releaseTemplates = () => resolve(library.templates) })
              return args.kind === 'templates' ? library.templates
              : library.documents.map(({ name, ago }) => ({ name, updatedAt: now - ago }))
            case 'library_read':
              state.reads.push(args)
              if (state.badRead) throw new Error('Could not read \'' + args.name + '\': permission denied')
              return args.kind === 'templates' ? templates[args.name] ?? '' : '\nSaved prompt: ' + args.name
            case 'dictionary_open': state.openedDictionary++; return
            case 'startup_notes': return shortcutError
            case 'plugin:event|listen': state.listeners[args.event] = state.callbacks[args.handler - 1]; return 1
            default: throw new Error('Unexpected IPC call: ' + command)
          }
        },
      }
    }, { rules, terms, library, templates, storage, shortcutError, now: Date.now() })
    await page.goto(app.resolvedUrls.local[0])
    await prompt(page).waitFor()
    await page.waitForFunction(() => window.fixture.listeners['launcher-shown'])
    return page
  }

  const prompt = page => page.getByRole('textbox', { name: 'Prompt', exact: true })
  const actionsInput = page => page.getByRole('textbox', { name: 'Actions' })
  const libraryInput = page => page.getByRole('textbox', { name: 'Library' })
  const hint = page => page.locator('#hint')
  const editorText = page => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n'))
  const diffShown = async page => await page.locator('.cm-diff-ins, .cm-diff-del').count() > 0
  const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('sushi.draft.v3')))

  async function capture(page, name) {
    if (!screens) return
    await page.mouse.move(0, 0)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(screens, name + '.png'), animations: 'disabled', caret: 'hide', omitBackground: true })
  }
  async function copy(page, expected) {
    const before = await page.evaluate(() => window.fixture.copies.length)
    await page.keyboard.press('Meta+Enter')
    await page.waitForFunction(n => window.fixture.copies.length === n + 1, before)
    assert.equal(await page.evaluate(() => window.fixture.copies.at(-1)), expected)
  }
  /** Selects a substring of a single line through the DOM selection, as a mouse drag would. */
  async function select(page, text) {
    await page.evaluate(text => {
      const line = [...document.querySelectorAll('.cm-line')].find(node => node.textContent.includes(text))
      const node = line.firstChild, at = node.textContent.indexOf(text)
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    }, text)
    await page.waitForTimeout(50)
  }
  async function paste(locator, text) {
    await locator.evaluate((node, text) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, text)
  }
  async function act(page, query, reply) {
    await page.evaluate(reply => { window.fixture.replies.push(reply) }, reply)
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill(query)
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins, .cm-diff-del').first().waitFor()
  }
  const emit = (page, event) => page.evaluate(event => window.fixture.listeners[event]({ event, payload: null }), event)

  await t.test('rewrite a selection, read the diff, walk the chain and copy each position', async t => {
    const page = await start(t)
    await capture(page, '01-empty')
    await page.keyboard.insertText(brief.join('\n'))
    await capture(page, '02-editor')

    await select(page, brief[1])
    await page.keyboard.press('Meta+k')
    assert.equal(await actionsInput(page).getAttribute('placeholder'), 'What to do with the selection?')
    assert.equal(await actionsInput(page).getAttribute('role'), null, 'a plain text field, so dictation can type into it')
    assert.equal(await actionsInput(page).getAttribute('aria-activedescendant'), null)
    await actionsInput(page).fill('shrtn')
    await page.getByRole('option', { name: 'Shorten' }).waitFor()
    assert.equal(await page.getByRole('option').first().textContent(), 'Shorten')
    assert.equal(await page.evaluate(() => window.fixture.warmed), 1)
    await capture(page, '03-action')

    await page.evaluate(reply => { window.fixture.replies.push(reply) }, shortened)
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins').first().waitFor()
    assert.equal(await page.evaluate(() => window.fixture.requests[0].text), brief[1])
    assert.match(await hint(page).textContent(), /^Shorten · qwen3\.5:4b-mlx · \d+\.\d s · 4 changes · ⌘← Back · ⌘→ Accept$/, 'the model, the time and the changed places (SUSI-5, MD-8)')
    await capture(page, '04-diff')

    const original = brief.join('\n')
    const after = [brief[0], shortened, ...brief.slice(2)].join('\n')
    // ⌘↵ on a diff accepts it: the editor turns to the right-hand text, the history stays.
    await copy(page, after)
    assert.equal(await diffShown(page), false)
    assert.equal(await editorText(page), after)
    assert.deepEqual(await draft(page), { versions: [{ text: original }, { text: after, label: 'Shorten' }], index: 1, diff: false, review: true, copied: true })
    await page.keyboard.press('Meta+ArrowLeft')
    await page.locator('.cm-diff-ins').first().waitFor()
    await page.keyboard.press('Meta+ArrowLeft')
    assert.equal(await diffShown(page), false)
    await copy(page, original)
    await page.getByRole('button', { name: 'Accept changes' }).waitFor({ state: 'detached' }).catch(() => {})
    await page.getByRole('button', { name: 'Next version' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Previous version' }).isHidden(), true)
    assert.match(await hint(page).textContent(), /⌘→ Forward/)
    await capture(page, '11-original')

    await page.keyboard.press('Meta+ArrowRight')
    await page.locator('.cm-diff-ins').first().waitFor()
    await page.getByRole('button', { name: 'Accept changes' }).click()
    assert.equal(await page.locator('.cm-diff-ins').count(), 0)
    await copy(page, after)
    await capture(page, '09-accepted')

    // Review keys turn into ordinary editor keys once the user types.
    await page.getByRole('button', { name: 'Previous version' }).click()
    await page.locator('.cm-diff-ins').first().waitFor()
    await prompt(page).focus()
    await page.keyboard.type('!')
    assert.equal(await page.locator('.cm-diff-ins').count(), 0, 'typing accepts the diff')
    assert.equal(await hint(page).textContent(), '')
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.type('Now: ')
    const typed = [brief[0], 'Now: ' + shortened + '!', ...brief.slice(2)].join('\n')
    await copy(page, typed)
    await page.keyboard.press('Meta+z')
    await copy(page, [brief[0], shortened + '!', ...brief.slice(2)].join('\n'))
    await page.getByRole('button', { name: 'Previous version' }).click()
    await copy(page, [brief[0], shortened + '!', ...brief.slice(2)].join('\n'))
    await page.getByRole('button', { name: 'Previous version' }).click()
    await page.getByRole('button', { name: 'Previous version' }).click()
    await copy(page, original)
    assert.equal(await page.evaluate(() => window.fixture.hidden), await page.evaluate(() => window.fixture.copies.length))
  })

  await t.test('copy takes A, B, B, C, C across a two-action chain; a copy on a diff accepts it', async t => {
    const page = await start(t)
    const texts = ['Check three files.', 'Check three reports.', 'Check three reports by Friday.']
    await page.keyboard.insertText(texts[0])
    await act(page, 'Shorten', texts[1])
    await act(page, 'Clarify', texts[2])
    assert.equal(await page.evaluate(() => window.fixture.requests[1].text), texts[1], 'an action on a diff uses its right-hand text')
    const at = async diff => assert.equal(await diffShown(page), diff)
    // diff(B, C): the copy takes C and lands on text C.
    await copy(page, texts[2])
    await at(false)
    await page.keyboard.press('Meta+ArrowLeft')
    await at(true)
    await page.keyboard.press('Meta+ArrowLeft')
    await at(false)
    await copy(page, texts[1])
    await page.keyboard.press('Meta+ArrowLeft')
    await at(true)
    await page.keyboard.press('Meta+ArrowLeft')
    await at(false)
    await copy(page, texts[0])
    assert.equal(await page.locator('#previous').isHidden(), true)
    await page.keyboard.press('Meta+ArrowRight')
    await at(true)
    await copy(page, texts[1])
    await at(false)
    await page.keyboard.press('Meta+ArrowRight')
    await at(true)
    await copy(page, texts[2])
    await at(false)
    assert.equal(await page.locator('#next').isHidden(), true)
    await page.keyboard.press('Meta+z')
    await at(true)
    await page.keyboard.press('Meta+Shift+z')
    await at(false)
    await copy(page, texts[2])
    await page.locator('#previous').click()
    await page.locator('#previous').click()
    await at(false)
    await copy(page, texts[1])
    await page.locator('#next').click()
    await at(true)
    await page.getByRole('button', { name: 'Copy' }).click()
    await page.waitForFunction(() => window.fixture.copies.at(-1) === 'Check three reports by Friday.')
    await at(false)
  })

  await t.test('⌘⇧↵ copies what ⌘↵ would and starts an empty prompt', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Draft one.')
    await act(page, 'Clarify', 'Draft one, clarified.')
    await page.keyboard.press('Meta+Shift+Enter')
    await page.waitForFunction(() => window.fixture.hidden === 1)
    assert.deepEqual(await page.evaluate(() => window.fixture.copies), ['Draft one, clarified.'])
    await page.locator('.cm-placeholder').waitFor()
    assert.equal(await diffShown(page), false)
    assert.equal(await page.locator('#previous').isHidden(), true, 'the history is gone')
    assert.deepEqual(await draft(page), { versions: [{ text: '' }], index: 0, diff: false, review: false, copied: false })
    await emit(page, 'launcher-shown')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Prompt')
    await page.keyboard.press('Meta+Shift+Enter')
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.fixture.copies.length), 1, 'nothing to copy on a blank prompt')
    await page.reload()
    await prompt(page).waitFor()
    await page.locator('.cm-placeholder').waitFor()
    assert.equal((await draft(page)).versions[0].text, '', 'the cleared prompt survives a restart')
  })

  await t.test('⌘⇧↵ keeps the text when the copy fails or a palette is open', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Keep me.')
    await page.evaluate(() => { window.fixture.badCopy = true })
    await page.keyboard.press('Meta+Shift+Enter')
    await page.locator('#hint.error', { hasText: 'clipboard' }).waitFor()
    assert.equal(await editorText(page), 'Keep me.')
    assert.equal(await page.evaluate(() => window.fixture.hidden), 0)
    await page.waitForTimeout(300)
    assert.equal((await draft(page)).versions[0].text, 'Keep me.')

    await page.evaluate(() => { window.fixture.badCopy = false })
    await page.keyboard.press('Meta+k')
    await actionsInput(page).waitFor()
    await page.keyboard.press('Meta+Shift+Enter')
    await page.waitForTimeout(100)
    assert.equal(await actionsInput(page).isVisible(), true, '⌘⇧↵ does nothing while a palette is open')
    assert.equal(await page.evaluate(() => window.fixture.copies.length), 0)
    assert.equal(await editorText(page), 'Keep me.')
  })

  await t.test('custom instruction, whole-prompt target and whitespace preservation', async t => {
    const page = await start(t)
    await page.keyboard.insertText('  Check the logs and report back.\n')
    await page.evaluate(() => { window.fixture.replies.push('\n  Check the logs.  \n') })
    await page.keyboard.press('Meta+k')
    assert.equal(await actionsInput(page).getAttribute('placeholder'), 'What to do with the prompt?')
    await actionsInput(page).fill('Say it like a pirate')
    const options = page.getByRole('option')
    assert.equal(await options.count(), 1)
    assert.equal(await options.first().textContent(), 'Say it like a pirateInstruction↵')
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-del').first().waitFor()
    const request = await page.evaluate(() => window.fixture.requests[0])
    assert.equal(request.instruction, 'Say it like a pirate')
    assert.equal(request.text, '  Check the logs and report back.\n')
    assert.match(await hint(page).textContent(), /^Say it like a pirate · qwen3\.5:4b-mlx · \d+\.\d s · 1 change · /)
    await copy(page, '  Check the logs.\n')
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await page.evaluate(() => { window.fixture.replies.push('  Check the logs.') })
    await actionsInput(page).press('Enter')
    // An unchanged reply says so and stays past a notice's three seconds, until the next step (SUSI-5).
    const unchanged = 'No changes: the model returned the text as it was · ⌘K Try other words'
    await page.locator('#hint', { hasText: 'No changes' }).waitFor()
    assert.equal(await hint(page).textContent(), unchanged)
    await capture(page, '22-unchanged')
    await page.waitForTimeout(3300)
    assert.equal(await hint(page).textContent(), unchanged)
    await page.keyboard.press('Meta+ArrowLeft')
    assert.match(await hint(page).textContent(), /^Say it like a pirate · /, 'a step through versions clears it')
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.press('Meta+k')
    await page.evaluate(() => { window.fixture.replies.push('  Check the logs.') })
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await page.locator('#hint', { hasText: 'No changes' }).waitFor()
    await page.keyboard.insertText(' Now.')
    assert.equal(await hint(page).textContent(), '', 'typing clears it')
  })

  await t.test('a reply without text is an error, never the word "undefined" in the prompt', async t => {
    // The site's stub kept answering with a bare string after the app began to expect { text, model }.
    const page = await start(t)
    await page.keyboard.insertText(shortened)
    await page.evaluate(() => { window.fixture.replies.push({ model: 'qwen3.5:4b-mlx' }) })
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await page.locator('#hint', { hasText: 'The edit came back without text.' }).waitFor()
    assert.equal(await page.locator('.cm-content').textContent(), shortened)
    assert.equal(await page.locator('.cm-diff-ins, .cm-diff-del').count(), 0)
  })

  await t.test('pasting a spoken rule name runs it; typing never does', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Please check every single file in the folder.')
    await page.keyboard.press('Meta+k')
    await actionsInput(page).pressSequentially('shorten')
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 0)
    await actionsInput(page).fill('')
    await page.evaluate(() => { window.fixture.replies.push('Check every file.') })
    await paste(actionsInput(page), 'Сделай короче.')
    await page.locator('.cm-diff-ins').first().waitFor()
    const request = await page.evaluate(() => window.fixture.requests[0])
    assert.equal(request.instruction, rules.find(rule => rule.id === 'shorten').instruction)
    assert.match(await hint(page).textContent(), /^Shorten/)

    // The keydown that confirms an IME composition never runs a row.
    await page.keyboard.press('Meta+k')
    assert.equal(await page.locator('#library').evaluate(node => getComputedStyle(node).opacity), '0.38', 'the bar dims behind a palette')
    await actionsInput(page).fill('Clarify')
    await actionsInput(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 1)

    // Replies get normalised line breaks; dictionary terms apply only to pasted text.
    await page.evaluate(() => { window.fixture.replies.push('Check every file in type script.\r\nThen report.') })
    await actionsInput(page).press('Enter')
    await page.locator('#hint', { hasText: 'Clarify' }).waitFor()
    await copy(page, 'Check every file in type script.\nThen report.')
  })

  await t.test('Esc cancels a pending rewrite, the editor is read-only meanwhile and a late reply is ignored', async t => {
    const page = await start(t)
    await page.keyboard.insertText(brief.join('\n'))
    await select(page, brief[1])
    await page.evaluate(() => { window.fixture.delay = true })
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await page.getByRole('button', { name: 'Cancel rewriting' }).waitFor()
    assert.equal(await prompt(page).getAttribute('contenteditable'), 'false')
    assert.equal(await page.locator('#copy').isDisabled(), true)
    assert.equal(await page.locator('#library').isDisabled(), true)
    assert.ok(await page.locator('.cm-pending').count() > 0)
    await capture(page, '10-rewriting')
    await page.keyboard.type('x')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.fixture.cancelled[0] === window.fixture.requests[0].requestId)
    assert.equal(await page.evaluate(() => window.fixture.hidden), 0, 'Esc cancels instead of hiding')
    assert.equal(await prompt(page).getAttribute('contenteditable'), 'true')
    assert.equal(await page.evaluate(() => getSelection().toString()), brief[1], 'the target selection comes back')
    await page.evaluate(() => window.fixture.finish('Late reply'))
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.cm-diff-ins').count(), 0)
    await copy(page, brief.join('\n'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.fixture.hidden === 2)
  })

  await t.test('a cancelled whole-prompt rewrite gives back the bare caret, not a selection', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Hello world')
    await act(page, 'Clarify', 'Hello there world')
    await page.keyboard.press('Meta+ArrowRight')
    await prompt(page).click()
    await page.keyboard.press('End')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    await page.evaluate(() => { window.fixture.delay = true })
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await page.getByRole('button', { name: 'Cancel rewriting' }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.requests.at(-1).text), 'Hello there world', 'no selection targets the whole prompt')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Action' }).waitFor()
    await page.keyboard.type('X')
    await copy(page, 'Hello there Xworld')
    assert.equal(await page.locator('#previous').isVisible(), true, 'the chain is not reset')
  })

  await t.test('Library: ⌘L T 1, layout-independent keys, peek fallback, scopes and dictionary', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Keep this draft.')
    const key = (code, key) => libraryInput(page).dispatchEvent('keydown', { code, key, bubbles: true, cancelable: true })
    const scope = () => page.locator('.scope > span').first().textContent()

    await page.keyboard.press('Meta+l')
    await page.getByRole('option', { name: /Release review/ }).waitFor()
    await page.getByRole('option', { name: /Dark mode toggle/ }).waitFor()
    await page.getByRole('option', { name: /GitHub/ }).waitFor()
    assert.deepEqual(await page.locator('.library .section').allTextContents(), ['TemplatesT', 'PromptsP', 'DictionaryD'])
    assert.deepEqual(await page.locator('.library .row kbd').allTextContents(), ['1', '2', '3'])
    await capture(page, '13-library-all')
    await page.keyboard.press('t')
    assert.equal(await scope(), 'Templates')
    assert.equal(await page.locator('.library .section').count(), 0)
    assert.deepEqual(await page.locator('.library .row kbd').allTextContents(), ['1', '2', '3'])
    await capture(page, '05-library')
    await page.keyboard.press('1')
    await page.waitForFunction(() => window.fixture.reads.length === 1)
    assert.deepEqual(await page.evaluate(() => window.fixture.reads[0]), { kind: 'templates', name: 'bug-report' })
    await libraryInput(page).waitFor({ state: 'hidden' })
    await copy(page, opened('bug-report'))
    await page.keyboard.type('Fix it')
    await copy(page, opened('bug-report').replace('\n\n', '\nFix it\n'), 'the caret lands under the first heading')
    await page.locator('#previous').click()
    await copy(page, 'Keep this draft.')

    // A Russian layout sends Cyrillic keys with the same physical codes.
    await page.keyboard.press('Meta+l')
    await key('KeyT', 'е')
    assert.equal(await scope(), 'Templates')
    await key('Digit2', '2')
    await page.waitForFunction(() => window.fixture.reads.length === 2)
    assert.equal(await page.evaluate(() => window.fixture.reads[1].name), 'release-review')

    // A peek followed by another letter was a word after all.
    await page.keyboard.press('Meta+l')
    await page.keyboard.press('t')
    await page.keyboard.press('a')
    assert.equal(await libraryInput(page).inputValue(), 'ta')
    assert.equal(await scope(), 'All')
    await page.getByRole('option', { name: /Task brief/ }).waitFor()
    await libraryInput(page).fill('')
    await key('KeyT', 'е')
    await key('KeyC', 'с')
    assert.equal(await libraryInput(page).inputValue(), 'ес')
    assert.equal(await scope(), 'All')

    await libraryInput(page).fill('rel')
    await page.getByRole('option', { name: /release-please/ }).waitFor()
    assert.deepEqual(await page.getByRole('option').allTextContents(),
      ['Release review', 'Release notes 2.41d', 'release-pleaserelease please'])
    assert.deepEqual(await page.locator('.library .section').allTextContents(), ['Templates', 'Prompts', 'Dictionary'])
    await capture(page, '12-library-search')

    await libraryInput(page).fill('')
    await page.keyboard.press('Tab')
    assert.equal(await scope(), 'Templates')
    await page.keyboard.press('Tab')
    assert.equal(await scope(), 'Prompts')
    assert.equal(await page.getByRole('option').first().textContent(), 'Refactor settings store2h1')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await scope(), 'Templates')
    await page.locator('.scope').click()
    await page.locator('.scope').click()
    assert.equal(await scope(), 'Dictionary')
    assert.equal(await page.locator('.library .footer').textContent(), 'Open in Editor↵')
    await capture(page, '07-dictionary')
    await page.keyboard.press('1')
    assert.equal(await libraryInput(page).inputValue(), '', 'Dictionary rows have no numbers')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.fixture.openedDictionary === 1)
    await page.getByRole('button', { name: 'Open in Editor' }).click()
    await page.waitForFunction(() => window.fixture.openedDictionary === 2)
    assert.equal(await libraryInput(page).isVisible(), true, 'the dictionary row leaves the Library open')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await scope(), 'Prompts')
    await page.keyboard.press('2')
    await page.waitForFunction(() => window.fixture.reads.length === 3)
    assert.deepEqual(await page.evaluate(() => window.fixture.reads[2]), { kind: 'documents', name: 'Release notes 2.4' })
    await copy(page, '\nSaved prompt: Release notes 2.4', 'prompts keep their leading blank lines')

    await page.keyboard.press('Meta+l')
    await page.keyboard.press('Escape')
    await libraryInput(page).waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Prompt')
    assert.equal(await page.evaluate(() => window.fixture.hidden), await page.evaluate(() => window.fixture.copies.length), 'Esc closes only the Library')
  })

  await t.test('Library selects the first template even when prompts arrive first', async t => {
    const page = await start(t)
    await page.evaluate(() => { window.fixture.slowTemplates = true })
    await page.keyboard.press('Meta+l')
    await page.getByRole('option', { name: /Refactor settings store/ }).waitFor()
    await page.getByRole('option', { name: /GitHub/ }).waitFor()
    await page.evaluate(() => window.fixture.releaseTemplates())
    await page.getByRole('option', { name: /Bug report/ }).waitFor()
    assert.equal(await page.locator('[role=option][aria-selected=true]').textContent(), 'Bug report1')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.fixture.reads.length === 1)
    assert.deepEqual(await page.evaluate(() => window.fixture.reads[0]), { kind: 'templates', name: 'bug-report' })

    // An explicit pick survives a late load.
    await page.evaluate(() => { window.fixture.slowTemplates = true })
    await page.keyboard.press('Meta+l')
    await page.getByRole('option', { name: /GitHub/ }).waitFor()
    assert.equal(await page.locator('.library .empty').count(), 0)
    await page.keyboard.press('ArrowDown')
    const picked = await page.locator('[role=option][aria-selected=true]').textContent()
    await page.evaluate(() => window.fixture.releaseTemplates())
    await page.getByRole('option', { name: /Bug report/ }).waitFor()
    assert.equal(await page.locator('[role=option][aria-selected=true]').textContent(), picked)
    await page.keyboard.press('Escape')

    // ⌘L T 1 typed faster than the list arrives still opens template 1.
    await page.evaluate(() => { window.fixture.slowTemplates = true })
    await page.keyboard.press('Meta+l')
    await page.keyboard.press('t')
    await page.keyboard.press('1')
    assert.equal(await libraryInput(page).inputValue(), '')
    await page.evaluate(() => window.fixture.releaseTemplates())
    await page.waitForFunction(() => window.fixture.reads.length === 2)
    assert.deepEqual(await page.evaluate(() => window.fixture.reads[1]), { kind: 'templates', name: 'bug-report' })
    await libraryInput(page).waitFor({ state: 'hidden' })

    // A remembered digit belongs to its scope: Tab drops it.
    await page.evaluate(() => { window.fixture.slowTemplates = true })
    await page.keyboard.press('Meta+l')
    await page.keyboard.press('t')
    await page.keyboard.press('1')
    await page.keyboard.press('Tab')
    await page.evaluate(() => window.fixture.releaseTemplates())
    await page.getByRole('option', { name: /Refactor settings store/ }).waitFor()
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.fixture.reads.length), 2)
    await page.keyboard.press('Escape')

    // While the Library covers the window, its errors show in its own message line.
    await page.evaluate(() => { window.fixture.slowTemplates = false; window.fixture.badRead = true })
    await page.keyboard.press('Meta+l')
    await page.keyboard.press('t')
    await page.keyboard.press('2')
    await page.locator('.library .footer .error', { hasText: 'permission denied' }).waitFor()
    assert.equal(await libraryInput(page).isVisible(), true)
    await page.keyboard.press('Meta+Enter')
    assert.equal(await libraryInput(page).isVisible(), true, '⌘↵ does nothing while a palette is open')
    assert.equal(await page.evaluate(() => window.fixture.copies.length), 0)
  })

  // Re-enable together with APPLY_DICTIONARY in src/main.ts.
  await t.test('dictionary terms replace pasted dictation', { skip: 'dictionary replacement is switched off' }, async t => {
    const page = await start(t)
    await paste(prompt(page), 'Open the mac whisper settings in Type Script.')
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('MacWhisper'))
    assert.equal(await editorText(page), 'Open the MacWhisper settings in TypeScript.')
  })

  await t.test('pasted dictation stays as dictated; a settings error clears itself', async t => {
    const page = await start(t)
    await paste(prompt(page), 'Open the mac whisper settings in Type Script.')
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('mac whisper'))
    assert.equal(await editorText(page), 'Open the mac whisper settings in Type Script.')

    // A settings error clears itself on the next successful load.
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(() => { window.fixture.badSettings = true })
    await focus()
    await page.locator('#hint.error', { hasText: 'rules.json' }).waitFor()
    await page.evaluate(() => { window.fixture.badSettings = false })
    await focus()
    await page.waitForFunction(() => document.querySelector('#hint').textContent === '')
  })

  await t.test('the draft and its position survive a reload', async t => {
    const page = await start(t)
    await page.keyboard.insertText('One')
    await act(page, 'Shorten', 'Two')
    await act(page, 'Clarify', 'Three')
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Meta+ArrowLeft')
    await page.waitForTimeout(300)
    await page.reload()
    await prompt(page).waitFor()
    await page.locator('.cm-diff-ins').first().waitFor()
    await copy(page, 'Two')
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Meta+ArrowLeft')
    await copy(page, 'One')

    // A copy flag saved before a restart selects the text once, at startup.
    const draft = JSON.stringify({ versions: [{ text: 'Copied before' }], index: 0, copied: true })
    const restarted = await start(t, { storage: { 'sushi.draft.v3': draft } })
    const stored = () => restarted.evaluate(() => JSON.parse(localStorage.getItem('sushi.draft.v3'))?.copied ?? true)
    assert.equal(await restarted.evaluate(() => getSelection().toString()), 'Copied before')
    assert.equal(await stored(), true, 'a hidden cold start keeps the flag')
    await emit(restarted, 'launcher-shown')
    assert.equal(await restarted.evaluate(() => getSelection().toString()), 'Copied before')
    assert.equal(await stored(), false, 'the first real show uses it up')
    await restarted.keyboard.press('ArrowRight')
    await emit(restarted, 'launcher-shown')
    assert.equal(await restarted.evaluate(() => getSelection().toString()), '', 'the select-all happens once')

    // If the first launcher-shown was missed, hiding without a copy still drops the flag.
    const missed = await start(t, { storage: { 'sushi.draft.v3': draft } })
    await missed.keyboard.press('ArrowRight')
    await missed.keyboard.press('Escape')
    await missed.waitForFunction(() => window.fixture.hidden === 1)
    assert.equal(await missed.evaluate(() => JSON.parse(localStorage.getItem('sushi.draft.v3')).copied), false)
    await emit(missed, 'launcher-shown')
    assert.equal(await missed.evaluate(() => getSelection().toString()), '', 'a kept prompt is not selected again')
  })

  await t.test('a full storage compacts the chain once, and never hides an unsaved draft', async t => {
    const page = await start(t)
    await page.keyboard.insertText('v0')
    for (const n of [1, 2, 3, 4]) await act(page, 'Clarify', 'v' + n)
    await page.evaluate(() => { window.fixture.full = 'big' })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.fixture.hidden === 1)
    await page.reload()
    await prompt(page).waitFor()
    await copy(page, 'v4')
    while (await page.locator('#previous').isVisible()) await page.locator('#previous').click()
    await copy(page, 'v0')

    await page.evaluate(() => { window.fixture.full = 'always' })
    const hidden = await page.evaluate(() => window.fixture.hidden)
    await page.keyboard.press('Escape')
    await page.locator('#hint.error', { hasText: 'Could not save the draft' }).waitFor()
    await page.keyboard.press('Meta+Enter')
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.fixture.hidden), hidden, 'the window stays open')
  })

  await t.test('after a copy the next launch selects all, so typing starts a new prompt', async t => {
    const page = await start(t, { shortcutError: 'Could not register ⌃⇧Space: taken by another app.' })
    await page.locator('#hint', { hasText: 'Could not register' }).waitFor()
    assert.equal(await page.locator('#hint.error').count(), 1)
    await page.keyboard.insertText('First prompt.')
    await act(page, 'Clarify', 'First prompt, clarified.')
    await copy(page, 'First prompt, clarified.')
    await emit(page, 'launcher-shown')
    assert.equal(await page.evaluate(() => getSelection().toString()), 'First prompt, clarified.')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type(' More.')
    await copy(page, 'First prompt, clarified. More.')
    assert.equal(await page.locator('#previous').isVisible(), true, '→ keeps editing the same chain')

    await emit(page, 'launcher-shown')
    await page.keyboard.type('Second prompt.')
    await copy(page, 'Second prompt.')
    assert.equal(await page.locator('#previous').isHidden(), true, 'typing over the selection starts a new chain')
  })

  await t.test('a right click on a selection leaves the system menu and opens no actions', async t => {
    const page = await start(t)
    await page.keyboard.insertText(brief.join('\n'))
    await select(page, brief[1])
    const prevented = await page.locator('.cm-content').evaluate(node => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(prevented, false, 'the system context menu is not suppressed')
    assert.equal(await actionsInput(page).count(), 0, 'the actions stay closed')
    assert.equal(await page.evaluate(() => getSelection().toString()), brief[1], 'the selection stays')
  })

  await t.test('an OpenRouter failure offers Edit with Ollama on the same text (MD-6, MD-8, MD-9)', async t => {
    const page = await start(t)
    await page.keyboard.insertText(brief.join('\n'))
    await select(page, brief[1])
    // A hosted model's reply names it in the hint.
    await page.evaluate(() => { window.fixture.model = 'gpt-6-luna' })
    await act(page, 'Shorten', shortened)
    assert.match(await hint(page).textContent(), /^Shorten · gpt-6-luna · \d+\.\d s · 4 changes · /)
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Meta+ArrowLeft')
    await select(page, brief[1])

    const offline = 'OpenRouter is not reachable. Edit with Ollama'
    await page.evaluate(offline => { window.fixture.failures = [offline] }, offline)
    await page.evaluate(reply => { window.fixture.replies.push(reply) }, 'Follow the system appearance.')
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await hint(page).getByRole('button', { name: 'Edit with Ollama' }).waitFor()
    assert.equal(await hint(page).textContent(), offline)
    assert.equal(await editorText(page), brief.join('\n'), 'the chain does not change')
    await capture(page, '23-openrouter-failed')
    await hint(page).getByRole('button', { name: 'Edit with Ollama' }).click()
    await page.locator('#hint', { hasText: 'qwen3.5:4b-mlx' }).waitFor()
    const [first, again] = await page.evaluate(() => window.fixture.requests.slice(-2))
    assert.deepEqual([again.instruction, again.text, again.local], [first.instruction, brief[1], true], 'the same edit, locally')
    assert.equal(first.local, false)
    assert.match(await hint(page).textContent(), /^Shorten · qwen3\.5:4b-mlx · /)

    // A changed text is not edited behind the user's back.
    await page.keyboard.press('Meta+ArrowLeft')
    await select(page, brief[2])
    await page.evaluate(() => { window.fixture.failures = ['OpenRouter is busy right now. Edit with Ollama'] })
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await hint(page).getByRole('button', { name: 'Edit with Ollama' }).waitFor()
    await page.keyboard.press('Home')
    await page.keyboard.insertText('Also: ')
    await hint(page).getByRole('button', { name: 'Edit with Ollama' }).click()
    await page.locator('#hint', { hasText: 'The text has changed.' }).waitFor()
    assert.equal((await page.evaluate(() => window.fixture.requests)).filter(r => r.local).length, 1)

    // ⌘K says at once when model.json would fail the edit; other text stays plain.
    await page.evaluate(() => { window.fixture.note = 'model.json: openrouter.key is empty.' })
    await page.keyboard.press('Meta+k')
    await page.locator('.actions .note', { hasText: 'model.json: openrouter.key is empty.' }).waitFor()
    assert.equal(await page.locator('.actions .note button').count(), 0)
  })

  await t.test('a free-form instruction leads when no action matches well', async t => {
    const page = await start(t)
    await page.keyboard.insertText(brief.join('\n'))
    await select(page, brief[1])
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('short')
    assert.deepEqual(await page.getByRole('option').allTextContents(), ['Shorten', 'shortInstruction↵'])
    await actionsInput(page).fill('')
    const sentence = 'Rewrite this more formally and add acceptance criteria'
    await paste(actionsInput(page), sentence)
    const first = page.locator('[role=option][aria-selected=true]')
    assert.equal(await first.textContent(), sentence + 'Instruction↵')
    assert.equal(await page.getByRole('option').first().textContent(), sentence + 'Instruction↵')
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 0, 'pasted text that names no action does not run')
    assert.equal(await page.locator('.actions [aria-live]').textContent(), sentence + ', Instruction')
    await capture(page, '14-instruction')
    await page.evaluate(() => { window.fixture.replies.push('It should follow the system appearance by default and remember the last choice.') })
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins').first().waitFor()
    assert.equal(await page.evaluate(() => window.fixture.requests[0].instruction), sentence)
    assert.match(await hint(page).textContent(), new RegExp('^' + sentence + ' · '))
  })

  await t.test('Turn into goal prepends /goal locally and can be stepped back', async t => {
    const page = await start(t)
    const text = brief.join('\n')
    await page.keyboard.insertText(text)
    await select(page, brief[1])
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('goal')
    assert.equal(await page.getByRole('option').first().textContent(), 'Turn into goal')
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins', { hasText: '/goal' }).waitFor()
    assert.match(await hint(page).textContent(), /^Turn into goal · 1 change · ⌘←/, 'a prefix action has no model time')
    await capture(page, '15-goal')
    await copy(page, '/goal ' + text)
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 0, 'no model call')
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Meta+ArrowLeft')
    await copy(page, text)
    await page.keyboard.press('Meta+k')
    await paste(actionsInput(page), 'Преврати в цель.')
    await page.locator('.cm-diff-ins', { hasText: '/goal' }).waitFor()
    await copy(page, '/goal ' + text)
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('goal')
    await actionsInput(page).press('Enter')
    await page.locator('#hint', { hasText: 'No changes' }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 0)
  })

  // The messages as src-tauri/src/rewrite.rs returns them; Tauri rejects with the bare string.
  const ollama = {
    missing: 'Ollama is not installed on this Mac. Download Ollama',
    model: 'Install the local model with ollama pull qwen3.5:4b-mlx',
    serve: 'Ollama did not start. Run ollama serve and try again.',
  }
  const oneLine = page => hint(page).evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().height <= 22)
  async function failEdit(page, failure) {
    await page.evaluate(failure => { window.fixture.failure = failure }, failure)
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('Shorten')
    await actionsInput(page).press('Enter')
    await page.locator('#hint.error').waitFor()
  }

  await t.test('without Ollama the hint links to the download, and the prompt stays as it was', async t => {
    const page = await start(t)
    await page.keyboard.insertText(brief.join('\n'))
    await failEdit(page, ollama.missing)
    assert.equal(await hint(page).textContent(), ollama.missing)
    assert.equal(await oneLine(page), true, 'the hint fits one line at 750 × 470')
    assert.equal(await editorText(page), brief.join('\n'))
    await capture(page, '18-no-ollama')
    await page.getByRole('button', { name: 'Download Ollama' }).click()
    await page.waitForFunction(() => window.fixture.downloads === 1)
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Prompt', 'the click keeps the caret in the prompt')
    assert.deepEqual(await page.evaluate(() => window.fixture.copies), [])

    // What needs no model still works.
    await page.keyboard.press('Meta+k')
    await actionsInput(page).fill('goal')
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins', { hasText: '/goal' }).waitFor()
    assert.equal(await page.locator('#hint.error').count(), 0)
    await copy(page, '/goal ' + brief.join('\n'))
  })

  await t.test('a missing model or server offers its command to copy', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Check the logs and report back.')
    for (const [failure, command] of [[ollama.model, 'ollama pull qwen3.5:4b-mlx'], [ollama.serve, 'ollama serve']]) {
      await failEdit(page, failure)
      assert.equal(await hint(page).textContent(), failure)
      assert.equal(await oneLine(page), true, 'the hint fits one line at 750 × 470')
      if (command === 'ollama serve') await capture(page, '20-ollama-serve')
      else await capture(page, '19-no-model')
      await page.getByRole('button', { name: 'Copy ' + command }).click()
      await page.waitForFunction(command => window.fixture.copies.at(-1) === command, command)
      await page.locator('#hint', { hasText: 'Copied. Run it in Terminal, then try again.' }).waitFor()
      assert.equal(await page.locator('#hint.error').count(), 0)
      assert.equal(await page.evaluate(() => window.fixture.hidden), 0, 'copying the command keeps the panel open')
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Prompt')
    }
    // Other errors stay plain text.
    await failEdit(page, 'Local Ollama request failed: connection reset')
    assert.equal(await hint(page).locator('button').count(), 0)
  })

  await t.test('⌘K notes a missing Ollama or model quietly, and actions still run', async t => {
    const page = await start(t)
    const note = page.locator('.actions .footer')
    await page.keyboard.insertText(brief.join('\n'))
    await page.keyboard.press('Meta+k')
    await actionsInput(page).waitFor()
    await page.waitForFunction(() => window.fixture.warmed === 1)
    assert.equal(await note.isVisible(), false, 'nothing to say while Ollama is ready')
    await page.keyboard.press('Escape')

    await page.evaluate(note => { window.fixture.note = note }, ollama.missing)
    await page.keyboard.press('Meta+k')
    await note.getByRole('button', { name: 'Download Ollama' }).waitFor()
    assert.equal(await note.textContent(), ollama.missing)
    assert.equal(await page.locator('#hint.error').count(), 0, 'a note, not an error')
    await capture(page, '21-actions-note')
    await note.getByRole('button', { name: 'Download Ollama' }).click()
    await page.waitForFunction(() => window.fixture.downloads === 1)
    assert.equal(await actionsInput(page).evaluate(node => node === document.activeElement), true, 'the field keeps the caret')
    await actionsInput(page).fill('goal')
    await actionsInput(page).press('Enter')
    await page.locator('.cm-diff-ins', { hasText: '/goal' }).waitFor()

    await page.evaluate(note => { window.fixture.note = note }, ollama.model)
    await page.keyboard.press('Meta+k')
    await note.getByRole('button', { name: 'Copy ollama pull qwen3.5:4b-mlx' }).click()
    await page.waitForFunction(() => window.fixture.copies.at(-1) === 'ollama pull qwen3.5:4b-mlx')
    await note.getByText('Copied. Run it in Terminal, then try again.').waitFor()
    assert.equal(await actionsInput(page).isVisible(), true, 'the palette stays open')

    await page.evaluate(() => { window.fixture.note = null })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.waitForFunction(() => window.fixture.warmed === 4)
    assert.equal(await note.isVisible(), false, 'the note goes once the cause is fixed')
  })

  await t.test('only Sushi\'s own messages get actions; any other text stays plain', async t => {
    const page = await start(t)
    await page.keyboard.insertText('Check the logs and report back.')
    for (const hostile of [
      'Ollama: pull model manifest: file does not exist. Install the model with ollama pull qwen3.5:4b-mlx',
      'Ollama: run ollama pull other-model:latest first',
      'Ollama is not installed on this Mac. Download Ollama now',
      'Error: Download Ollama',
      'ollama serve',
    ]) {
      await failEdit(page, hostile)
      assert.equal(await hint(page).textContent(), hostile)
      assert.equal(await hint(page).locator('button').count(), 0, hostile)
      await page.keyboard.press('Meta+k')
      await actionsInput(page).waitFor()
      await page.keyboard.press('Escape')
    }
    await page.evaluate(note => { window.fixture.note = note }, 'Install the local model with ollama pull other-model')
    await page.keyboard.press('Meta+k')
    await page.locator('.actions .footer .note').waitFor()
    assert.equal(await page.locator('.actions .footer button').count(), 0)
  })

  await t.test('keyboard: Tab reaches the actions in the ⌘K note and in the hint line', async t => {
    const page = await start(t)
    const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent)
    await page.keyboard.insertText('Check the logs and report back.')

    // The ⌘K note: Tab from the field to its button, Tab or Shift-Tab back, Enter and Space activate, Esc closes.
    await page.evaluate(note => { window.fixture.note = note }, ollama.missing)
    await page.keyboard.press('Meta+k')
    await page.locator('.actions .footer button').waitFor()
    await page.keyboard.press('Tab')
    assert.equal(await focused(), 'Download Ollama')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.fixture.downloads === 1)
    assert.equal(await page.evaluate(() => window.fixture.requests.length), 0, 'Enter on the link runs no action')
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.fixture.downloads === 2)
    await page.keyboard.press('Tab')
    assert.equal(await focused(), 'Actions', 'Tab goes back to the field')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await focused(), 'Actions', 'Shift-Tab goes back to the field')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await actionsInput(page).waitFor({ state: 'hidden' })
    assert.equal(await focused(), 'Prompt')

    await page.evaluate(note => { window.fixture.note = note }, ollama.model)
    await page.keyboard.press('Meta+k')
    await page.locator('.actions .footer button').waitFor()
    await page.keyboard.press('Tab')
    assert.equal(await focused(), 'Copy ollama pull qwen3.5:4b-mlx')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.fixture.copies.at(-1) === 'ollama pull qwen3.5:4b-mlx')
    assert.equal(await focused(), 'Actions', 'after the copy the caret is back in the field')
    await page.keyboard.press('Escape')

    // The hint line: Tab from the prompt reaches its button, Enter activates it.
    await page.evaluate(() => { window.fixture.note = null })
    await failEdit(page, ollama.serve)
    assert.equal(await focused(), 'Prompt')
    await page.keyboard.press('Tab')
    assert.equal(await focused(), 'Copy ollama serve')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.fixture.copies.at(-1) === 'ollama serve')
    assert.equal(await focused(), 'Prompt', 'after the copy the caret is back in the prompt')
    await failEdit(page, ollama.missing)
    await page.keyboard.press('Tab')
    assert.equal(await focused(), 'Download Ollama')
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.fixture.downloads === 3)
  })

  await t.test('a late warm-up answer from an earlier ⌘K never overwrites a newer one', async t => {
    const page = await start(t)
    const note = page.locator('.actions .footer')
    await page.keyboard.insertText('Check the logs and report back.')
    await page.evaluate(() => { window.fixture.holdWarm = true })
    await page.keyboard.press('Meta+k')
    await page.waitForFunction(() => window.fixture.warmers.length === 1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.waitForFunction(() => window.fixture.warmers.length === 2)
    // The model was installed in between: the newer opening hears "ready" first, the older one "missing" last.
    await page.evaluate(() => window.fixture.warmers[1](null))
    await page.evaluate(model => window.fixture.warmers[0](model), ollama.model)
    await page.waitForTimeout(100)
    assert.equal(await note.isVisible(), false, 'the earlier answer is ignored')

    // And the other way round: a newer "missing" answer stays, an older "ready" does not clear it.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.waitForFunction(() => window.fixture.warmers.length === 3)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+k')
    await page.waitForFunction(() => window.fixture.warmers.length === 4)
    await page.evaluate(model => window.fixture.warmers[3](model), ollama.model)
    await note.getByText(ollama.model).waitFor()
    await page.evaluate(() => window.fixture.warmers[2](null))
    await page.waitForTimeout(100)
    assert.equal(await note.textContent(), ollama.model)
  })

  await t.test('light appearance', async t => {
    const page = await start(t, { scheme: 'light' })
    await capture(page, '01-empty-light')
    await page.keyboard.insertText(brief.join('\n'))
    await select(page, brief[1])
    await act(page, 'Shorten', shortened)
    await capture(page, '04-diff-light')
  })
})
