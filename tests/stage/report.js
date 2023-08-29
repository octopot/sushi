// The window of Report a problem in a stage run (tests/stage/report.sh): the app runs this file once
// the report's page has loaded. It drives the real page through the DOM; the real commands answer,
// with what a stage run never does left out (no recording, no file saved, no clipboard, no model).
// Lines go out as `stage-report` events, which a stage run prints to stdout.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)
  const report = line => invoke('plugin:event|emit', { event: 'stage-report', payload: line })
  const check = (name, ok, detail = '') => report(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  // A window under the wallpaper counts as hidden, and WebKit does not advance the entry animations.
  const still = document.createElement('style')
  still.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.head.append(still)
  async function until(what, test, ms = 15000) {
    const end = Date.now() + ms
    for (;;) {
      let value
      try { value = await test() } catch { value = null }
      if (value) return value
      if (Date.now() > end) throw new Error('timed out waiting for ' + what)
      await sleep(60)
    }
  }
  const button = name => [...document.querySelectorAll('.report-footer button')].find(b => b.firstChild?.textContent === name)
  const click = async name => (await until(`the button ${name}`, () => button(name))).click()
  const heading = text => until(`the step ${text}`, () => document.querySelector('.report h2')?.textContent === text)
  const field = label => until(`the field ${label}`, () => document.querySelector(`.report textarea[aria-label="${label}"]`))
  const type = (area, text) => { area.value = text; area.dispatchEvent(new Event('input', { bubbles: true })) }

  try {
    const first = await field('What went wrong')
    await check('the window loads its page and starts at the description', document.title === 'Report a problem' && !!first)
    await check('the title, the edges and the footer move the window',
      ['.titlebar', '.report', '.report-title', '.report-footer'].every(s => document.querySelector(s)?.hasAttribute('data-tauri-drag-region')))
    type(first, 'Stage run: the panel hides after ⌘A.')
    await click('Next')
    // No model answers in a stage run: the standard questions.
    const question = await field('What were you doing when it happened?')
    await check('the standard questions show when no model answers', document.querySelectorAll('.report textarea').length === 3)
    type(question, 'Pressed ⌘A.')
    await click('Next')
    await heading('Reproduce it now?')
    await click('Start recording')
    await heading('Recording…')
    await check('the window stays at Recording… and offers only to finish', !button('Skip') && !!button('Finish recording'))
    if (FRAME === 'recording') { await report('READY recording'); return }
    await click('Finish recording')
    const text = (await field('Report')).value
    await check('the report has the description and the answer', text.includes('Stage run: the panel hides after ⌘A.') && text.includes('Pressed ⌘A.'))
    await check('the report has the build block', /## Build\n\nsushi:\n {2}version/.test(text), text.match(/## Build[\s\S]{0,60}/)?.[0].replace(/\n/g, ' '))
    // The panel's page, never shown in this run, said what it shows: the round trip of RP-6.
    const panel = text.match(/^panel: .*$/m)?.[0] ?? ''
    await check('the panel answered for the snapshot', panel === 'panel: editor view, 1 version in the chain, an edit not running', panel)
    await check('the snapshot names the files without their text', /^ {2}rules\.json: present, valid, \d+ actions$/m.test(text) && /^hotkey: capsLock /m.test(text))
    // A stage run never asks the login keychain, not even whether an item exists.
    const connected = text.match(/^connected providers: .*$/m)?.[0] ?? ''
    await check('the login keychain is not asked', connected === 'connected providers: none', connected)
    if (FRAME === 'report') { await report('READY report'); return }
    await click('Copy')
    await until('the status after a copy', () => document.querySelector('.report-status').textContent.startsWith('Copied.'))
    await check('Copy answers and the report stays for the next time', !!document.querySelector('.report textarea[aria-label="Report"]'))
    await check('Save… carries its key', button('Save…')?.textContent.includes('⌘S'))
  } catch (error) {
    await check('the run finished', false, String(error))
  }
  await report('DONE')
})()
