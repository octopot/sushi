// The frames for the background capture of the real window. capture.sh puts `const FRAME = '…'` in front of it,
// and the app in SUSHI_STAGE mode runs the file after every page load.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  // A window under the wallpaper counts as hidden, and WebKit does not advance the entry animations.
  const still = document.createElement('style')
  still.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.head.append(still)

  const A = 'Add a dark mode toggle to the settings screen of the iOS app.\nPlease make sure that it follows the system appearance by default and also remembers whatever the user chose last time.\nUpdate the snapshot tests and keep the existing accessibility labels.\nDo not touch the onboarding flow.'
  const B = 'Add a dark mode toggle to the settings screen of the iOS app.\nFollow the system appearance by default and remember the user’s last choice.\nUpdate the snapshot tests and keep the existing accessibility labels.\nDo not touch the onboarding flow.'
  const text = value => ({ versions: [{ text: value }], index: 0, diff: false, review: false, copied: false })
  const draft = FRAME === '01-empty' ? text('')
    : ['04-diff', '16-copy-accepts', '17-copy-clears'].includes(FRAME) ? { versions: [{ text: A }, { text: B, label: 'Shorten' }], index: 1, diff: true, review: true, copied: false }
    : text(A)
  if (!sessionStorage.getItem('stage')) {
    localStorage.setItem('sushi.draft.v3', JSON.stringify(draft))
    sessionStorage.setItem('stage', '1')
    location.reload()
    return
  }
  await sleep(400)
  const key = (target, code, value, options = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { code, key: value, bubbles: true, cancelable: true, ...options }))
  if (FRAME === '03-action') {
    const view = document.querySelector('.cm-content').cmTile.root.view
    view.dispatch({ selection: { anchor: A.indexOf('Please'), head: A.indexOf('\nUpdate') } })
    key(document.body, 'KeyK', 'k', { metaKey: true })
    await sleep(300)
    const input = document.querySelector('.palette.actions input')
    input.value = 'shrtn'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // Ollama's answers for the frames without it; the stage build never contacts Ollama.
  const ollama = {
    '18-no-ollama': 'Ollama is not installed on this Mac. Download Ollama',
    '19-no-model': 'Install the local model with ollama pull qwen3.5:4b-mlx',
    '21-actions-note': 'Ollama is not installed on this Mac. Download Ollama',
  }[FRAME]
  if (ollama) {
    const internals = window.__TAURI_INTERNALS__, invoke = internals.invoke.bind(internals)
    internals.invoke = (command, ...rest) => command === 'rewrite' ? Promise.reject(ollama)
      : command === 'warm_model' ? Promise.resolve(ollama) : invoke(command, ...rest)
    key(document.body, 'KeyK', 'k', { metaKey: true })
    await sleep(300)
    if (FRAME !== '21-actions-note') {
      const input = document.querySelector('.palette.actions input')
      input.value = 'Shorten'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      key(input, 'Enter', 'Enter')
    }
  }
  // A copy in capture mode leaves the clipboard alone and keeps the window: only the result in the editor shows.
  if (FRAME === '16-copy-accepts') key(document.body, 'Enter', 'Enter', { metaKey: true })
  if (FRAME === '17-copy-clears') key(document.body, 'Enter', 'Enter', { metaKey: true, shiftKey: true })
  if (['05-library', '07-dictionary', '13-library-all'].includes(FRAME)) {
    key(document.body, 'KeyL', 'l', { metaKey: true })
    await sleep(600)
    const input = document.querySelector('.palette.library input')
    if (FRAME === '05-library') key(input, 'KeyT', 't')
    if (FRAME === '07-dictionary') key(input, 'KeyD', 'd')
  }
})()
