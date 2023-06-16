// The settings window in a stage run (tests/stage/settings.sh). settings.sh puts `const MODE = 'frame' | 'e2e'`
// and `const FRAME = '…'` in front of it, and the app runs the file once the settings page has loaded.
// It drives the real page through the DOM, as tests/stage/frames.js does for the panel. Lines for the script go
// out as `stage-report` events, which a stage run prints to stdout; the script answers a STEP line by putting
// `ack-<step>.md` into the library folder (SUSHI_LIBRARY_DIR), which the page sees through library_list.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)
  const report = line => invoke('plugin:event|emit', { event: 'stage-report', payload: line })
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
  const all = selector => [...document.querySelectorAll(selector)]
  const named = (name, selector = 'button, [role=switch], [role=radio], input, textarea') =>
    all(selector).find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name)
  const click = async (name, selector) => {
    const node = await until(`“${name}”`, () => { const n = named(name, selector); return n && !n.disabled && n })
    node.click()
    await sleep(80)
  }
  const type = (node, value) => {
    node.focus()
    node.value = value
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const enter = node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  const nav = async id => { document.getElementById('nav-' + id).click(); await until('pane ' + id, () => document.getElementById('pane-title').textContent.toLowerCase() === id) }
  const heads = () => all('.action-head .action-name').map(n => n.textContent.trim())
  const prefs = () => invoke('prefs_load')

  await until('the first pane', () => document.querySelector('.pane-body'))

  if (MODE === 'frame') {
    const pane = FRAME.split('-')[0]
    if (FRAME === 'keyboard-shortcut') await click('Keyboard shortcut', '[role=radio]')
    if (FRAME === 'model-expanded') all('.provider-head').find(n => /OpenRouter/.test(n.textContent))?.click()
    if (FRAME === 'actions-editor') all('.action-head').find(n => /Shorten/.test(n.textContent))?.click()
    if (FRAME === 'library-dictionary') {
      await until('the terms', () => document.querySelector('.terms .term'))
      const scroller = document.getElementById('pane')
      scroller.scrollTop = scroller.scrollHeight
    }
    if (FRAME === 'about-build-details') await click('Build details')
    if (document.getElementById('pane-title').textContent.toLowerCase() !== pane) await report(`FRAME ${FRAME} on the wrong pane`)
    // A click leaves its target focused; a frame shows the window at rest, without a focus ring.
    document.activeElement?.blur()
    // Two frames for the redraw and the scroll position to settle.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await sleep(150)
    await report('READY ' + FRAME)
    return
  }

  // ——— The end-to-end run: real page, real IPC, real Rust, real files ———
  const check = (name, ok, detail = '') => report(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  const step = async name => {
    await report('STEP ' + name)
    await until('the ack of ' + name, async () => (await invoke('library_list', { kind: 'documents' })).some(e => e.name === 'ack-' + name), 60000)
  }
  const refocus = () => window.dispatchEvent(new Event('focus'))
  const attempt = async (name, body) => {
    try { await body() } catch (error) { await check(name, false, String(error?.message ?? error)) }
  }

  try {
    await step('launched')
    // The script emptied the folder and wrote a hotkey.json of its own: one read seeds what it seeds.
    await prefs()
    await step('loaded')
    refocus()

    await attempt('keyboard: Keyboard shortcut turns Caps Lock off', async () => {
      await nav('keyboard')
      // The page must have read the hand-written file first: a save with an older revision is refused.
      await until('the hand-written shortcut on the page', () => /Option Command P/.test(document.getElementById('keyboard-recorder')?.getAttribute('aria-label') ?? ''))
      await click('Keyboard shortcut', '[role=radio]')
      await until('capsLock false', async () => (await prefs()).keyboard.capsLock === false, 8000).catch(error => {
        throw new Error(`${error.message}; the pane says “${document.getElementById('pane-state').textContent}” ${all('.banner, .field-error, #toast').map(n => n.textContent.trim()).join(' | ')}`)
      })
      const checked = named('Keyboard shortcut', '[role=radio]')?.getAttribute('aria-checked') === 'true'
      await check('keyboard: the page shows Keyboard shortcut chosen', checked)
    })
    await step('caps-off')

    let before = []
    await attempt('actions: add Polite', async () => {
      await nav('actions')
      before = (await prefs()).actions.rules.map(r => r.id)
      await click('Add action')
      const name = await until('the Name field', () => named('Name', 'input'))
      type(name, 'Polite')
      enter(name)
      await sleep(100)
      type(await until('the Instruction field', () => named('Instruction', 'textarea')), 'Make the tone polite.')
      const phrase = await until('the phrase field', () => named('Add a phrase', 'input'))
      type(phrase, 'be polite')
      enter(phrase)
      await until('Polite in rules.json', async () => (await prefs()).actions.rules.some(r => r.name === 'Polite' && r.aliases.length === 1))
    })
    await step('added')

    await attempt('actions: move Polite to the top', async () => {
      for (let i = 0; i < 20 && heads()[0] !== 'Polite'; i++) {
        const at = heads().indexOf('Polite')
        await click('Move Polite up')
        await until('one place up', async () => (await prefs()).actions.rules.findIndex(r => r.name === 'Polite') === at - 1)
      }
      await check('actions: the list shows Polite first', heads()[0] === 'Polite', heads().join(', '))
    })
    await step('moved')

    await attempt('actions: delete Polite', async () => {
      await click('Delete Polite')
      await until('Polite gone', async () => !(await prefs()).actions.rules.some(r => r.name === 'Polite'))
      await check('actions: the toast offers Undo', !!document.getElementById('toast-undo'))
    })
    await step('deleted')

    await attempt('actions: Undo restores Polite', async () => {
      await click('Undo')
      await until('Polite back', async () => (await prefs()).actions.rules[0]?.name === 'Polite')
      await check('actions: the list shows Polite again', heads()[0] === 'Polite', heads().join(', '))
    })
    await step('undone')

    let existing = ''
    await attempt('dictionary: add a term', async () => {
      await nav('library')
      existing = (await prefs()).library.dictionary.terms[0].from
      await click('Add term')
      const from = all('[aria-label="Heard as"]').at(-1), to = all('[aria-label="Written as"]').at(-1)
      type(from, 'pull request')
      type(to, 'PR')
      enter(to)
      await until('pull request in dictionary.json', async () => (await prefs()).library.dictionary.terms.some(t => t.from === 'pull request'))
    })
    await step('term-added')

    await attempt('dictionary: a duplicate Heard as is refused', async () => {
      await click('Add term')
      const row = all('.term').at(-1)
      const from = row.querySelector('[aria-label="Heard as"]'), to = row.querySelector('[aria-label="Written as"]')
      type(from, existing)
      type(to, 'Duplicate')
      enter(to)
      const flagged = await until('the refusal at the field', () =>
        all('.term').at(-1).querySelector('[aria-label="Heard as"]')?.getAttribute('aria-invalid') === 'true', 5000).catch(() => false)
      const error = all('.term').at(-1).querySelector('.field-error')?.textContent ?? ''
      await sleep(500)
      const terms = (await prefs()).library.dictionary.terms
      await check('dictionary: the duplicate row is marked invalid', !!flagged, error)
      await check('dictionary: Rust still reads one “' + existing + '”', terms.filter(t => t.from.toLowerCase() === existing.toLowerCase()).length === 1)
    })
    await step('duplicate')
    // Drop the refused draft, so the pane is clean again.
    all('.term').at(-1)?.querySelector('button')?.click()
    await sleep(200)

    await attempt('about: logging on', async () => {
      await nav('about')
      await click('Log panel activity', '[role=switch]')
      await until('record true', async () => (await prefs()).about.diagnostics.record === true)
    })
    await step('log-on')
    await attempt('about: logging off', async () => {
      await click('Log panel activity', '[role=switch]')
      await until('record false', async () => {
        const about = (await prefs()).about.diagnostics
        return about.file.status === 'ok' && about.record === false
      })
    })
    await step('log-off')

    await nav('actions')
    await step('hand-edit')
    await attempt('actions: a hand edit shows after focus', async () => {
      refocus()
      await until('the hand-edited action', () => heads().includes('Edited by hand'))
      await check('actions: the hand edit shows in the list', true, heads().join(', '))
    })

    await step('break')
    await attempt('actions: a broken rules.json shows the invalid banner', async () => {
      refocus()
      await until('the invalid banner', () => all('.banner').some(n => /Actions couldn’t be loaded\./.test(n.textContent)))
      await check('actions: the invalid banner shows', true, document.getElementById('pane-state').textContent)
      await click('Restore default actions…')
      await click('Restore defaults')
      await until('the default actions', () => heads().includes('Shorten') && !all('.banner').some(n => /couldn’t be loaded/.test(n.textContent)))
      await check('actions: the defaults show again', true, heads().join(', '))
    })
    await step('restored')
  } catch (error) {
    await check('the run itself', false, String(error?.message ?? error))
  }
  await report('DONE')
})()
