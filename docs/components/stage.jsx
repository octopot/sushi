'use client'

// The landing page's centrepiece: the real Susi frontend (public/demo/, built from ../src by
// `npm run demo`) on a pretend desktop. A guided tour drives it while the visitor watches; the first
// click, tap or key inside the panel hands it over. Keys reach the panel only while it has focus.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keys } from './keys'

const sample = {
  typed: 'Add a dark mode toggle to the settings screen.\n',
  dictated: 'Please make sure that it basically follows the system appearance by default and also remembers whatever the user picked last time.\nUpdate the snapshot tests and dont touch the onboarding flow',
  long: 'Please make sure that it basically follows the system appearance by default and also remembers whatever the user picked last time.',
  typo: 'Update the snapshot tests and dont touch the onboarding flow',
}

const steps = [
  ['summon', 'Summon'],
  ['write', 'Write or dictate'],
  ['select', 'Select'],
  ['rewrite', 'Rewrite'],
  ['walk', 'Compare'],
  ['voice', 'Say an action'],
  ['goal', 'Make it a goal'],
  ['copy', 'Send'],
]

const empty = { text: '', selection: false, canBack: false, canForward: false, diff: false, busy: false, palette: null }

export function Stage() {
  const root = useRef(null)
  const frame = useRef(null)
  const panel = useRef(null)
  const api = useRef(null)
  const tour = useRef(null)
  const phaseRef = useRef('loading')
  const visible = useRef(false)
  const loops = useRef(0)
  const [phase, setPhaseState] = useState('loading')
  const [shown, setShown] = useState(false)
  const [hud, setHud] = useState(null)
  const [step, setStep] = useState(null)
  const [demo, setDemo] = useState(empty)
  const [pasted, setPasted] = useState(null)
  const [toast, setToast] = useState(null)
  const [theme, setTheme] = useState('dark')
  const setPhase = value => { phaseRef.current = value; setPhaseState(value) }

  const say = useCallback((id, keys, label) => {
    setStep(id)
    setHud(previous => ({ keys, label, n: (previous?.n ?? 0) + 1 }))
  }, [])

  const notify = useCallback(text => {
    setToast(previous => ({ text, n: (previous?.n ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3800)
    return () => clearTimeout(timer)
  }, [toast])

  const stopTour = useCallback(() => {
    tour.current?.abort()
    tour.current = null
    api.current?.setTour(false)
    api.current?.setSpeed(1)
  }, [])

  /** The visitor takes the panel: the tour stops where it is and keys go to the panel. */
  const takeOver = useCallback((focus = true) => {
    if (phaseRef.current === 'yours') return
    stopTour()
    setPhase('yours')
    setHud(null)
    setStep(null)
    setShown(true)
    if (focus) api.current?.focus()
  }, [stopTour])

  const summon = useCallback(() => {
    setShown(true)
    api.current?.show()
    if (phaseRef.current === 'yours') setTimeout(() => api.current?.focus(), 30)
  }, [])

  const play = useCallback(async () => {
    const demoApi = api.current
    if (!demoApi) return
    tour.current?.abort()
    const controller = new AbortController()
    tour.current = controller
    const { signal } = controller
    const wait = ms => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
    const until = async (check, limit = 6000) => {
      for (const start = Date.now(); !check(demoApi.state()) && Date.now() - start < limit;) await wait(60)
    }
    const guard = () => { if (signal.aborted) throw signal.reason }
    try {
      setPhase('tour')
      demoApi.setTour(true)
      demoApi.setSpeed(1)
      demoApi.clear()
      setShown(false)
      setPasted(null)
      await wait(900)
      say('summon', ['⌘', '⇧', 'Space'], 'From any app')
      await wait(650)
      setShown(true)
      demoApi.show()
      await wait(750)
      say('write', null, 'Write the task')
      await demoApi.type(sample.typed, 30); guard()
      say('write', ['🎙'], 'Or dictate it')
      await demoApi.dictate(sample.dictated, 170); guard()
      await wait(700)
      say('select', null, 'Select what needs work')
      demoApi.select(sample.long)
      await wait(1300)
      say('rewrite', ['⌘', 'K'], 'Actions')
      demoApi.key('KeyK')
      await wait(500)
      await demoApi.query('short', 120); guard()
      await wait(450)
      say('rewrite', ['↵'], 'Shorten')
      demoApi.enter()
      await wait(350)
      say('rewrite', null, 'Rewriting with a local model…')
      await until(state => state.diff)
      say('rewrite', null, 'The edit, right in your text')
      await wait(2600)
      say('walk', ['⌘', '←'], 'Back to your words')
      demoApi.key('ArrowLeft')
      await wait(1700)
      say('walk', ['⌘', '→'], 'Forward to the diff')
      demoApi.key('ArrowRight')
      await wait(1300)
      say('walk', ['⌘', '→'], 'Accept')
      demoApi.key('ArrowRight')
      await wait(1100)
      say('voice', null, 'Select a sentence')
      demoApi.select(sample.typo)
      await wait(900)
      say('voice', ['⌘', 'K'], 'Then say “fix grammar”')
      demoApi.key('KeyK')
      await wait(900)
      say('voice', ['🎙'], '“Fix grammar.”')
      demoApi.paste('Fix grammar.')
      await wait(300)
      await until(state => state.diff)
      await wait(1800)
      say('voice', ['⌘', '→'], 'Accept')
      demoApi.key('ArrowRight')
      await wait(1000)
      say('goal', ['⌘', 'K'], 'A long task for your agent?')
      demoApi.key('KeyK')
      await wait(500)
      await demoApi.query('goal', 130); guard()
      await wait(450)
      say('goal', ['↵'], 'Turn into goal')
      demoApi.enter()
      await wait(2200)
      say('copy', ['⌘', '↵'], 'Copy and go back')
      await wait(500)
      demoApi.key('Enter')
      await wait(3600)
      say('summon', ['⌘', '⇧', 'Space'], 'Next time, your last prompt waits, selected')
      await wait(600)
      setShown(true)
      demoApi.show()
      await wait(3400)
      setHud(null)
      setStep(null)
      loops.current++
      // Replays while the stage stays in view, a few times at most.
      await wait(5000)
      if (visible.current && loops.current < 3) void play()
      else setPhase('paused')
    } catch {
      // Aborted: the visitor took over or replayed.
    }
  }, [say])

  /** With reduced motion, show a finished edit instead of a moving tour. */
  const still = useCallback(async () => {
    const demoApi = api.current
    setPhase('paused')
    demoApi.setTour(true)
    demoApi.setSpeed(0)
    demoApi.clear()
    await demoApi.type(sample.typed + sample.dictated, 0)
    demoApi.select(sample.long)
    demoApi.key('KeyK')
    await demoApi.query('Shorten', 0)
    demoApi.enter()
    setShown(true)
    setStep('rewrite')
  }, [])

  // Messages from the panel.
  useEffect(() => {
    const node = frame.current
    if (!node) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const handle = ({ detail }) => {
      switch (detail.type) {
        case 'ready': {
          api.current = node.contentWindow.susiDemo
          api.current.setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark')
          if (reduced.matches) void still()
          else { setPhase('ready'); if (visible.current) void play() }
          break
        }
        case 'interact': takeOver(false); break
        case 'state': setDemo(detail); break
        case 'copy':
          setPasted({ text: detail.text, n: Date.now() })
          if (!detail.tour) notify('Copied to your clipboard, as ⌘↵ does in the app.')
          break
        case 'hide':
          setShown(false)
          if (phaseRef.current === 'yours') setTimeout(() => root.current?.querySelector('.stage-summon')?.focus(), 50)
          break
        case 'notice': notify(detail.text); break
      }
    }
    node.addEventListener('susi', handle)
    // The panel may have loaded before React attached the listener.
    if (node.contentWindow?.susiDemo && !api.current) handle({ detail: { type: 'ready' } })
    return () => node.removeEventListener('susi', handle)
  }, [play, still, takeOver, notify])

  // Start the tour when the stage comes into view.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
      if (entry.isIntersecting && phaseRef.current === 'ready') void play()
    }, { threshold: 0.2 })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [play])

  // Follow the site's theme switch.
  useEffect(() => {
    const html = document.documentElement
    const sync = () => {
      const next = html.classList.contains('light') ? 'light' : 'dark'
      setTheme(next)
      api.current?.setTheme(next)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => tour.current?.abort(), [])

  // The app's layout needs about 600 px; on a narrow screen the panel renders at that width, scaled down.
  const [fit, setFit] = useState(null)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setFit(width >= 600 ? null : { scale: width / 600, height: height * 600 / width })
    })
    observer.observe(panel.current)
    return () => observer.disconnect()
  }, [])

  // ⌘⇧Space (Ctrl+Shift+Space elsewhere) brings the panel back, but only while focus is on the stage.
  const onKeyDown = event => {
    if (event.code === 'Space' && event.shiftKey && (event.metaKey || event.ctrlKey) && !shown) {
      event.preventDefault()
      takeOver(false)
      summon()
    }
  }

  /** A control below the stage: takes over, then acts on the panel. */
  const control = action => () => {
    const demoApi = api.current
    if (!demoApi) return
    takeOver(false)
    if (!shown) summon()
    action(demoApi)
  }
  const ready = phase !== 'loading'
  const idle = ready && !demo.busy && !demo.palette
  const base = process.env.BASE_PATH || ''

  return (
    <div className="stage-wrap">
      <div ref={root} className="stage" data-phase={phase} data-theme={theme} onKeyDown={onKeyDown}>
        <div className="stage-wallpaper" aria-hidden="true"><span /><span /><span /></div>

        <div className={`stage-terminal${shown ? '' : ' is-front'}`} aria-hidden="true">
          <div className="stage-terminal-bar"><span className="dots"><i /><i /><i /></span><span>Terminal — coding agent</span><span /></div>
          <div className="stage-terminal-body">
            <p className="muted">$ agent</p>
            <p>● Ready. Describe the task.</p>
            <div className={`stage-terminal-input${pasted ? ' has-text' : ''}`} key={pasted?.n}>
              <span className="caret-mark">›</span>
              {pasted ? <span className="pasted">{pasted.text}</span> : <span className="muted">Paste a prompt…</span>}
            </div>
            {pasted && <p className="stage-terminal-note">Pasted from Susi</p>}
          </div>
        </div>

        <div ref={panel} className={`stage-panel${shown ? ' is-shown' : ''}`}>
          <div className="stage-glass" aria-hidden="true" />
          <iframe
            ref={frame}
            src={`${base}/demo/index.html`}
            title="Susi, interactive demo"
            allow="clipboard-write"
            style={fit
              ? { colorScheme: theme, width: 600, height: fit.height, transform: `scale(${fit.scale})`, transformOrigin: '0 0' }
              : { colorScheme: theme }}
            tabIndex={shown ? 0 : -1}
          />
        </div>

        {!shown && phase === 'yours' && (
          <button className="stage-summon" type="button" onClick={() => summon()}>
            Show Susi <Keys keys={['⌘', '⇧', 'Space']} />
          </button>
        )}

        <div className="stage-hud" aria-hidden="true">
          {hud && (
            <div className="stage-hud-pill" key={hud.n}>
              {hud.keys && <Keys keys={hud.keys} />}
              <span>{hud.label}</span>
            </div>
          )}
        </div>

        {toast && <div className="stage-toast" role="status" key={toast.n}>{toast.text}</div>}

        <div className="stage-badge">
          {phase === 'yours'
            ? <><b>Your turn.</b> Type, select, press ⌘K.</>
            : <><b>Guided tour.</b> Click the panel to take over.</>}
        </div>
      </div>

      <ol className="stage-steps" aria-label="What the tour shows">
        {steps.map(([id, label], i) => <li key={id} data-active={step === id || undefined}><span>{String(i + 1).padStart(2, '0')}</span>{label}</li>)}
      </ol>

      <div className="stage-controls" role="toolbar" aria-label="Drive the demo">
        <button type="button" disabled={!idle || !demo.text.trim()} onClick={control(d => d.selectSentence())}>Select a sentence</button>
        <button type="button" disabled={!ready || demo.busy} onClick={control(d => { if (!demo.palette) d.key('KeyK') })}><Keys keys={['⌘', 'K']} /> Actions</button>
        <button type="button" disabled={!idle || !demo.text.trim()} onClick={control(async d => { d.key('KeyK'); await d.query('Shorten', 0); d.enter() })}><Keys keys={['⌘', 'K']} /> Shorten</button>
        <button type="button" disabled={!idle || !demo.canBack} onClick={control(d => d.key('ArrowLeft'))}><Keys keys={['⌘', '←']} /> Back</button>
        <button type="button" disabled={!idle || !demo.canForward} onClick={control(d => d.key('ArrowRight'))}><Keys keys={['⌘', '→']} /> {demo.diff ? 'Accept' : 'Forward'}</button>
        <button type="button" disabled={!ready || demo.busy} onClick={control(d => d.key('KeyL'))}><Keys keys={['⌘', 'L']} /> Library</button>
        <button type="button" disabled={!idle || !demo.text.trim()} onClick={control(d => d.key('Enter'))}><Keys keys={['⌘', '↵']} /> Copy</button>
        <button type="button" className="replay" disabled={!ready} onClick={() => { loops.current = 0; void play() }}>↺ Replay the tour</button>
      </div>
      <p className="stage-note">
        This is the app’s own interface running in your browser. The model’s answers here are scripted;
        in the app, a local model writes them. Outside a Mac, use Ctrl for ⌘.
      </p>
    </div>
  )
}
