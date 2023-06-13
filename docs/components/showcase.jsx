'use client'

// Small, self-contained illustrations for the landing's sections. Each one plays when it scrolls
// into view and settles on its final frame; with reduced motion, it shows that frame at once.
// They imitate the panel with the app's colours and keycaps; the hero stage runs the real one.
import { useEffect, useRef, useState } from 'react'
import { Keys } from './keys'

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** True once the element has been at least `threshold` visible. */
function useInView(threshold = 0.45) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect() }
    }, { threshold })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [threshold])
  return [ref, inView]
}

/** Steps through `delays` (ms before each frame) once in view; returns the frame and a replay. */
function useTimeline(inView, delays) {
  const reduced = useReducedMotion()
  const [frame, setFrame] = useState(0)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (!inView) return
    if (reduced) { setFrame(delays.length); return }
    setFrame(0)
    let at = 0
    const timers = delays.map((delay, i) => { at += delay; return setTimeout(() => setFrame(i + 1), at) })
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, run])
  return [frame, () => setRun(n => n + 1), frame >= delays.length]
}

/** Fades and lifts its children into place when they scroll into view. */
export function Reveal({ children, className = '', as: Tag = 'div' }) {
  const [ref, inView] = useInView(0.2)
  return <Tag ref={ref} className={`reveal ${className}`} data-inview={inView || undefined}>{children}</Tag>
}

/** Word-level diff, enough for short sample sentences; merged the way the app merges its diff (src/editor.ts). */
function diffWords(before, after) {
  const tokens = text => text.match(/\s+|[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*|[^\s\p{L}\p{N}_]+/gu) ?? []
  const a = tokens(before), b = tokens(after)
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const raw = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { raw.push({ type: 'same', value: a[i] }); i++; j++ }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) raw.push({ type: 'del', value: a[i++] })
    else raw.push({ type: 'ins', value: b[j++] })
  }
  // Changes separated only by whitespace or one short token read better as "old phrase → new phrase".
  const parts = []
  const bridge = part => part?.type === 'same' && /^\s*(?:\S{1,2}\s*)?$/u.test(part.value)
  for (let k = 0; k < raw.length;) {
    if (raw[k].type === 'same') {
      const last = parts.at(-1)
      if (last?.type === 'same') last.value += raw[k].value; else parts.push({ ...raw[k] })
      k++
      continue
    }
    let del = '', ins = ''
    for (; k < raw.length; k++) {
      const part = raw[k]
      if (part.type === 'del') del += part.value
      else if (part.type === 'ins') ins += part.value
      else if (bridge(part) && raw[k + 1] && raw[k + 1].type !== 'same') { del += part.value; ins += part.value }
      else break
    }
    const space = del && ins ? /\s*$/u.exec(del)[0] : ''
    const tail = space && ins.endsWith(space) ? space : ''
    if (del.length > tail.length) parts.push({ type: 'del', value: del.slice(0, del.length - tail.length) })
    if (ins.length > tail.length) parts.push({ type: 'ins', value: ins.slice(0, ins.length - tail.length) })
    if (tail) parts.push({ type: 'same', value: tail })
  }
  return parts
}

function Diff({ before, after }) {
  return diffWords(before, after).map((part, i) =>
    part.type === 'same' ? <span key={i}>{part.value}</span>
    : part.type === 'del' ? <del key={i} className="mini-del">{part.value}</del>
    : <ins key={i} className="mini-ins">{part.value}</ins>)
}

function Replay({ onClick, done }) {
  return <button type="button" className="mini-replay" onClick={onClick} data-done={done || undefined} aria-label="Play again">↺ Play again</button>
}

// ——— 1. Edit by selection ———

const selection = {
  head: 'Add pagination to the orders endpoint. ',
  target: 'It would be really great if you could also maybe make sure that the old mobile clients somehow keep working.',
  result: 'Keep the old mobile clients working.',
  tail: ' Return 50 orders per page.',
}

export function SelectionDemo() {
  const [ref, inView] = useInView()
  const [frame, replay, done] = useTimeline(inView, [500, 1100, 900, 900, 1300, 400])
  // 1 selected · 2 palette · 3 "short" typed · 4 rewriting · 5 diff · 6 hint
  return (
    <figure ref={ref} className="mini-panel selection-demo" data-frame={frame}>
      <div className="mini-text">
        {selection.head}
        {frame < 5
          ? <span className={`mini-target${frame >= 1 && frame < 4 ? ' is-selected' : ''}${frame === 4 ? ' is-pending' : ''}`}>{selection.target}</span>
          : <span className="mini-resolved"><Diff before={selection.target} after={selection.result} /></span>}
        {selection.tail}
      </div>
      <div className={`mini-palette${frame >= 2 && frame < 4 ? ' is-open' : ''}`} aria-hidden={frame < 2 || frame >= 4}>
        <div className="mini-rows">
          <div className="mini-row is-active"><Spark /> Shorten</div>
          <div className="mini-row"><Pen /> short <span className="mini-tag">Instruction</span></div>
        </div>
        <div className="mini-field">{frame >= 3 ? 'short' : <span className="muted">What to do with the selection?</span>}</div>
      </div>
      <div className={`mini-hint${frame >= 6 ? ' is-shown' : ''}`}>Shorten · <Keys keys={['⌘', '←']} /> Back · <Keys keys={['⌘', '→']} /> Accept</div>
      <div className="mini-bar"><span><Spark /> {frame === 4 ? 'Rewriting…' : 'Action'} <Keys keys={frame === 4 ? ['esc'] : ['⌘', 'K']} /></span><span>Library <Keys keys={['⌘', 'L']} /></span><span>Copy <Keys keys={['⌘', '↵']} /></span></div>
      <Replay onClick={replay} done={done} />
    </figure>
  )
}

// ——— 2. The version chain ———

const versions = [
  { text: 'Add retry logic to the upload client. Please make sure it doesn’t retry forever and that it logs every attempt somewhere useful.' },
  { label: 'Shorten', text: 'Add retry logic to the upload client. Cap the retries and log every attempt.' },
  { label: 'Make specific', text: 'Add retry logic to the upload client. Retry at most 3 times with exponential backoff and log every attempt at info level.' },
]
// Text A, diff(A,B), text B, diff(B,C), text C; ⌘↵ copies A, B, B, C, C.
const positions = [
  { version: 0, diff: false }, { version: 1, diff: true }, { version: 1, diff: false }, { version: 2, diff: true }, { version: 2, diff: false },
]

export function ChainDemo() {
  const [ref, inView] = useInView()
  const reduced = useReducedMotion()
  const [at, setAt] = useState(4)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!inView || touched || reduced) return
    setAt(0)
    let i = 0
    const timer = setInterval(() => { i++; if (i > 4) { clearInterval(timer); return } setAt(i) }, 1500)
    return () => clearInterval(timer)
  }, [inView, touched, reduced])
  const move = step => { setTouched(true); setAt(i => Math.max(0, Math.min(4, i + step))) }
  const position = positions[at]
  const version = versions[position.version]
  const onKeyDown = event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
  }
  return (
    <figure ref={ref} className="chain-demo" tabIndex={0} onKeyDown={onKeyDown} aria-label="Version chain. Use the left and right arrow keys to step through it.">
      <div className="mini-panel chain-view">
        <div className="mini-text" aria-live="polite">
          {position.diff ? <Diff before={versions[position.version - 1].text} after={version.text} /> : version.text}
        </div>
        <div className="chain-copies">⌘↵ copies <b>{'ABC'[position.version]}</b>{position.diff && ', the right-hand side'}</div>
        <div className="mini-hint is-shown">
          {position.diff
            ? <>{version.label} · <Keys keys={['⌘', '←']} /> Back · <Keys keys={['⌘', '→']} /> Accept</>
            : <>{at > 0 && <><Keys keys={['⌘', '←']} /> Back</>}{at > 0 && at < 4 && ' · '}{at < 4 && <><Keys keys={['⌘', '→']} /> Forward</>}</>}
        </div>
      </div>
      <ol className="chain-track">
        {positions.map((p, i) => (
          <li key={i} data-active={i === at || undefined} data-diff={p.diff || undefined}>
            <button type="button" onClick={() => { setTouched(true); setAt(i) }} tabIndex={-1}>
              <span className="chain-dot" />
              <span className="chain-label">{p.diff ? 'diff' : 'ABC'[p.version]}</span>
              <span className="chain-copy">{p.diff ? versions[p.version].label : ['Original', 'Shortened', 'Specific'][p.version]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="chain-keys">
        <button type="button" onClick={() => move(-1)} disabled={at === 0}><Keys keys={['⌘', '←']} /> Back</button>
        <button type="button" onClick={() => move(1)} disabled={at === 4}><Keys keys={['⌘', '→']} /> {position.diff ? 'Accept' : 'Forward'}</button>
      </div>
    </figure>
  )
}

// ——— 3. Voice and free-form instructions ———

const spoken = {
  action: {
    phrase: 'Make shorter.',
    rows: [{ name: 'Shorten', icon: 'spark' }, { name: 'Make shorter.', icon: 'pen', tag: 'Instruction' }],
    caption: 'An action’s name or alias runs at once. No Enter.',
    before: 'Write a migration that adds a nullable archived_at column to the projects table and also please don’t forget the down migration.',
    after: 'Add a nullable archived_at column to projects, with a down migration.',
  },
  free: {
    phrase: 'Turn this into a checklist for the agent.',
    rows: [{ name: 'Turn this into a checklist for the agent.', icon: 'pen', tag: 'Instruction', key: '↵' }],
    caption: 'Anything else becomes the instruction. Enter sends it to the model.',
    before: 'Bump the SDK, fix the two deprecation warnings, run the integration suite and update the changelog.',
    after: '- Bump the SDK.\n- Fix the two deprecation warnings.\n- Run the integration suite.\n- Update the changelog.',
  },
}

export function VoiceDemo() {
  const [ref, inView] = useInView()
  const [mode, setMode] = useState('action')
  const [frame, replay, done] = useTimeline(inView, mode === 'action' ? [400, 1400, 700, 1100] : [400, 1600, 900, 1200])
  useEffect(() => { replay() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = spoken[mode]
  // 1 listening · 2 phrase pasted · 3 row picked / Enter · 4 result
  return (
    <figure ref={ref} className="voice-demo">
      <div className="voice-tabs" role="tablist" aria-label="Example">
        <button type="button" role="tab" aria-selected={mode === 'action'} onClick={() => setMode('action')}>Name an action</button>
        <button type="button" role="tab" aria-selected={mode === 'free'} onClick={() => setMode('free')}>Say what you want</button>
      </div>
      <div className="mini-panel voice-view" data-frame={frame}>
        <div className="mini-text">{frame >= 4 ? <Diff before={s.before} after={s.after} /> : <span className={frame === 3 ? 'is-pending' : 'is-selected-soft'}>{s.before}</span>}</div>
        <div className={`mini-palette${frame >= 1 && frame < 4 ? ' is-open' : ''}`}>
          {frame >= 2 && (
            <div className="mini-rows">
              {s.rows.map((row, i) => (
                <div key={row.name} className={`mini-row${i === 0 ? ' is-active' : ''}${i === 0 && frame === 3 ? ' is-run' : ''}`}>
                  {row.icon === 'spark' ? <Spark /> : <Pen />} <span className="mini-name">{row.name}</span>
                  {row.tag && <span className="mini-tag">{row.tag}</span>}{row.key && <Keys keys={[row.key]} />}
                </div>
              ))}
            </div>
          )}
          <div className="mini-field">
            {frame === 1 ? <span className="wave" aria-label="Listening"><i /><i /><i /><i /><i /><i /><i /></span>
              : frame >= 2 ? s.phrase : <span className="muted">What to do with the selection?</span>}
          </div>
        </div>
        <p className="voice-caption">{s.caption}</p>
      </div>
      <Replay onClick={replay} done={done} />
    </figure>
  )
}

// ——— 4. Library ———

const library = {
  templates: ['Bug report', 'Release review', 'Task brief'],
  prompts: [['Refactor settings store', '2h'], ['Flaky login test', '1d']],
  brief: ['## Context', '', '## Goal', '', '## Acceptance criteria', '', '## Constraints'],
}

export function LibraryDemo() {
  const [ref, inView] = useInView()
  const [frame, replay, done] = useTimeline(inView, [500, 1300, 1100, 900])
  // 1 ⌘L open · 2 T: Templates · 3 3: Task brief picked · 4 in the editor
  const keys = frame >= 3 ? ['⌘', 'L', 'T', '3'] : frame >= 2 ? ['⌘', 'L', 'T'] : ['⌘', 'L']
  return (
    <figure ref={ref} className="library-demo">
      <div className="mini-panel library-view" data-frame={frame}>
        {frame >= 1 && frame < 4 ? (
          <div className="mini-library">
            <div className="mini-search"><Search /> <span className="muted">Search library…</span><span className={`mini-scope${frame >= 2 ? ' is-active' : ''}`}>{frame >= 2 ? 'Templates' : 'All'} <Keys keys={['⇥']} /></span></div>
            <div className="mini-section">Templates {frame < 2 && <Keys keys={['T']} />}</div>
            {library.templates.map((name, i) => <div key={name} className={`mini-row${(frame >= 3 ? i === 2 : i === 0) ? ' is-active' : ''}`}><Doc /> {name}<span className="spacer" /><Keys keys={[String(i + 1)]} /></div>)}
            {frame < 2 && <>
              <div className="mini-section">Prompts <Keys keys={['P']} /></div>
              {library.prompts.map(([name, age]) => <div key={name} className="mini-row"><Bubble /> {name}<span className="spacer" /><span className="muted">{age}</span></div>)}
              <div className="mini-section">Dictionary <Keys keys={['D']} /></div>
              <div className="mini-row"><Term /> MacWhisper <span className="muted">Mac Whisper</span></div>
            </>}
          </div>
        ) : (
          <div className="mini-text library-text">
            {frame >= 4
              ? library.brief.map((line, i) => <div key={i} className={line ? 'md-heading' : 'md-blank'}>{line}{i === 1 && <span className="mini-caret" />}</div>)
              : <span className="muted">Write or dictate a prompt…</span>}
          </div>
        )}
      </div>
      <div className="library-keys" aria-hidden="true">{frame >= 1 && <Keys keys={keys} className="big" />}</div>
      <Replay onClick={replay} done={done} />
    </figure>
  )
}

// ——— 5. /goal ———

export function GoalDemo() {
  const [ref, inView] = useInView()
  const [frame, replay, done] = useTimeline(inView, [700, 1000])
  return (
    <figure ref={ref} className="mini-panel goal-demo" data-frame={frame}>
      <div className="mini-text">
        {frame >= 2 && <ins className="mini-ins">/goal </ins>}Migrate the billing service from the v1 to the v2 payments API.
        <span className="goal-more">
          {'\n'}## Scope{'\n'}- Replace every v1 call in billing/ and keep the public interface.{'\n'}- Move the webhook handler to the v2 event names.
          {'\n'}## Done when{'\n'}- The integration suite passes against the v2 sandbox.{'\n'}- No v1 import is left.
        </span>
      </div>
      <div className={`mini-hint${frame >= 2 ? ' is-shown' : ''}`}>Turn into goal · <Keys keys={['⌘', '←']} /> Back · <Keys keys={['⌘', '→']} /> Accept</div>
      <Replay onClick={replay} done={done} />
    </figure>
  )
}

// ——— 6. Local only ———

export function LocalDiagram() {
  const [ref, inView] = useInView(0.3)
  return (
    <figure ref={ref} className="local-diagram" data-inview={inView || undefined}>
      <div className="local-mac">
        <span className="local-mac-label">Your Mac</span>
        <div className="local-node local-susi"><img src={`${process.env.BASE_PATH || ''}/icon.svg`} alt="" width="36" height="36" /><b>Susi</b><span>the panel</span></div>
        <div className="local-link"><span className="packet" /><span className="packet back" /><small>127.0.0.1:11434</small></div>
        <div className="local-node local-model"><svg className="local-glyph" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="13" /><circle cx="18" cy="18" r="6" /><circle cx="18" cy="18" r="1.5" fill="currentColor" /></svg><b>Ollama</b><span>qwen3.5:4b-mlx</span></div>
        <div className="local-files">
          <b>Plain files you own</b>
          <code>rules.json</code><code>dictionary.json</code><code>Input/*.md</code><code>Input/.templates/*.md</code>
        </div>
      </div>
      <div className="local-cloud" aria-label="No cloud">
        <svg viewBox="0 0 64 40" aria-hidden="true"><path d="M18 34h30a10 10 0 0 0 0-20 14 14 0 0 0-27-3A11.5 11.5 0 0 0 18 34z" /><path className="strike" d="M10 38 54 4" /></svg>
        <span>No account · no cloud</span>
      </div>
    </figure>
  )
}

// ——— Icons, as in the app ———

const Svg = ({ children }) => <svg className="mini-icon" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
const Spark = () => <Svg><path d="M12 3.5 13.7 9a2 2 0 0 0 1.3 1.3l5.5 1.7-5.5 1.7a2 2 0 0 0-1.3 1.3L12 20.5 10.3 15A2 2 0 0 0 9 13.7L3.5 12 9 10.3A2 2 0 0 0 10.3 9z" /></Svg>
const Pen = () => <Svg><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13 7 4 4" /></Svg>
const Search = () => <Svg><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></Svg>
const Doc = () => <Svg><rect x="4.5" y="3.5" width="15" height="17" rx="2.5" /><path d="M8.5 8h7m-7 4h7m-7 4h4" /></Svg>
const Bubble = () => <Svg><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4h0A1 1 0 0 1 5 15z" /></Svg>
const Term = () => <Svg><path d="M4 18 9 6l5 12M5.8 14h6.4M15 10.5h5M15 14.5h5" /></Svg>
