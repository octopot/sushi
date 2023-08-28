// The settings window in an isolated headless browser. The IPC stub below implements the contract of
// .agents/m2/settings/contract.md in memory, with a revision per file, so the saved, changed, invalid and
// failed paths are the real ones of the page. Nothing touches the user's files, keychain or windows.
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, webkit } from 'playwright-core'
import { preview } from 'vite'

const example = async name => JSON.parse(await readFile(new URL('../docs/specs/examples/' + name, import.meta.url), 'utf8'))
const { rules } = await example('rules.json')
const { terms: shippedTerms } = await example('dictionary.json')
const terms = [
  { from: 'mac whisper', to: 'MacWhisper' },
  { from: 'type script', to: 'TypeScript' },
  { from: 'git hub', to: 'GitHub' },
  { from: 'release please', to: 'release-please' },
]

// The settings folder as src-tauri's fixtures name it (preferences.rs, SAMPLE_DIR).
const fresh = JSON.parse(await readFile(new URL('./fixtures/prefs/fresh.json', import.meta.url), 'utf8'))
const build = { version: fresh.about.version, hash: fresh.about.hash, build: fresh.about.build }
const DIR = '/Users/sample/Library/Application Support/me.octopot.sushi'
const json = value => JSON.stringify(value, null, 2) + '\n'

/** The files and the Mac the stub starts from; each fixture changes a part of it. Files are text, as on disk. */
const base = () => ({
  files: {
    'hotkey.json': { text: json({ capsLock: true, shortcut: 'Control+Shift+Space' }) },
    'model.json': null,
    'rules.json': { text: json({ rules }) },
    'dictionary.json': { text: json({ terms }) },
    'library-path.txt': null,
    'diagnostics.json': null,
  },
  keychain: { openrouter: false, openai: false, anthropic: false },
  inputSources: false,
  /** Combinations another app holds: Sushi cannot register them. */
  unregistrable: [],
  environment: null,
  recording: false,
  logExists: true,
  /** Folders on this Mac and what the Library counts in them. */
  folders: { [DIR + '/Input']: { prompts: 12, templates: 3 }, '/Users/test/Documents/Prompts': { prompts: 4, templates: 0 } },
})
const fixtures = {
  fine: base,
  'input-sources': () => ({ ...base(), inputSources: true }),
  'not-registered': () => {
    const state = base()
    state.files['hotkey.json'] = { text: json({ capsLock: false, shortcut: 'Option+Space' }) }
    state.unregistrable = ['Option+Space']
    return state
  },
  'invalid-rules': () => {
    const state = base()
    state.files['rules.json'] = { text: json({ rules: [rules[0], { ...rules[1], name: ' ' }] }) }
    return state
  },
  linked: () => {
    const state = base()
    state.files['hotkey.json'] = { text: json({ capsLock: false, shortcut: 'Option+Command+KeyP' }), linked: true }
    return state
  },
  connected: () => {
    const state = base()
    state.keychain.openrouter = true
    state.keychain.anthropic = true
    state.files['model.json'] = { text: json({ provider: 'openrouter', openrouter: { model: 'openai/gpt-6-luna', reasoning: 'high', tier: 'fast' } }) }
    state.files['diagnostics.json'] = { text: json({ record: true }) }
    state.files['library-path.txt'] = { text: '/Users/test/Documents/Prompts\n' }
    return state
  },
  /** An active provider whose model.json has no section for it: Sushi's defaults are in effect. */
  'no-section': () => {
    const state = base()
    state.keychain.openai = true
    state.files['model.json'] = { text: json({ provider: 'openai' }) }
    return state
  },
  'no-providers': base,
  environment: () => ({ ...base(), environment: '/Users/test/work/prompts', folders: { ...base().folders, '/Users/test/work/prompts': { prompts: 7, templates: 2 } } }),
  'library-invalid': () => {
    const state = base()
    state.files['library-path.txt'] = { text: 'Documents/Prompts\n' }
    return state
  },
}

/**
 * The states src-tauri renders into tests/fixtures/prefs/ (preferences.rs, `prefs_fixtures_are_current`), as
 * files and a Mac for the stub. The parity scenario checks the stub replies what Rust replied for each; the
 * review frames are rendered from them, so they carry Rust's own strings.
 */
const fromRust = () => ({ ...base(), files: { 'hotkey.json': null, 'model.json': null, 'rules.json': null, 'dictionary.json': null, 'library-path.txt': null, 'diagnostics.json': null }, folders: {}, logExists: false })
const rustStates = {
  fresh: fromRust,
  connected: () => { const s = fromRust(); s.keychain.openrouter = s.keychain.anthropic = true; s.files['model.json'] = { text: json({ provider: 'openrouter', openrouter: { model: 'openai/gpt-6-luna', reasoning: 'high', tier: 'fast' } }) }; return s },
  'no-section': () => { const s = fromRust(); s.keychain.openai = true; s.files['model.json'] = { text: '{"provider": "openai"}\n' }; return s },
  'custom-model': () => { const s = fromRust(); s.keychain.openrouter = true; s.files['model.json'] = { text: '{"provider": "openrouter", "openrouter": {"model": "anthropic/claude-opus-5-5"}}\n' }; return s },
  'hotkey-input-sources': () => ({ ...fromRust(), inputSources: true }),
  'hotkey-not-registered': () => { const s = fromRust(); s.files['hotkey.json'] = { text: json({ capsLock: false, shortcut: 'Option+Space' }) }; s.unregistrable = ['Option+Space']; return s },
  'invalid-rules': () => { const s = fromRust(); s.files['rules.json'] = { text: '{"rules": [{"id": "shorten", "name": "", "instruction": "Make it shorter.", "aliases": []}]}\n' }; return s },
  'invalid-model': () => { const s = fromRust(); s.keychain.openai = true; s.files['model.json'] = { text: '{"provider": "openai", "openai": {"reasoning": "max"}}\n' }; return s },
  'linked-hotkey': () => { const s = fromRust(); s.files['hotkey.json'] = { text: json({ capsLock: true, shortcut: 'Control+Shift+Space' }), linked: true }; return s },
  'library-custom': () => { const s = fromRust(); s.files['library-path.txt'] = { text: DIR + '/Prompts\n' }; s.folders = { [DIR + '/Prompts']: { prompts: 2, templates: 1 } }; return s },
  'library-invalid': () => { const s = fromRust(); s.files['library-path.txt'] = { text: 'Prompts\n' }; return s },
  'library-environment': () => ({ ...fromRust(), environment: DIR + '/From the environment', folders: { [DIR + '/From the environment']: { prompts: 2, templates: 1 } } }),
  'diagnostics-on': () => { const s = fromRust(); s.files['diagnostics.json'] = { text: json({ record: true }) }; s.logExists = true; return s },
  recording: () => ({ ...fromRust(), recording: true }),
}

/**
 * Runs in the page: the contract in memory, following what src-tauri does where the page depends on it —
 * content-hash revisions, seeded files, the order of refusals, links that refuse writes, model.json's defaults
 * (MD-10), connect and disconnect with their events, and Rust's messages.
 */
function stub({ state, shippedRules, shippedTerms, DIR, build }) {
  const DEFAULTS = {
    openrouter: { model: 'openai/gpt-6-luna', reasoning: 'high', tier: 'fast' },
    openai: { model: 'gpt-6-luna', reasoning: 'high' },
    anthropic: { model: 'claude-opus-5-5', effort: 'low' },
  }
  const REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const CHOICES = { model: null, reasoning: REASONING, tier: ['default', 'flex', 'fast', 'ultrafast'], effort: ['low', 'medium', 'high', 'xhigh', 'max'] }
  const FIELDS = { openrouter: ['model', 'reasoning', 'tier'], openai: ['model', 'reasoning'], anthropic: ['model', 'effort'] }
  const NAMES = { openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Claude' }
  const COMPANY = { openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic' }
  const TERMS = {
    openrouter: 'Billed to your OpenRouter credits. OpenRouter sends edits only to providers that do not train on them; they may still keep them for a while.',
    openai: 'Billed to your OpenAI API credits, not to a ChatGPT subscription. Sushi asks OpenAI not to store the requests.',
    anthropic: 'Billed to your Anthropic API credits, not to a Claude subscription.',
  }
  const LABELS = { model: 'Model', reasoning: 'Reasoning', tier: 'Tier', effort: 'Effort' }
  const clone = value => JSON.parse(JSON.stringify(value))
  const json = value => JSON.stringify(value, null, 2) + '\n'
  const blank = s => typeof s !== 'string' || !s.trim()
  /** A revision made from the bytes, as files.rs makes it: the same text keeps it. */
  const revisionOf = text => {
    if (text === null) return 'absent'
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
    return 'h' + h.toString(16)
  }
  const symbols = shortcut => shortcut.split('+').map(p => ({ Control: '⌃', Option: '⌥', Shift: '⇧', Command: '⌘' })[p] ?? p.replace(/^(Key|Digit)(.)$/, '$2')).join('')

  // ——— Validators with Rust's messages ———
  const parseJson = (name, text) => { try { return JSON.parse(text) } catch (e) { throw `${name}: ${e.message}` } }
  const checkHotkey = v => {
    if (typeof v?.capsLock !== 'boolean' || typeof v?.shortcut !== 'string') throw 'hotkey.json: missing field `capsLock` or `shortcut`'
    if (!/^((Control|Option|Shift|Command)\+)+[A-Za-z0-9]+$/.test(v.shortcut))
      throw 'hotkey.json: \'shortcut\' needs at least one of Control, Option, Shift or Command.'
  }
  const checkRules = rules => {
    const ids = new Set()
    for (const [i, r] of rules.entries()) {
      const kinds = ['instruction', 'prefix'].filter(k => k in r)
      if (kinds.length !== 1) throw `rules.json: entry ${i + 1} needs exactly one of 'instruction' or 'prefix'.`
      if ([r.id, r.name, r[kinds[0]], ...r.aliases].some(blank)) throw `rules.json: entry ${i + 1} contains an empty field.`
      if (ids.has(r.id)) throw `rules.json: duplicate rule ID '${r.id}'.`
      ids.add(r.id)
    }
  }
  const checkTerms = terms => {
    const seen = new Set()
    for (const [i, t] of terms.entries()) {
      if (blank(t.from) || blank(t.to)) throw `dictionary.json: entry ${i + 1} needs both 'from' and 'to'.`
      const key = t.from.trim().toLowerCase()
      if (seen.has(key)) throw `dictionary.json: duplicate source '${t.from}'.`
      seen.add(key)
    }
  }
  const checkModel = v => {
    if (!['ollama', 'openrouter', 'openai', 'anthropic'].includes(v?.provider)) throw 'model.json: provider must be ollama, openrouter, openai or anthropic.'
    for (const p of ['openrouter', 'openai', 'anthropic']) {
      const s = v[p]
      if (!s) continue
      if (p === 'openrouter' && s.key !== undefined && blank(s.key)) throw 'model.json: openrouter.key is empty.'
      if (s.model !== undefined && blank(s.model)) throw `model.json: ${p}.model is empty.`
      for (const f of FIELDS[p].slice(1)) if (s[f] !== undefined && !CHOICES[f].includes(s[f])) throw `model.json: ${p}.${f} must be one of ${CHOICES[f].join(', ')}.`
    }
  }
  const VALIDATE = {
    'hotkey.json': text => checkHotkey(parseJson('hotkey.json', text)),
    'model.json': text => checkModel(parseJson('model.json', text)),
    'rules.json': text => checkRules(parseJson('rules.json', text).rules),
    'dictionary.json': text => checkTerms(parseJson('dictionary.json', text).terms),
    'library-path.txt': text => { if (!text.replace(/[\r\n]+$/, '').startsWith('/')) throw 'Enter an absolute library directory in library-path.txt.' },
    'diagnostics.json': text => { const v = parseJson('diagnostics.json', text); if (typeof v?.record !== 'boolean') throw 'diagnostics.json: missing field `record`' },
  }
  const linkedMessage = name => `${name} is a symbolic link: Sushi reads it and does not write through it. Edit it where it points.`

  /** One file on disk: its text (null when absent), and whether it is a link or cannot be read. */
  class Disk {
    constructor(name, spec) { this.name = name; this.text = spec?.text ?? null; this.linked = !!spec?.linked; this.unreadable = !!spec?.unreadable }
    get revision() { return this.unreadable ? 'unreadable' : revisionOf(this.text) }
    get error() { if (this.text === null) return null; try { VALIDATE[this.name](this.text); return null } catch (e) { return String(e) } }
    get status() { return this.unreadable ? 'unreadable' : this.text === null ? 'absent' : this.linked ? 'linked' : this.error ? 'invalid' : 'ok' }
    /** The parsed contents when Sushi can use them, as tests read them: the list itself for rules and terms. */
    get value() {
      if (this.text === null || this.error) return null
      if (this.name === 'library-path.txt') return this.text.trim()
      const v = JSON.parse(this.text)
      return this.name === 'rules.json' ? v.rules : this.name === 'dictionary.json' ? v.terms : v
    }
    get state() {
      const status = this.status, error = this.error
      return {
        name: this.name, status, revision: this.revision, writable: status === 'ok' || status === 'absent',
        message: status === 'unreadable' ? `${this.name}: Permission denied (os error 13)` : status === 'linked' ? linkedMessage(this.name) + (error ? ' ' + error : '') : status === 'invalid' ? error : null,
      }
    }
  }
  const fixture = window.fixture = {
    keychain: { ...state.keychain }, inputSources: state.inputSources, unregistrable: [...state.unregistrable], environment: state.environment,
    recording: state.recording, folders: state.folders, logExists: state.logExists, logging: state.logging ?? false,
    files: Object.fromEntries(Object.entries(state.files).map(([name, spec]) => [name, new Disk(name, spec)])),
    calls: [], captures: [], actions: [], opened: [], resets: [], closes: 0, callbacks: [], listeners: {},
    failNext: null, afterWrite: {}, afterRefusal: {}, holdSaves: false, held: [], connectGate: null, pick: null, inflight: 0, holdLoads: false, loads: [],
    /** An edit outside the window: new contents for the file (an object is written as JSON). */
    touch(name, value) {
      if (Array.isArray(value)) value = name === 'rules.json' ? { rules: value } : { terms: value }
      this.files[name].text = value === null ? null : typeof value === 'string' ? value : json(value)
    },
    emit(event, payload) { this.listeners[event]?.({ event, payload }) },
  }
  const disk = name => fixture.files[name]
  /** The file as Sushi reads it: parsed when it is valid (a link included), null otherwise. */
  const readable = name => {
    const f = disk(name)
    if (!(f.status === 'ok' || (f.status === 'linked' && !f.error))) return null
    return name === 'library-path.txt' ? f.text.replace(/[\r\n]+$/, '') : JSON.parse(f.text)
  }
  // Sushi seeds rules.json, dictionary.json and hotkey.json when they are missing (LF-3).
  const seed = () => {
    if (disk('rules.json').text === null) disk('rules.json').text = json({ rules: shippedRules })
    if (disk('dictionary.json').text === null) disk('dictionary.json').text = json({ terms: shippedTerms })
    if (disk('hotkey.json').text === null) disk('hotkey.json').text = json({ capsLock: true, shortcut: 'Control+Shift+Space' })
  }

  // ——— Panes, as preferences.rs builds them ———
  const effect = hotkey => {
    if (hotkey.capsLock && !fixture.inputSources) return { effective: 'caps-lock', problem: null }
    const combo = hotkey.shortcut
    if (fixture.unregistrable.includes(combo))
      return { effective: null, problem: { kind: 'not-registered', message: `No key shows Sushi: ${symbols(combo)} could not be registered.`, advice: 'Choose another combination: another app may already use this one.' } }
    if (hotkey.capsLock) return { effective: combo, problem: { kind: 'input-sources', message: `Caps Lock switches input sources on this Mac, so ${symbols(combo)} shows Sushi.`, advice: 'Turn off “Use the Caps Lock key to switch…” in System Settings ▸ Keyboard ▸ Input Sources.' } }
    return { effective: combo, problem: null }
  }
  const keyboard = () => {
    const f = disk('hotkey.json')
    const hotkey = readable('hotkey.json') ?? { capsLock: true, shortcut: 'Control+Shift+Space' }
    const { effective, problem } = effect(hotkey)
    const label = effective === 'caps-lock' ? 'Caps Lock' : effective ? symbols(effective) : null
    return {
      file: f.state, capsLock: hotkey.capsLock, shortcut: hotkey.shortcut, defaultShortcut: 'Control+Shift+Space', effective,
      problem: f.status === 'invalid' && !problem
        ? { kind: 'invalid-file', message: f.error, advice: label ? `Fix hotkey.json or start over with the defaults; until then ${label} shows Sushi.` : 'Fix hotkey.json or start over with the defaults.' }
        : problem,
    }
  }
  /** model.rs `filled`: a section without a model takes Sushi's defaults for what it does not set. */
  const filled = (p, section) => {
    const s = { ...(section ?? {}) }
    if (s.model !== undefined) return s
    const out = { ...s, model: DEFAULTS[p].model }
    for (const f of FIELDS[p].slice(1)) out[f] = s[f] ?? DEFAULTS[p][f]
    return out
  }
  /** preferences.rs `set_option`: a missing section starts from the defaults an edit sends. */
  const setOption = (settings, p, field, value) => {
    const s = settings[p] ? { ...settings[p] } : filled(p, null)
    if (value === null) delete s[field]
    else s[field] = field === 'model' ? value.trim() : value
    settings[p] = s
  }
  const keyedCard = (p, connected) => ({ p, connected })
  const model = () => {
    const f = disk('model.json')
    const settings = readable('model.json') ?? { provider: 'ollama' }
    return {
      file: f.state, active: settings.provider, ollama: { model: 'qwen3.5:4b-mlx' },
      providers: ['openrouter', 'openai', 'anthropic'].map(p => keyedCard(p, fixture.keychain[p] || (p === 'openrouter' && !!settings.openrouter?.key))).map(({ p, connected }) => ({
        id: p, name: NAMES[p], connected,
        connect: p === 'openrouter' ? 'sign-in' : 'key',
        // providers::sends_text: present tense once connected.
        sends: `Edits ${connected ? 'go' : 'will go'} to ${COMPANY[p]}: Sushi's instruction, the action and the selected text, or the whole prompt when nothing is selected. Nothing else of the prompt leaves this Mac.`,
        pays: TERMS[p],
        modelName: filled(p, settings[p]).model.split('/').pop(),
        options: FIELDS[p].map(field => {
          const without = clone(settings)
          setOption(without, p, field, null)
          return {
            field, label: LABELS[field], choices: CHOICES[field],
            stored: settings[p]?.[field] ?? null,
            effective: filled(p, settings[p])[field] ?? null,
            unset: filled(p, without[p])[field] ?? null,
          }
        }),
      })),
    }
  }
  const actions = () => ({ file: disk('rules.json').state, rules: clone(readable('rules.json')?.rules ?? []) })
  const library = () => {
    const f = disk('library-path.txt')
    // An invalid path is shown as written, from the file; the Library opens nothing until it is fixed.
    const chosen = f.text === null ? null : f.text.replace(/[\r\n]+$/, '')
    const broken = !fixture.environment && (f.status === 'invalid' || f.status === 'unreadable')
    const path = fixture.environment ?? chosen ?? DIR + '/Input'
    const folder = broken ? null : fixture.folders[path] ?? null
    return {
      file: f.state, path, source: fixture.environment ? 'environment' : chosen ? 'file' : 'default',
      // With a broken library-path.txt the Library opens no folder: nothing is counted.
      prompts: folder?.prompts ?? null, templates: folder ? folder.templates : null,
      dictionary: { file: disk('dictionary.json').state, terms: clone(readable('dictionary.json')?.terms ?? []) },
    }
  }
  const about = () => ({
    version: build.version, hash: build.hash, build: build.build,
    // `record` is the running state: the file's switch when Sushi can read it, what runs otherwise.
    diagnostics: { file: disk('diagnostics.json').state, record: readable('diagnostics.json')?.record ?? fixture.logging, logExists: fixture.logExists },
    recording: fixture.recording,
  })
  const prefs = () => { seed(); return { keyboard: keyboard(), model: model(), actions: actions(), library: library(), about: about() } }

  // ——— Writes, as files::update orders them ———
  class Refusal { constructor(outcome, message) { this.outcome = outcome; this.message = message } }
  /** `validate` runs before the lock for actions and dictionary (Rust renders first), `change` under it. */
  async function save(name, revision, pane, { validate, change }) {
    fixture.inflight++
    try {
      if (fixture.holdSaves) await new Promise(resolve => fixture.held.push(resolve))
      const f = disk(name)
      try {
        validate?.()
        if (fixture.failNext === name) { fixture.failNext = null; throw new Refusal('failed', `Could not save ${name}: No space left on device (os error 28)`) }
        if (f.unreadable) throw new Refusal('failed', f.state.message)
        if (revision !== f.revision) throw new Refusal('changed', `${name} changed on disk.`)
        const next = change(f)
        if (next !== undefined && f.linked) throw new Refusal('failed', linkedMessage(name))
        if (next !== undefined) f.text = next
        // The reply describes what this save wrote (its revision is the written bytes'), as Rust's does; an
        // editor that writes right after it changes the file, not the reply.
        const reply = { outcome: 'saved', message: null, pane: pane() }
        const after = fixture.afterWrite?.[name]
        if (after) { delete fixture.afterWrite[name]; after(f) }
        return reply
      } catch (e) {
        // A refusal replies with a fresh read, as Rust does: an editor that writes after the lock is released and
        // before that read is in the reply.
        const after = fixture.afterRefusal?.[name]
        if (after) { delete fixture.afterRefusal[name]; after(disk(name)) }
        if (e instanceof Refusal) return { outcome: e.outcome, message: e.message, pane: pane() }
        return { outcome: 'invalid', message: String(e), pane: pane() }
      }
    } finally { fixture.inflight-- }
  }
  /** model::modify: a change to the settings as they are, then their validation; no change keeps the file. */
  const modify = (f, edit) => {
    const settings = f.text === null ? { provider: 'ollama' } : JSON.parse(f.text)
    const before = JSON.stringify(settings)
    edit(settings)
    checkModel(settings)
    return JSON.stringify(settings) === before ? undefined : json(settings)
  }
  const choose = (settings, p) => {
    settings.provider = p ?? 'ollama'
    if (p && !settings[p]) settings[p] = filled(p, null)
  }

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'settings' }, currentWebview: { windowLabel: 'settings', label: 'settings' } },
    transformCallback: callback => fixture.callbacks.push(callback),
    async invoke(command, args = {}) {
      if (!command.startsWith('plugin:')) fixture.calls.push({ command, args: clone(args) })
      switch (command) {
        case 'prefs_load': {
          // Read now, answered later: a held load replies with what the files held when it was asked.
          const read = prefs()
          if (fixture.holdLoads) await new Promise(resolve => fixture.loads.push(resolve))
          return read
        }
        case 'prefs_keyboard_save':
          return save('hotkey.json', args.revision, keyboard, {
            validate: () => checkHotkey({ capsLock: args.capsLock, shortcut: args.shortcut }),
            change: () => {
              // Sushi registers what it needs, the backup included, before it writes (ST-18).
              if (fixture.unregistrable.includes(args.shortcut)) {
                const now = keyboard().effective
                throw new Refusal('failed', `Sushi could not register ${symbols(args.shortcut)}: it was not saved. ${now ? `${now === 'caps-lock' ? 'Caps Lock' : symbols(now)} still shows Sushi.` : 'No shortcut is active.'}`)
              }
              return json({ capsLock: args.capsLock, shortcut: args.shortcut })
            },
          })
        case 'prefs_capture':
          if (args.on && fixture.holdCapture) await new Promise(resolve => { fixture.releaseCapture = resolve })
          if (args.on && fixture.captureFails) throw 'Settings does not have the keyboard, so the shortcut was not paused.'
          fixture.captures.push(args.on); return null
        case 'prefs_model_select':
          return save('model.json', args.revision, model, {
            change: f => modify(f, settings => {
              // providers::keyed: a key in the keychain, or OpenRouter's key of v0.2.1 still in the file.
              const keyed = fixture.keychain[args.active] || (args.active === 'openrouter' && !!settings.openrouter?.key)
              if (args.active !== 'ollama' && !keyed)
                throw new Refusal('failed', `No key for ${NAMES[args.active]} is stored on this Mac any more. Connect ${NAMES[args.active]} again to use it.`)
              if (settings.provider !== args.active) choose(settings, args.active === 'ollama' ? null : args.active)
            }),
          })
        case 'prefs_model_option':
          return save('model.json', args.revision, model, { change: f => modify(f, settings => setOption(settings, args.provider, args.field, args.value)) })
        case 'prefs_connect': {
          // Held as a sign-in that waits for the browser: released as connected, or cancelled.
          if (fixture.connectGate && await new Promise(resolve => { fixture.releaseConnect = resolve }) === 'cancelled') return 'cancelled'
          fixture.keychain[args.provider] = true
          fixture.emit('prefs-changed', { file: 'keychain' })
          // Connecting makes the provider the one in use and writes its default section (MD-15).
          const f = disk('model.json')
          const next = modify(f, settings => choose(settings, args.provider))
          if (next !== undefined) { f.text = next; fixture.emit('prefs-changed', { file: 'model.json' }) }
          return 'connected'
        }
        case 'prefs_connect_cancel':
          fixture.releaseConnect?.('cancelled')
          return
        case 'prefs_disconnect': {
          fixture.keychain[args.provider] = false
          fixture.emit('prefs-changed', { file: 'keychain' })
          // The provider in use gives way to Ollama, and a key of v0.2.1 leaves the file.
          const f = disk('model.json')
          if (f.text !== null && !f.error) {
            const next = modify(f, settings => {
              if (args.provider === 'openrouter' && settings.openrouter?.key) delete settings.openrouter.key
              if (settings.provider === args.provider) choose(settings, null)
            })
            if (next !== undefined) { f.text = next; fixture.emit('prefs-changed', { file: 'model.json' }) }
          }
          return 'disconnected'
        }
        case 'prefs_actions_save':
          return save('rules.json', args.revision, actions, { validate: () => checkRules(args.rules), change: () => json({ rules: args.rules }) })
        case 'prefs_dictionary_save':
          return save('dictionary.json', args.revision, library, { validate: () => checkTerms(args.terms), change: () => json({ terms: args.terms }) })
        case 'prefs_library_choose': {
          if (fixture.environment) return { outcome: 'failed', message: 'SUSHI_LIBRARY_DIR sets the library folder, so it cannot be changed here.', pane: library() }
          // The picker is a sheet: the file can change while it is open.
          if (fixture.pickGate) await new Promise(resolve => { fixture.releasePick = resolve })
          const pick = fixture.pick
          if (pick === null) return { outcome: 'saved', message: null, pane: library() }
          return save('library-path.txt', args.revision, library, { change: () => pick + '\n' })
        }
        case 'prefs_library_default':
          if (fixture.environment) return { outcome: 'failed', message: 'SUSHI_LIBRARY_DIR sets the library folder, so it cannot be changed here.', pane: library() }
          return save('library-path.txt', args.revision, library, { change: f => f.text === null ? undefined : null })
        case 'prefs_diagnostics_save':
          return save('diagnostics.json', args.revision, about, { change: () => json({ record: args.record }) })
        case 'prefs_reset': {
          fixture.resets.push(args)
          if (fixture.resetRefuses) throw 'rules.json changed again; Sushi read it once more.'
          const f = disk(args.name)
          if (args.revision !== f.revision || f.status !== 'invalid') throw 'Only an invalid file starts over.'
          const defaults = { 'rules.json': json({ rules: shippedRules }), 'dictionary.json': json({ terms: shippedTerms }), 'hotkey.json': json({ capsLock: true, shortcut: 'Control+Shift+Space' }) }
          f.text = defaults[args.name] ?? null
          return prefs()
        }
        case 'prefs_file': fixture.opened.push(args); return null
        case 'prefs_action':
          if (fixture.actionFails === args.action) throw 'The clipboard is not available.'
          fixture.actions.push(args.provider ? `${args.action}:${args.provider}` : args.action); return null
        case 'plugin:event|listen': fixture.listeners[args.event] = fixture.callbacks[args.handler - 1]; return fixture.callbacks.length
        case 'plugin:event|unlisten': return null
        case 'plugin:window|close': fixture.closes++; return null
        default: throw new Error('Unexpected IPC call: ' + command)
      }
    },
  }
}

test('Sushi settings window', async t => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  t.after(() => new Promise(resolve => app.httpServer.close(resolve)))
  const browser = process.env.SUSHI_ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const screens = process.env.SUSHI_REVIEW_SCREENS
  if (screens) await mkdir(screens, { recursive: true })
  const url = new URL('settings.html', app.resolvedUrls.local[0]).href

  async function start(t, { fixture = 'fine', rust, pane = '', scheme = 'dark', tweak, clock = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 760, height: 560 }, deviceScaleFactor: 2, colorScheme: scheme })
    t.after(() => context.close())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    t.after(() => assert.deepEqual(errors, [], 'no page errors'))
    const state = rust ? rustStates[rust]() : fixtures[fixture]()
    tweak?.(state)
    if (clock) await page.clock.install()
    await page.addInitScript(stub, { state, shippedRules: rules, shippedTerms, DIR, build })
    await page.goto(url + (pane ? '#' + pane : ''))
    await page.locator('.pane-body').first().waitFor()
    await page.waitForFunction(() => window.fixture.listeners['prefs-changed'] && window.fixture.listeners['prefs-pane'])
    return page
  }
  const fixture = (page, fn, arg) => page.evaluate(fn, arg)
  const calls = (page, command) => page.evaluate(command => window.fixture.calls.filter(c => c.command === command).map(c => c.args), command)
  const file = (page, name) => page.evaluate(name => { const f = window.fixture.files[name]; return { status: f.status, value: f.value, revision: f.revision, text: f.text } }, name)
  const rev = async (page, name) => (await file(page, name)).revision
  const emit = (page, event, payload = null) => page.evaluate(([event, payload]) => window.fixture.listeners[event]({ event, payload }), [event, payload])
  const focusWindow = page => page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const heading = page => page.locator('#pane-title')
  const state = page => page.locator('#pane-state')
  const idle = async page => {
    await page.waitForFunction(() => window.fixture.inflight === 0 && !document.querySelector('#pane-state.saving'))
    await page.waitForTimeout(30)
  }
  const active = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)
  /** A key press an input method is still composing: Return picks a candidate then. */
  const composingEnter = (locator) => locator.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
  async function capture(page, name) {
    if (!screens) return
    await page.mouse.move(0, 0)
    await page.waitForTimeout(120)
    await page.screenshot({ path: join(screens, `settings-${name}.png`), animations: 'disabled', caret: 'hide' })
  }

  await t.test('panes: the hash, the sidebar and its arrows, ⌘1…⌘5, prefs-pane; ⌘W closes; Esc does nothing destructive', async t => {
    const page = await start(t, { pane: 'model' })
    assert.equal(await heading(page).textContent(), 'Model')
    assert.equal(await page.locator('#nav-model').getAttribute('aria-current'), 'page')
    assert.equal(await page.locator('.sidebar-note').textContent(), 'Changes are saved as you make them.')
    assert.equal(await state(page).textContent(), '', 'no permanent “Saved”')
    assert.equal(await page.locator('.nav-item.pending').count(), 0, 'no draft dots on a fresh window')
    await page.keyboard.press('Meta+Digit3')
    assert.equal(await heading(page).textContent(), 'Actions')
    assert.equal(new URL(page.url()).hash, '#actions')
    await emit(page, 'prefs-pane', 'about')
    assert.equal(await heading(page).textContent(), 'About')
    await page.locator('#nav-library').click()
    assert.equal(await heading(page).textContent(), 'Library')
    await page.keyboard.press('ArrowUp')
    assert.equal(await heading(page).textContent(), 'Actions', 'arrow keys move between sidebar items')
    assert.equal(await active(page), 'nav-actions')
    await page.keyboard.press('Meta+Digit1')
    assert.equal(await heading(page).textContent(), 'Keyboard')
    await page.keyboard.press('Escape')
    assert.equal(await heading(page).textContent(), 'Keyboard')
    await page.keyboard.press('Meta+w')
    await page.waitForFunction(() => window.fixture.closes === 1)
    assert.deepEqual(await calls(page, 'prefs_keyboard_save'), [], 'nothing saved by navigating')
    // Each pane comes back where it was left.
    await page.keyboard.press('Meta+Digit1')
    await page.locator('#pane').evaluate(node => { node.scrollTop = 300 })
    await page.keyboard.press('Meta+Digit5')
    await page.keyboard.press('Meta+Digit1')
    assert.equal(await page.locator('#pane').evaluate(node => node.scrollTop), 300)
    // Every control has an accessible name.
    for (const id of ['keyboard', 'model', 'actions', 'library', 'about']) {
      await page.locator('#nav-' + id).click()
      const unnamed = await page.evaluate(() => [...document.querySelectorAll('#pane button, #pane input, #pane select, #pane textarea')]
        .filter(node => !(node.getAttribute('aria-label') || node.textContent.trim() || node.labels?.length || node.getAttribute('aria-labelledby')))
        .map(node => node.outerHTML.slice(0, 80)))
      assert.deepEqual(unnamed, [], `every control of ${id} has a name`)
    }
  })

  await t.test('keyboard: record ⌥Space only after the capture is on, refuse a bare key, Esc cancels', async t => {
    const page = await start(t)
    const recorder = page.locator('#keyboard-recorder')
    assert.match(await recorder.getAttribute('aria-label'), /Control Shift Space/)
    assert.match(await recorder.textContent(), /Change…/, 'the recorder looks changeable')
    assert.match(await page.locator('.status-line').textContent(), /Caps Lock shows Sushi\./)
    assert.match(await page.locator('.recorder-row').textContent(), /Backup shortcut/)
    assert.equal(await page.getByRole('button', { name: /Restore the default shortcut/ }).getAttribute('title'), 'Restore ⌃⇧Space')
    await capture(page, 'keyboard-fine-dark')

    await fixture(page, () => { window.fixture.holdCapture = true })
    await recorder.click()
    await page.waitForTimeout(50)
    assert.equal(await page.locator('.recorder.recording').count(), 0, 'not recording until the capture is on')
    await fixture(page, () => { window.fixture.holdCapture = false; window.fixture.releaseCapture() })
    await page.getByText('Press a shortcut…').waitFor()
    assert.deepEqual(await fixture(page, () => window.fixture.captures), [true])
    assert.match(await page.locator('#keyboard-hint').textContent(), /esc to cancel/)
    await capture(page, 'keyboard-recording-dark')
    await page.keyboard.press('KeyA')
    await page.getByText('Hold Control, Option, Shift or Command with another key.').waitFor()
    assert.equal(await recorder.evaluate(node => node.getBoundingClientRect().width), 176, 'the recorder keeps its width')
    await capture(page, 'keyboard-refused-dark')
    await page.keyboard.press('Escape')
    assert.deepEqual(await fixture(page, () => window.fixture.captures), [true, false])
    assert.deepEqual(await calls(page, 'prefs_keyboard_save'), [])
    assert.equal(await active(page), 'keyboard-recorder', 'focus stays on the recorder')
  })

  await t.test('keyboard: the shortcut is taken when every key is up, the first stays, F18 and Tab are not shortcuts', async t => {
    const page = await start(t)
    const recorder = page.locator('#keyboard-recorder')
    const first = await rev(page, 'hotkey.json')
    await recorder.focus()
    await page.keyboard.press('Enter')
    await page.getByText('Press a shortcut…').waitFor()
    await page.keyboard.down('Alt')
    await page.keyboard.down('Space')
    await page.getByText('Release all keys to finish.').waitFor()
    await capture(page, 'keyboard-held-dark')
    // A second key while held does not replace the first combination.
    await page.keyboard.down('KeyK')
    await page.keyboard.up('KeyK')
    // Option goes up first, Space is still down: nothing is saved yet.
    await page.keyboard.up('Alt')
    await page.waitForTimeout(80)
    assert.deepEqual(await calls(page, 'prefs_keyboard_save'), [], 'not while a key is still down')
    assert.equal(await page.locator('.recorder.recording').count(), 1)
    await page.keyboard.up('Space')
    await page.waitForFunction(() => window.fixture.files['hotkey.json'].value.shortcut === 'Option+Space')
    assert.deepEqual(await calls(page, 'prefs_keyboard_save'), [{ revision: first, capsLock: true, shortcut: 'Option+Space' }])
    await page.waitForFunction(() => window.fixture.captures.length === 2)
    await idle(page)
    assert.match(await recorder.getAttribute('aria-label'), /Option Space/)
    await page.getByText('Saved', { exact: true }).waitFor()

    // F18, the key Caps Lock becomes, is never part of a shortcut.
    await recorder.click()
    await page.getByText('Press a shortcut…').waitFor()
    await page.evaluate(() => {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'F18', code: 'F18', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    assert.equal(await page.locator('.recorder.recording kbd').count(), 0)
    // Tab leaves the recorder and moves the focus on; Shift-Tab does the same backwards.
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.recorder.recording').count(), 0)
    // Where Tab goes depends on the engine's keyboard access setting; it is never kept by the recorder.
    assert.notEqual(await active(page), 'keyboard-recorder')
    if (process.env.SUSHI_ENGINE !== 'webkit') assert.equal(await active(page), 'keyboard-reset')
    await recorder.click()
    await page.getByText('Press a shortcut…').waitFor()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.locator('.recorder.recording').count(), 0)
    assert.notEqual(await active(page), 'keyboard-recorder')
    if (process.env.SUSHI_ENGINE !== 'webkit') assert.equal(await active(page), 'keyboard-mode-caps')
    assert.equal((await calls(page, 'prefs_keyboard_save')).length, 1)
    assert.equal(await fixture(page, () => window.fixture.captures.at(-1)), false)

    // A shortcut Sushi cannot register is not saved, and the line under the field says why.
    await fixture(page, () => { window.fixture.unregistrable = ['Command+Space'] })
    await recorder.click()
    await page.getByText('Press a shortcut…').waitFor()
    await page.keyboard.press('Meta+Space')
    // A backup that cannot be registered is refused too, in Rust's words (ST-18).
    await page.getByText('Sushi could not register ⌘Space: it was not saved. Caps Lock still shows Sushi.').waitFor()
    assert.equal((await file(page, 'hotkey.json')).value.shortcut, 'Option+Space')
    await capture(page, 'keyboard-unregistered-dark')

    // When the capture cannot start, the recorder stays idle and says so.
    await fixture(page, () => { window.fixture.captureFails = true })
    await recorder.click()
    await page.getByText('Settings does not have the keyboard, so the shortcut was not paused.').waitFor()
    assert.equal(await page.locator('.recorder.recording').count(), 0)

    // Caps Lock or a keyboard shortcut; the reset goes back to ⌃⇧Space.
    await page.getByRole('radio', { name: 'Keyboard shortcut' }).click()
    await page.waitForFunction(() => window.fixture.files['hotkey.json'].value.capsLock === false)
    await idle(page)
    assert.match(await page.locator('.status-line').textContent(), /shows Sushi\./)
    assert.equal(await page.getByText('While Sushi runs, Caps Lock shows Sushi instead of switching capitals.').count(), 0)
    await page.getByRole('button', { name: /Restore the default shortcut/ }).click()
    await page.waitForFunction(() => window.fixture.files['hotkey.json'].value.shortcut === 'Control+Shift+Space')
    await page.getByRole('radio', { name: 'Caps Lock' }).click()
    await page.waitForFunction(() => window.fixture.files['hotkey.json'].value.capsLock === true)
    await page.getByText('While Sushi runs, Caps Lock shows Sushi instead of switching capitals.').waitFor()
  })

  await t.test('keyboard: Caps Lock taken by input sources leads with the cause and the key that works', async t => {
    const page = await start(t, { fixture: 'input-sources' })
    const status = page.locator('.status-line')
    assert.match(await status.textContent(), /^Caps Lock is used to switch input sources\.Use ⌃⇧Space to show Sushi\. To use Caps Lock, turn off “Use the Caps Lock key to switch…” in System Settings ▸ Keyboard ▸ Input Sources\./)
    assert.equal(await status.locator('kbd').count() >= 3, true, 'the key is shown as keycaps')
    assert.equal(await page.getByText('While Sushi runs, Caps Lock shows Sushi instead of switching capitals.').count(), 0, 'not said when it is not so')
    assert.match(await page.locator('.recorder-row').textContent(), /In use now, because Caps Lock is unavailable\./)
    await capture(page, 'keyboard-input-sources-dark')
    await page.getByRole('button', { name: 'Open macOS keyboard settings…' }).click()
    await page.waitForFunction(() => window.fixture.actions.includes('keyboard-settings'))
    await page.locator('#pane').evaluate(node => { node.scrollTop = node.scrollHeight })
    await page.getByText('These shortcuts cannot be changed.').waitFor()
    await page.getByText('Open Settings', { exact: true }).waitFor()
  })

  await t.test('keyboard: a linked hotkey.json is shown and not written', async t => {
    const page = await start(t, { fixture: 'linked' })
    await page.getByText('These settings are managed in another file.').waitFor()
    assert.equal(await page.locator('.banner.note').count(), 1, 'a note, not a warning')
    assert.equal(await page.locator('#keyboard-recorder').isDisabled(), true)
    assert.equal(await page.getByRole('radio', { name: 'Caps Lock' }).isDisabled(), true)
    assert.match(await page.locator('#keyboard-recorder').getAttribute('aria-label'), /Option Command P/)
    await page.getByRole('button', { name: 'Edit original file…' }).click()
    assert.deepEqual(await fixture(page, () => window.fixture.opened), [{ name: 'hotkey.json', action: 'edit' }])
    await capture(page, 'keyboard-linked-dark')
  })

  await t.test('model: a row opens in place without choosing; connect, then the truth; options; Browse models', async t => {
    const page = await start(t, { fixture: 'no-providers', pane: 'model' })
    const row = name => page.locator('.provider-head', { hasText: name })
    assert.equal(await row('Ollama').getAttribute('aria-expanded'), 'true', 'the provider in use is open')
    assert.match(await row('Ollama').textContent(), /In use/)
    await capture(page, 'model-ollama-dark')
    await row('OpenRouter').click()
    assert.equal(await row('OpenRouter').getAttribute('aria-expanded'), 'true')
    assert.equal(await row('Ollama').getAttribute('aria-expanded'), 'false')
    assert.deepEqual(await calls(page, 'prefs_model_select'), [], 'looking does not choose')
    await page.getByText(/^Billed to your OpenRouter credits\./).waitFor()
    await capture(page, 'model-not-connected-dark')

    await fixture(page, () => { window.fixture.connectGate = true })
    await page.getByRole('button', { name: 'Connect…' }).click()
    await page.getByRole('button', { name: 'Connecting…' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Connecting…' }).isDisabled(), true)
    await page.getByText('Sushi waits for the browser for 5 minutes.').waitFor()
    await capture(page, 'model-connecting-dark')
    // The browser never answers (a closed tab): Cancel ends the wait and nothing changes (MD-14).
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Connect…' }).waitFor()
    assert.equal((await calls(page, 'prefs_connect_cancel')).length, 1)
    assert.equal(await page.getByRole('button', { name: 'Cancel' }).count(), 0)
    assert.ok(!(await page.evaluate(() => window.fixture.keychain.openrouter)), 'a cancelled sign-in keeps no key')
    assert.doesNotMatch(await row('OpenRouter').textContent(), /In use/, 'and chooses nothing')
    await page.getByRole('button', { name: 'Connect…' }).click()
    await page.getByRole('button', { name: 'Connecting…' }).waitFor()
    await fixture(page, () => window.fixture.releaseConnect())
    await page.getByText('Key saved').waitFor()
    // Rust makes a provider in use when it connects and writes its default section (MD-15, MD-10).
    await page.waitForFunction(() => /In use/.test(document.querySelector('#model-row-openrouter').textContent))
    assert.deepEqual((await file(page, 'model.json')).value, { provider: 'openrouter', openrouter: { model: 'openai/gpt-6-luna', reasoning: 'high', tier: 'fast' } })
    assert.match(await row('OpenRouter').textContent(), /Connected · gpt-6-luna/, 'the model as the menu names it')

    await page.getByRole('button', { name: 'Browse models…' }).click()
    await page.waitForFunction(() => window.fixture.actions.includes('models:openrouter'))

    await page.getByRole('button', { name: 'Advanced' }).click()
    assert.equal(await page.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded'), 'true')
    await page.getByLabel('OpenRouter reasoning effort').selectOption('low')
    await page.waitForFunction(() => window.fixture.files['model.json'].value.openrouter.reasoning === 'low')
    await idle(page)
    // Removing a field is a choice of its own, and it says what follows from it.
    const tier = page.getByLabel('OpenRouter service tier')
    assert.equal(await tier.locator('option').first().textContent(), 'Remove from the file — nothing is sent')
    await tier.selectOption('')
    await page.waitForFunction(() => !('tier' in window.fixture.files['model.json'].value.openrouter))
    await idle(page)
    assert.equal(await tier.locator('option').first().textContent(), 'Not set in the file · nothing is sent')
    // Use Sushi's default says what else it brings back.
    await page.getByText('Use Sushi’s default also brings back Sushi’s defaults for service tier, which the file does not set.').waitFor()

    // A model ID whose write fails stays in the field with the reason beside it.
    const name = page.getByLabel('OpenRouter model ID')
    await fixture(page, () => { window.fixture.failNext = 'model.json' })
    await name.fill('anthropic/claude-opus-5-5')
    await name.press('Enter')
    await page.getByText(/Could not save model\.json/).waitFor()
    assert.equal(await name.inputValue(), 'anthropic/claude-opus-5-5')
    assert.equal(await name.getAttribute('aria-invalid'), 'true')
    assert.equal(await active(page), 'model-name-openrouter', 'Return keeps the focus in the field')
    assert.equal(await state(page).textContent(), 'Not saved')
    await page.locator('#nav-actions').click()
    assert.equal(await page.locator('#nav-model.pending').count(), 1, 'the sidebar marks the pane with a draft')
    await capture(page, 'model-sidebar-dot-dark')
    await page.locator('#nav-model').click()
    assert.equal(await name.inputValue(), 'anthropic/claude-opus-5-5')
    await composingEnter(name)
    await page.waitForTimeout(50)
    assert.equal((await file(page, 'model.json')).value.openrouter.model, 'openai/gpt-6-luna', 'Return while composing does not send')
    await name.press('Enter')
    await page.waitForFunction(() => window.fixture.files['model.json'].value.openrouter.model === 'anthropic/claude-opus-5-5')
    await idle(page)
    assert.equal(await page.locator('#nav-model.pending').count(), 0)
    assert.match(await row('OpenRouter').textContent(), /Connected · claude-opus-5-5/)
    await page.getByRole('button', { name: 'Use Sushi’s default' }).click()
    await page.waitForFunction(() => !('model' in window.fixture.files['model.json'].value.openrouter))
    await idle(page)
    assert.equal(await name.inputValue(), '')
    assert.equal(await name.getAttribute('placeholder'), 'openai/gpt-6-luna')
    await capture(page, 'model-options-dark')

    // Disconnecting the provider in use hands edits back to Ollama.
    await page.getByRole('button', { name: 'Disconnect…' }).click()
    await page.waitForFunction(() => /In use/.test(document.querySelector('#model-row-ollama').textContent))
    assert.equal((await file(page, 'model.json')).value.provider, 'ollama')
    assert.match(await row('OpenRouter').textContent(), /Not connected/)
  })

  await t.test('model: a provider without a section shows what edits send; Use for edits seeds a section', async t => {
    const page = await start(t, { fixture: 'no-section', pane: 'model' })
    await page.getByRole('button', { name: 'Advanced' }).click()
    const reasoning = page.getByLabel('OpenAI reasoning effort')
    // Stored nothing, sends high: the control says what is sent, not "not sent".
    assert.equal(await reasoning.locator('option:checked').textContent(), 'Not set in the file · edits send high')
    await capture(page, 'model-no-section-dark')
    await reasoning.selectOption('low')
    // The first option written brings the other defaults into the section (set_option).
    await page.waitForFunction(() => window.fixture.files['model.json'].value.openai?.reasoning === 'low')
    assert.deepEqual((await file(page, 'model.json')).value.openai, { model: 'gpt-6-luna', reasoning: 'low' })

    const connected = await start(t, { fixture: 'connected', pane: 'model' })
    await connected.getByText('Connected · gpt-6-luna').first().waitFor()
    await capture(connected, 'model-connected-dark')
    await connected.locator('.provider-head', { hasText: 'Claude' }).click()
    await capture(connected, 'model-expanded-dark')
    await connected.getByRole('button', { name: 'Use for edits' }).click()
    await connected.waitForFunction(() => window.fixture.files['model.json'].value.provider === 'anthropic')
    await idle(connected)
    assert.deepEqual((await file(connected, 'model.json')).value.anthropic, { model: 'claude-opus-5-5', effort: 'low' }, 'choosing seeds the section')
    assert.match(await connected.locator('#model-row-anthropic').textContent(), /In use/)
    assert.equal(await connected.getByRole('button', { name: 'Use for edits' }).count(), 0)
  })

  await t.test('model: an invalid model.json stops edits, and no row is in use', async t => {
    const page = await start(t, { fixture: 'connected', pane: 'model', tweak: s => { s.files['model.json'] = { text: '{"provider": "openrouter", "openrouter": {"tier": "priority"}}\n' } } })
    await page.getByText('The model settings couldn’t be loaded.').waitFor()
    await page.getByText('Edits are stopped until it is fixed.', { exact: false }).first().waitFor()
    assert.equal(await page.locator('.in-use').count(), 0)
    await capture(page, 'model-invalid-dark')
  })

  await t.test('actions: add, edit, phrases, reorder, duplicate, delete, undo and ⌘Z', async t => {
    const page = await start(t, { pane: 'actions' })
    const saved = () => page.evaluate(() => window.fixture.files['rules.json'].value)
    assert.equal(await page.locator('.kind').count(), 1, 'only the prefix action says its kind')
    await capture(page, 'actions-list-dark')

    await page.getByRole('button', { name: 'Add action' }).click()
    const name = page.getByRole('textbox', { name: 'Name' })
    await page.waitForFunction(() => document.activeElement.getAttribute('aria-label') === 'Name')
    await name.fill('Polite')
    await composingEnter(name)
    await name.press('Tab')
    assert.equal((await saved()).length, 6, 'a new action without an instruction stays a draft')
    await page.getByText('New action — not saved: complete the name and the instruction to add it.').waitFor()
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Make the tone polite.\nKeep the facts.  ')
    const phraseField = page.getByRole('textbox', { name: 'Add a phrase' })
    await phraseField.fill('be polite')
    await composingEnter(phraseField)
    await phraseField.press('Enter')
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.at(-1).aliases.length === 1)
    assert.deepEqual((await saved()).at(-1), { id: 'polite', name: 'Polite', instruction: 'Make the tone polite.\nKeep the facts.  ', aliases: ['be polite'] }, 'whitespace is kept exactly')
    await phraseField.fill('make clearer')
    await phraseField.press('Enter')
    await page.locator('.chip.clash').getByText('used twice').waitFor()
    await page.getByText('“make clearer” also finds “Clarify”. Dictated or pasted in ⌘K, it runs “Clarify”, which comes first in the list; typed, both are listed.').waitFor()
    await idle(page)
    // The first Backspace chooses the last phrase, the second removes it.
    await phraseField.press('Backspace')
    assert.equal(await page.locator('.chip.chosen').count(), 1)
    assert.equal((await saved()).at(-1).aliases.length, 2)
    await phraseField.press('Backspace')
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.at(-1).aliases.length === 1)
    await idle(page)
    await phraseField.fill('make clearer')
    await phraseField.press('Enter')
    await idle(page)
    assert.equal(await page.locator('.action-head', { hasText: 'Clarify' }).locator('.pill.warning').textContent(), 'Phrase used twice', 'both sides are flagged')
    await capture(page, 'actions-editor-dark')

    // Renaming keeps the id; Done never closes an action that cannot be saved.
    await name.fill('Be polite')
    await name.press('Enter')
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.at(-1).name === 'Be polite')
    assert.equal((await saved()).at(-1).id, 'polite')
    await name.fill('')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByText('Give the action a name.').waitFor()
    assert.equal(await name.count(), 1, 'Done keeps an invalid action open')
    assert.equal(await active(page), (await name.getAttribute('id')))
    await page.getByText('Not saved: ⌘K still uses the previous version.').waitFor()
    assert.equal(await state(page).textContent(), 'Not saved')
    assert.equal((await saved()).at(-1).name, 'Be polite')
    await capture(page, 'actions-not-saved-dark')
    // Esc closes the editor and keeps the draft.
    await page.keyboard.press('Escape')
    assert.equal(await name.count(), 0)
    await page.locator('.action-head', { hasText: 'Untitled' }).locator('.pill.error').waitFor()
    await page.locator('.action-head', { hasText: 'Untitled' }).click()
    assert.equal(await name.inputValue(), '')
    await name.fill('Be polite')
    await name.press('Enter')
    await idle(page)
    assert.equal(await state(page).textContent(), 'Saved')

    // Action type: switching keeps the other text until the change commits.
    await page.getByRole('radio', { name: 'Insert before the prompt' }).click()
    await page.getByText('Write the text to insert.').waitFor()
    assert.equal((await saved()).at(-1).instruction, 'Make the tone polite.\nKeep the facts.  ')
    await page.getByRole('radio', { name: 'Edit with the model' }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Instruction' }).inputValue(), 'Make the tone polite.\nKeep the facts.  ')
    await page.getByRole('radio', { name: 'Insert before the prompt' }).click()
    await page.getByRole('textbox', { name: 'Text to insert' }).fill('Please, ')
    await page.getByRole('textbox', { name: 'Text to insert' }).blur()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.at(-1).prefix === 'Please, ')
    assert.equal('instruction' in (await saved()).at(-1), false)
    assert.equal(await page.locator('.preview-text').textContent(), 'Please, Summarize the release notes.')
    await idle(page)
    await capture(page, 'actions-prefix-dark')

    // Reorder: the row's own Move up, ⌥↓ on the row, and a drag by the handle; each is announced.
    const head = page.locator('.action-head', { hasText: 'Be polite' })
    await head.hover()
    await page.getByRole('button', { name: 'Move Be polite up' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value[5].id === 'polite')
    await page.waitForFunction(() => document.querySelector('#live').textContent === 'Be polite moved to position 6 of 7')
    assert.equal(await active(page), (await page.getByRole('button', { name: 'Move Be polite up' }).getAttribute('id')), 'the focus stays on the button')
    await idle(page)
    await head.focus()
    await page.keyboard.press('Alt+ArrowDown')
    await page.waitForFunction(() => window.fixture.files['rules.json'].value[6].id === 'polite')
    await idle(page)
    const drag = async (from, to, cancel = false) => {
      const box = await page.locator('.action').nth(from).locator('.grip').boundingBox()
      const target = await page.locator('.action').nth(to).boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 5, target.y + 4, { steps: 6 })
      if (cancel) await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')))
      await page.mouse.up()
    }
    // A cancelled pointer leaves the order as it was.
    await drag(6, 0, true)
    await page.waitForTimeout(50)
    assert.equal((await saved())[6].id, 'polite')
    await drag(6, 0)
    await page.waitForFunction(() => window.fixture.files['rules.json'].value[0].id === 'polite')
    await idle(page)

    // Duplicate makes a new id from the new name; delete has an Undo that waits, and ⌘Z.
    assert.equal(await page.locator('.action-head', { hasText: 'Be polite' }).getAttribute('aria-expanded'), 'true', 'the editor stays open through a reorder')
    await page.getByRole('button', { name: 'Duplicate' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value[1]?.id === 'be-polite-copy')
    assert.equal((await saved())[1].name, 'Be polite copy')
    await idle(page)
    await page.getByRole('button', { name: 'Delete Be polite copy' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 7)
    await page.locator('#toast').getByText('Deleted “Be polite copy”').waitFor()
    assert.equal(await active(page), (await page.locator('.action').nth(1).locator('.action-head').getAttribute('id')), 'the focus goes to the next row')
    await capture(page, 'actions-deleted-dark')
    await idle(page)
    await page.waitForTimeout(6500)
    assert.equal(await page.locator('#toast').isVisible(), true, 'Undo waits for the next operation, not for a timer')
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 8)
    assert.equal((await saved())[1].id, 'be-polite-copy')
    await idle(page)
    await page.locator('.action-head', { hasText: 'Be polite copy' }).click()
    await page.getByRole('button', { name: 'Delete Be polite copy' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 7)
    await idle(page)
    await page.locator('.action-head', { hasText: 'Structure' }).focus()
    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 8)
    await idle(page)

    // A name without Latin letters gets a fallback id; Done closes a valid editor.
    await page.getByRole('button', { name: 'Add action' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Вежливо')
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Сделай вежливее.')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 9)
    assert.equal((await saved()).at(-1).id, 'action')
    assert.equal(await page.getByRole('textbox', { name: 'Name' }).count(), 0, 'Done closes the editor')
    // The action ID sits under File details.
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    await page.getByRole('button', { name: 'File details' }).click()
    await page.getByText('Action ID').waitFor()
    await page.getByText('Unchanged when renamed.').waitFor()
  })

  await t.test('actions: a half-typed phrase and focus survive saves, refreshes and pane changes', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    const phraseField = page.getByRole('textbox', { name: 'Add a phrase' })
    await phraseField.fill('shor')
    assert.equal(await page.locator('#nav-actions.pending').count(), 1)
    await page.keyboard.press('Meta+Digit1')
    await page.keyboard.press('Meta+Digit3')
    assert.equal(await phraseField.inputValue(), 'shor', 'kept through a pane change')
    // A clean refresh from the file keeps the half-typed phrase and shows the file's change.
    await fixture(page, rules => window.fixture.touch('rules.json', rules.map(r => r.id === 'grammar' ? { ...r, name: 'Fix spelling' } : r)), rules)
    await focusWindow(page)
    await page.locator('.action-head', { hasText: 'Fix spelling' }).waitFor()
    assert.equal(await phraseField.inputValue(), 'shor')
    assert.equal(await page.locator('.banner').count(), 0, 'no conflict for a phrase not added yet')
    // The focus stays on a chip's remove button through the save and its redraw.
    await page.locator('.chip').first().getByRole('button').focus()
    await page.keyboard.press('Enter')
    await idle(page)
    assert.match(await active(page), /^action-chip-/)
    assert.equal((await file(page, 'rules.json')).value.find(r => r.id === 'shorten').aliases.length, 3)
    // A phrase that is another action's name is flagged on both rows.
    await page.locator('.action-head', { hasText: 'Clarify' }).click()
    await phraseField.fill('shorten')
    await phraseField.press('Enter')
    await idle(page)
    const named = name => page.locator('.action-head').filter({ has: page.locator('.action-name', { hasText: new RegExp(`^${name}$`) }) })
    assert.equal(await named('Shorten').locator('.pill.warning').count(), 1)
    assert.equal(await named('Clarify').locator('.pill.warning').count(), 1)
    await page.getByText(/“shorten” also finds “Shorten”\. Dictated or pasted in ⌘K, it runs this action, which comes first/).waitFor()
  })

  await t.test('actions and dictionary: a clean external edit replaces the rows, never becomes a draft', async t => {
    const page = await start(t, { pane: 'actions' })
    await fixture(page, rules => window.fixture.touch('rules.json', rules.map(r => r.id === 'shorten' ? { ...r, name: 'Shorter' } : r)), rules)
    const edited = await rev(page, 'rules.json')
    await focusWindow(page)
    await page.locator('.action-head', { hasText: 'Shorter' }).waitFor()
    assert.equal(await state(page).textContent(), '')
    assert.equal(await page.locator('#nav-actions.pending').count(), 0)
    await page.locator('.action-head', { hasText: 'Clarify' }).click()
    await page.getByRole('button', { name: 'Move up' }).last().click()
    await page.waitForFunction(() => window.fixture.calls.some(c => c.command === 'prefs_actions_save'))
    await idle(page)
    const [save] = await calls(page, 'prefs_actions_save')
    assert.equal(save.revision, edited, 'the revision of the hand edit')
    assert.equal(save.rules.find(r => r.id === 'shorten').name, 'Shorter', 'the save carries the hand edit')

    await page.keyboard.press('Meta+Digit4')
    await fixture(page, terms => window.fixture.touch('dictionary.json', terms.map(t => t.from === 'git hub' ? { ...t, to: 'Github' } : t)), terms)
    await focusWindow(page)
    await page.waitForFunction(() => [...document.querySelectorAll('.terms input')].some(input => input.value === 'Github'))
    assert.equal(await state(page).textContent(), '')
    await page.getByRole('button', { name: 'Add term' }).click()
    await page.getByRole('textbox', { name: 'Heard as' }).last().fill('pull request')
    await page.getByRole('textbox', { name: 'Written as' }).last().fill('PR')
    await page.getByRole('textbox', { name: 'Written as' }).last().press('Enter')
    await page.waitForFunction(() => window.fixture.files['dictionary.json'].value.length === 5)
    assert.equal((await file(page, 'dictionary.json')).value.find(t => t.from === 'git hub').to, 'Github')
  })

  await t.test('dictionary: renaming a term to one that exists is refused at that field; nothing is dropped', async t => {
    const page = await start(t, { pane: 'library' })
    const from = page.locator('#term-from-' + await page.locator('.term').first().getAttribute('data-key'))
    await from.fill('type script')
    await from.press('Enter')
    await page.getByText('“type script” is already in the dictionary.').waitFor()
    assert.equal(await from.getAttribute('aria-invalid'), 'true', 'the error is at the edited field')
    assert.equal(await page.locator('.term .cell.invalid').count(), 1, 'only the edited row')
    assert.deepEqual(await calls(page, 'prefs_dictionary_save'), [])
    await capture(page, 'library-duplicate-dark')
    // Saving another term keeps both originals.
    const toOfLast = page.getByRole('textbox', { name: 'Written as' }).last()
    await toOfLast.fill('Release Please')
    await toOfLast.press('Enter')
    await page.waitForFunction(() => window.fixture.calls.some(c => c.command === 'prefs_dictionary_save'))
    await idle(page)
    const [save] = await calls(page, 'prefs_dictionary_save')
    assert.deepEqual(save.terms.map(t => t.from), ['mac whisper', 'type script', 'git hub', 'release please'])
    assert.equal(save.terms[0].to, 'MacWhisper')
    assert.equal(save.terms[1].to, 'TypeScript')
  })

  await t.test('saves run one at a time, each with the revision the previous one left', async t => {
    const page = await start(t, { pane: 'actions' })
    const initial = await rev(page, 'rules.json')
    await fixture(page, () => { window.fixture.holdSaves = true })
    await page.locator('.action-head', { hasText: 'Structure' }).click()
    await page.getByRole('button', { name: 'Move up' }).last().click()
    await page.getByRole('button', { name: 'Move up' }).last().click()
    await page.waitForFunction(() => window.fixture.held.length === 1)
    assert.equal(await state(page).textContent(), 'Saving…')
    await focusWindow(page)
    await page.waitForTimeout(50)
    assert.equal(await page.locator('.action').nth(3).locator('.action-name').textContent(), 'Structure')
    await fixture(page, () => window.fixture.held.shift()())
    await page.waitForFunction(() => window.fixture.held.length === 1)
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await idle(page)
    const saves = await calls(page, 'prefs_actions_save')
    assert.equal(saves[0].revision, initial)
    assert.notEqual(saves[1].revision, initial, 'the second save carries the revision the first one left')
    assert.equal((await file(page, 'rules.json')).value[3].id, 'structure')
    assert.equal(await state(page).textContent(), 'Saved')
    await page.waitForFunction(() => document.querySelector('#pane-state').textContent === '', null, { timeout: 4000 })
  })

  await t.test('conflict: the file changes under a draft; what differs, and both ways out', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    const name = page.getByRole('textbox', { name: 'Name' })
    await name.fill('')
    await name.press('Enter')
    await page.getByText('Give the action a name.').waitFor()
    await fixture(page, rules => window.fixture.touch('rules.json', rules.map(r => r.id === 'grammar' ? { ...r, name: 'Fix spelling' } : r).slice(0, 5)), rules)
    await focusWindow(page)
    const banner = page.getByRole('alert').filter({ hasText: 'Actions changed outside Settings.' })
    await banner.waitFor()
    assert.match(await banner.textContent(), /Your edits are not saved\. Choose which version to keep\./)
    assert.match(await banner.textContent(), /The file has 5 actions; yours has 6\. Changed in the file: Fix spelling\. Removed from the file: Structure\./)
    assert.equal(await state(page).textContent(), 'Changed outside Settings')
    assert.equal(await name.inputValue(), '', 'the draft stays')
    await page.locator('#pane').evaluate(node => { node.scrollTop = 0 })
    await capture(page, 'actions-conflict-dark')
    await page.getByRole('button', { name: 'Use the file’s version' }).click()
    await banner.waitFor({ state: 'detached' })
    await page.locator('.action-head', { hasText: 'Fix spelling' }).waitFor()
    assert.deepEqual(await calls(page, 'prefs_actions_save'), [])

    // A commit over a stale revision is refused, and Replace with my version writes it over the fresh one.
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    await fixture(page, () => window.fixture.touch('rules.json', window.fixture.files['rules.json'].value.slice(0, 4)))
    await name.fill('Shorter')
    await name.press('Enter')
    await banner.waitFor()
    await page.getByRole('button', { name: 'Replace with my version' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 5)
    assert.equal((await file(page, 'rules.json')).value.find(r => r.id === 'shorten').name, 'Shorter')
    await idle(page)

    // A failed write says so at the action and keeps the file as it was.
    await fixture(page, () => { window.fixture.failNext = 'rules.json' })
    await name.fill('Shortest')
    await name.press('Enter')
    await page.getByText('Not saved: Could not save rules.json: No space left on device (os error 28)').waitFor()
    assert.equal((await file(page, 'rules.json')).value.find(r => r.id === 'shorten').name, 'Shorter')
  })

  await t.test('invalid rules.json: the feature first, Error details, Restore default actions with a confirmation', async t => {
    const page = await start(t, { fixture: 'invalid-rules', pane: 'actions' })
    const broken = await rev(page, 'rules.json')
    await page.getByText('Actions couldn’t be loaded.').waitFor()
    await page.getByText('Sushi keeps using the actions it read before.', { exact: false }).waitFor()
    assert.equal(await page.getByText('rules.json: entry 2 contains an empty field.').isVisible(), false, 'the details are folded')
    await page.getByText('Error details').click()
    await page.getByText('rules.json: entry 2 contains an empty field.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add action' }).count(), 0)
    assert.equal(await state(page).textContent(), 'Needs fixing')
    await capture(page, 'actions-invalid-dark')
    await page.getByRole('button', { name: 'Show in Finder' }).first().click()
    const restore = page.getByRole('button', { name: 'Restore default actions…' })
    await restore.click()
    await page.getByText('Replace your actions with Sushi’s defaults?').waitFor()
    await page.getByText('A copy of the current file is kept in the settings folder.').waitFor()
    await capture(page, 'actions-reset-confirm-dark')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByText('Replace your actions with Sushi’s defaults?').count(), 0, 'Esc cancels')
    assert.equal(await active(page), 'rules-json-restore', 'the focus goes back to the button')
    // A refused reset says why in the banner.
    await fixture(page, () => { window.fixture.resetRefuses = true })
    await restore.click()
    await page.getByRole('button', { name: 'Restore defaults' }).click()
    await page.getByText('rules.json changed again; Sushi read it once more.').waitFor()
    await fixture(page, () => { window.fixture.resetRefuses = false })
    await restore.click()
    await page.getByRole('button', { name: 'Restore defaults' }).click()
    await page.locator('.action-head', { hasText: 'Shorten' }).waitFor()
    assert.deepEqual((await fixture(page, () => window.fixture.resets)).at(-1), { name: 'rules.json', revision: broken })
    assert.deepEqual(await fixture(page, () => window.fixture.opened), [{ name: 'rules.json', action: 'reveal' }])
    await page.keyboard.press('Meta+Digit1')
    await page.locator('#keyboard-recorder').waitFor()
  })

  await t.test('library: the folder first, Show library in Finder, choose and return to the default', async t => {
    const page = await start(t, { pane: 'library' })
    await page.getByText('Default folder · ').waitFor()
    await page.getByText('12 prompts · 3 templates').waitFor()
    assert.equal(await page.locator('.folder-name').textContent(), 'Input')
    assert.equal(await page.getByRole('button', { name: 'Use default folder' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Show library in Finder' }).click()
    await page.waitForFunction(() => window.fixture.actions.includes('library'))
    await capture(page, 'library-default-dark')
    await fixture(page, () => { window.fixture.pick = '/Users/test/Documents/Prompts' })
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await page.getByText('/Users/test/Documents/Prompts').waitFor()
    await page.getByText('Custom folder · ').waitFor()
    assert.equal(await page.locator('.folder-name').textContent(), 'Prompts')
    await page.getByRole('button', { name: 'Use default folder' }).click()
    await page.getByText('Default folder · ').waitFor()
    assert.equal((await file(page, 'library-path.txt')).status, 'absent')
    assert.match(await page.locator('#library-file-edit').locator('..').textContent(), /Using defaults/)

    // Dictionary: a new term saves once both columns are filled; filter, nothing found, delete and undo.
    await page.getByRole('button', { name: 'Add term' }).click()
    await page.getByRole('textbox', { name: 'Heard as' }).last().fill('pull request')
    await page.getByRole('textbox', { name: 'Written as' }).last().fill('PR')
    await composingEnter(page.getByRole('textbox', { name: 'Written as' }).last())
    await page.waitForTimeout(50)
    assert.deepEqual(await calls(page, 'prefs_dictionary_save'), [], 'Return while composing does not save')
    await page.getByRole('textbox', { name: 'Written as' }).last().press('Enter')
    await page.waitForFunction(() => window.fixture.files['dictionary.json'].value.length === 5)
    await idle(page)
    const filter = page.getByRole('searchbox', { name: 'Filter terms' })
    await filter.fill('git')
    assert.equal(await page.locator('.terms .term').count(), 1)
    await filter.fill('zzz')
    await page.getByText('No matching terms').waitFor()
    await capture(page, 'library-no-match-dark')
    await page.getByRole('button', { name: 'Clear filter' }).click()
    assert.equal(await page.locator('.terms .term').count(), 5)
    const second = await page.locator('.term').nth(2).getAttribute('data-key')
    await page.getByRole('button', { name: 'Delete the term type script' }).click()
    await page.waitForFunction(() => window.fixture.files['dictionary.json'].value.length === 4)
    assert.equal(await active(page), 'term-from-' + second, 'the focus goes to the next term')
    await idle(page)
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(() => window.fixture.files['dictionary.json'].value.some(t => t.from === 'type script'))
  })

  await t.test('library: set outside Settings, and the controls say so', async t => {
    const page = await start(t, { fixture: 'environment', pane: 'library' })
    await page.getByText('Library folder set outside Settings').waitFor()
    await page.getByText('Sushi was started with SUSHI_LIBRARY_DIR. Remove it and restart Sushi to choose a folder here.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Choose folder…' }).count(), 0)
    await capture(page, 'library-environment-dark')
  })

  await t.test('about: copy only says Copied when it worked; Build details; Report a problem; the log', async t => {
    const page = await start(t, { pane: 'about' })
    await fixture(page, () => { window.fixture.actionFails = 'copy-build' })
    await page.getByRole('button', { name: 'Copy build info' }).click()
    await page.locator('#toast').getByText('The clipboard is not available.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Copied' }).count(), 0)
    await fixture(page, () => { window.fixture.actionFails = null })
    await page.getByRole('button', { name: 'Copy build info' }).click()
    await page.getByRole('button', { name: 'Copied' }).waitFor()
    await capture(page, 'about-fine-dark')
    assert.equal(await page.locator('.build-text').count(), 0)
    await page.getByRole('button', { name: 'Build details' }).click()
    await page.getByText('Include this in a problem report.').waitFor()
    await page.locator('.build-text').getByText(/signing\s+: ad-hoc/).waitFor()
    await capture(page, 'about-build-details-dark')
    await page.getByRole('switch', { name: 'Log panel activity' }).click()
    await page.waitForFunction(() => window.fixture.files['diagnostics.json'].value?.record === true)
    await idle(page)
    await page.getByRole('button', { name: 'Report a problem…' }).click()
    await page.getByRole('button', { name: 'Show log' }).click()
    await page.getByRole('button', { name: 'Show saved reports in Finder' }).click()
    await page.getByRole('button', { name: 'Open settings folder' }).click()
    await page.getByRole('button', { name: 'Documentation' }).click()
    await page.getByRole('button', { name: 'Release notes' }).click()
    await page.getByRole('button', { name: 'GitHub' }).click()
    assert.deepEqual(await fixture(page, () => window.fixture.actions), ['copy-build', 'report', 'log', 'reports', 'folder', 'docs', 'notes', 'github'])
  })

  await t.test('about: a report recording, and a broken diagnostics.json that affects only its row', async t => {
    const page = await start(t, { pane: 'about', tweak: s => { s.recording = true } })
    await page.getByText('Recording for a problem report').waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Log panel activity' }).count(), 0, 'no switch that says otherwise')
    const broken = await start(t, { pane: 'about', tweak: s => { s.files['diagnostics.json'] = { text: '{"record": "yes"}\n' } } })
    await broken.getByText('The logging setting couldn’t be loaded.').waitFor()
    assert.equal(await broken.getByRole('switch', { name: 'Log panel activity' }).isDisabled(), true)
    assert.equal(await broken.getByRole('button', { name: 'Copy build info' }).isDisabled(), false)
    assert.equal(await broken.locator('#pane-state').textContent(), 'Logging setting needs attention')
    await capture(broken, 'about-invalid-diagnostics-dark')
  })

  await t.test('round 2: a dictionary save never drops a term to make the list fit', async t => {
    const page = await start(t, { pane: 'library' })
    const key = async n => page.locator('.term').nth(n).getAttribute('data-key')
    const [first, second] = [await key(0), await key(1)]
    // The first row becomes invalid, so a save would write its original, mac whisper.
    await page.locator('#term-to-' + first).fill('')
    await page.locator('#term-to-' + first).press('Enter')
    await page.getByText('Type how it should be written.').waitFor()
    // The second row takes that source: refused at its own field, and nothing is sent.
    await page.locator('#term-from-' + second).fill('mac whisper')
    await page.locator('#term-from-' + second).press('Enter')
    await page.getByText('“mac whisper” is already in the dictionary.').waitFor()
    assert.equal(await page.locator('#term-from-' + second).getAttribute('aria-invalid'), 'true')
    assert.deepEqual(await calls(page, 'prefs_dictionary_save'), [])
    assert.equal((await file(page, 'dictionary.json')).value.length, 4)
  })

  await t.test('round 2: a recording that starts after the user left stays off, and Rust can end one', async t => {
    const page = await start(t)
    await fixture(page, () => { window.fixture.holdCapture = true })
    await page.locator('#keyboard-recorder').click()
    await page.keyboard.press('Meta+Digit3')
    await fixture(page, () => { window.fixture.holdCapture = false; window.fixture.releaseCapture() })
    await page.waitForFunction(() => window.fixture.captures.length === 2)
    assert.deepEqual(await fixture(page, () => window.fixture.captures), [true, false], 'a late capture is turned off again')
    await page.keyboard.press('Meta+Digit1')
    assert.equal(await page.locator('.recorder.recording').count(), 0)
    // Rust ends a capture by itself after a minute and says so with prefs-changed.
    await page.locator('#keyboard-recorder').click()
    await page.getByText('Press a shortcut…').waitFor()
    await emit(page, 'prefs-changed', { file: 'hotkey.json' })
    await page.getByText('Recording stopped. Click the shortcut to record again.').waitFor()
    assert.equal(await page.locator('.recorder.recording').count(), 0)
  })

  await t.test('round 2: an active shortcut Sushi cannot register; a backup that it cannot register', async t => {
    const page = await start(t, { fixture: 'not-registered' })
    await page.getByText('No key shows Sushi: ⌥Space could not be registered.').waitFor()
    await page.getByText('Choose another combination: another app may already use this one.', { exact: false }).waitFor()
    await capture(page, 'keyboard-not-registered-dark')
    // Choosing ⌃⇧Space, which works, is saved; a held combination is refused with Caps Lock off.
    await page.getByRole('button', { name: /Restore the default shortcut/ }).click()
    await page.waitForFunction(() => window.fixture.files['hotkey.json'].value.shortcut === 'Control+Shift+Space')
    await idle(page)
    await page.getByText('⌃⇧Space shows Sushi.', { exact: false }).waitFor()
  })

  await t.test('round 2: deleting or moving a record whose first save is in flight is written after it', async t => {
    const page = await start(t, { pane: 'actions' })
    await fixture(page, () => { window.fixture.holdSaves = true })
    await page.getByRole('button', { name: 'Add action' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Polite')
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Make it polite.')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.waitForFunction(() => window.fixture.held.length === 1)
    await page.locator('.action-head', { hasText: 'Polite' }).click()
    await page.getByRole('button', { name: 'Delete Polite' }).click()
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await page.waitForFunction(() => window.fixture.calls.filter(c => c.command === 'prefs_actions_save').length === 2)
    await idle(page)
    assert.equal((await file(page, 'rules.json')).value.length, 6, 'the action is gone from the file too')

    await page.keyboard.press('Meta+Digit4')
    await fixture(page, () => { window.fixture.holdSaves = true })
    await page.getByRole('button', { name: 'Add term' }).click()
    await page.getByRole('textbox', { name: 'Heard as' }).last().fill('pull request')
    await page.getByRole('textbox', { name: 'Written as' }).last().fill('PR')
    await page.getByRole('textbox', { name: 'Written as' }).last().press('Enter')
    await page.waitForFunction(() => window.fixture.held.length === 1)
    await page.getByRole('button', { name: 'Delete the term pull request' }).click()
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await page.waitForFunction(() => window.fixture.calls.filter(c => c.command === 'prefs_dictionary_save').length === 2)
    await idle(page)
    assert.equal((await file(page, 'dictionary.json')).value.length, 4)
  })

  await t.test('round 2: a folder conflict clears Choosing… and offers Choose again…', async t => {
    const page = await start(t, { pane: 'library' })
    await fixture(page, () => { window.fixture.pickGate = true; window.fixture.pick = '/Users/test/Documents/Prompts' })
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await page.getByRole('button', { name: 'Choosing…' }).waitFor()
    await fixture(page, () => window.fixture.touch('library-path.txt', '/Users/test/Elsewhere\n'))
    await fixture(page, () => window.fixture.releasePick())
    await page.getByText('library-path.txt changed while the folder picker was open', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Choosing…' }).count(), 0)
    await page.getByRole('button', { name: 'Choose again…' }).waitFor()
    await capture(page, 'library-folder-conflict-dark')
    await page.getByRole('button', { name: 'Use the file’s version' }).click()
    await page.getByText('/Users/test/Elsewhere').first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Choose folder…' }).isDisabled(), false)
  })

  await t.test('round 2: a conflict keeps its file side fresh; a phrase whose action goes away is a conflict', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    const name = page.getByRole('textbox', { name: 'Name' })
    await fixture(page, rules => window.fixture.touch('rules.json', rules.slice(0, 5)), rules)
    await name.fill('Shorter')
    await name.press('Enter')
    const banner = page.getByRole('alert').filter({ hasText: 'Actions changed outside Settings.' })
    await banner.waitFor()
    // The file changes once more while the banner waits; the file's version is the newest one.
    await fixture(page, rules => window.fixture.touch('rules.json', rules.slice(0, 4)), rules)
    await focusWindow(page)
    await page.waitForFunction(() => /The file has 4 actions/.test(document.querySelector('.banner')?.textContent ?? ''))
    await page.getByRole('button', { name: 'Use the file’s version' }).click()
    await banner.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.action').count(), 4)

    // A half-typed phrase whose action the file removes is not dropped silently.
    await page.locator('.action-head', { hasText: 'Clarify' }).click()
    await page.getByRole('textbox', { name: 'Add a phrase' }).fill('more clear')
    await fixture(page, rules => window.fixture.touch('rules.json', rules.slice(0, 3)), rules)
    await focusWindow(page)
    await banner.waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Add a phrase' }).inputValue(), 'more clear')
  })

  await t.test('round 2: a failed delete with no editor open says so at the list and counts as not saved', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Structure' }).click()
    await fixture(page, () => { window.fixture.failNext = 'rules.json' })
    await page.getByRole('button', { name: 'Delete Structure' }).click()
    await page.locator('#actions-save-error').getByText('Not saved: Could not save rules.json', { exact: false }).waitFor()
    assert.equal(await state(page).textContent(), 'Not saved')
    assert.equal(await page.locator('#nav-actions.pending').count(), 1)
    assert.equal((await file(page, 'rules.json')).value.length, 6)
  })

  await t.test('round 2: a load that read the files before a save cannot undo the save on screen', async t => {
    const page = await start(t, { pane: 'actions' })
    await fixture(page, () => { window.fixture.holdLoads = true })
    await focusWindow(page)
    await page.waitForFunction(() => window.fixture.loads.length === 1)
    await page.locator('.action-head', { hasText: 'Structure' }).click()
    await page.getByRole('button', { name: 'Move up' }).last().click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value[4].id === 'structure')
    await idle(page)
    await fixture(page, () => { window.fixture.holdLoads = false; window.fixture.loads.shift()() })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.action').nth(4).locator('.action-name').textContent(), 'Structure', 'the older read is ignored')
    assert.equal(await page.locator('.banner').count(), 0)
    // Writing the same bytes again keeps the revision, as a hash of the bytes does.
    const before = await rev(page, 'rules.json')
    await fixture(page, () => window.fixture.touch('rules.json', window.fixture.files['rules.json'].text))
    assert.equal(await rev(page, 'rules.json'), before)
  })

  await t.test('closing round: a term saved while its row was cleared stays in the file', async t => {
    const page = await start(t, { pane: 'library' })
    await fixture(page, () => { window.fixture.holdSaves = true })
    await page.getByRole('button', { name: 'Add term' }).click()
    const added = await page.locator('.term').last().getAttribute('data-key')
    await page.locator('#term-from-' + added).fill('pull request')
    await page.locator('#term-to-' + added).fill('PR')
    await page.locator('#term-to-' + added).press('Enter')
    await page.waitForFunction(() => window.fixture.held.length === 1)
    // The reply is on its way while the new row's “Written as” is cleared.
    await page.locator('#term-to-' + added).fill('')
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await idle(page)
    // Another term changes: the saved one must stay in what is written next.
    const first = await page.locator('.term').first().getAttribute('data-key')
    await page.locator('#term-to-' + first).fill('Mac Whisper')
    await page.locator('#term-to-' + first).press('Enter')
    await page.waitForFunction(() => window.fixture.calls.filter(c => c.command === 'prefs_dictionary_save').length === 2)
    await idle(page)
    const terms = (await file(page, 'dictionary.json')).value
    assert.deepEqual(terms.find(t => t.from === 'pull request'), { from: 'pull request', to: 'PR' })
    assert.equal(terms[0].to, 'Mac Whisper')
  })

  await t.test('closing round: Use for edits on a provider whose key is gone is refused at its row', async t => {
    const page = await start(t, { fixture: 'connected', pane: 'model' })
    await page.locator('.provider-head', { hasText: 'Claude' }).click()
    await fixture(page, () => { window.fixture.keychain.anthropic = false })
    const loads = (await calls(page, 'prefs_load')).length
    await page.getByRole('button', { name: 'Use for edits' }).click()
    await page.locator('.provider', { has: page.locator('#model-row-anthropic') }).getByText('No key for Claude is stored on this Mac any more. Connect Claude again to use it.').waitFor()
    await page.waitForFunction(n => window.fixture.calls.filter(c => c.command === 'prefs_load').length > n, loads)
    await page.locator('#model-row-anthropic').getByText('Not connected').waitFor()
    assert.equal((await file(page, 'model.json')).value.provider, 'openrouter')
    // A provider with only the key of v0.2.1 in model.json is keyed, as in Rust.
    const legacy = await start(t, { pane: 'model', tweak: s => { s.files['model.json'] = { text: json({ provider: 'ollama', openrouter: { key: 'sk-or-v1-old' } }) } } })
    await legacy.locator('.provider-head', { hasText: 'OpenRouter' }).click()
    await legacy.getByRole('button', { name: 'Use for edits' }).click()
    await legacy.waitForFunction(() => window.fixture.files['model.json'].value.provider === 'openrouter')
  })

  await t.test('closing round: logging, a linked model.json that does not validate, templates that cannot be read', async t => {
    const about = await start(t, { pane: 'about', tweak: s => { s.files['diagnostics.json'] = { text: '{"record": "yes"}\n' }; s.logging = true } })
    await about.getByText('The log is still being written.', { exact: false }).waitFor()
    assert.equal(await about.getByText('Nothing is logged meanwhile.', { exact: false }).count(), 0)
    const model = await start(t, { fixture: 'connected', pane: 'model', tweak: s => { s.files['model.json'] = { text: '{"provider": "openrouter", "openrouter": {"tier": "priority"}}\n', linked: true } } })
    await model.getByText('These settings are managed in another file.').waitFor()
    assert.equal(await model.locator('.in-use').count(), 0, 'a link that does not validate stops edits too')
    await model.getByText('Edits are stopped until it is fixed.', { exact: false }).waitFor()
    const library = await start(t, { fixture: 'connected', pane: 'library', tweak: s => { s.folders['/Users/test/Documents/Prompts'] = { prompts: 4, templates: null } } })
    await library.getByText('4 prompts · templates unavailable').waitFor()
  })

  await t.test('round 5: an edit made outside right after a save is never written over', async t => {
    // Dictionary: a → A, b → B; save a → A2; b changes outside right after that write; then a → A3.
    const page = await start(t, { pane: 'library', tweak: s => { s.files['dictionary.json'] = { text: json({ terms: [{ from: 'a', to: 'A' }, { from: 'b', to: 'B' }] }) } } })
    const a = await page.locator('.term').first().getAttribute('data-key')
    await fixture(page, () => { window.fixture.afterWrite['dictionary.json'] = f => { f.text = JSON.stringify({ terms: [{ from: 'a', to: 'A2' }, { from: 'b', to: 'B-external' }] }, null, 2) + '\n' } })
    await page.locator('#term-to-' + a).fill('A2')
    await page.locator('#term-to-' + a).press('Enter')
    await page.waitForFunction(() => window.fixture.files['dictionary.json'].value[1].to === 'B-external')
    await idle(page)
    await page.locator('#term-to-' + a).fill('A3')
    await page.locator('#term-to-' + a).press('Enter')
    await page.getByRole('alert').filter({ hasText: 'The dictionary changed outside Settings.' }).waitFor()
    assert.equal((await file(page, 'dictionary.json')).value[1].to, 'B-external', 'the outside edit is still in the file')

    // Actions: the same sequence.
    const actions = await start(t, { pane: 'actions' })
    await actions.locator('.action-head', { hasText: 'Shorten' }).click()
    await fixture(actions, rules => { window.fixture.afterWrite['rules.json'] = f => { const v = JSON.parse(f.text); v.rules[1].name = 'Fix spelling'; f.text = JSON.stringify(v) } }, rules)
    const name = actions.getByRole('textbox', { name: 'Name' })
    await name.fill('Shorter')
    await name.press('Enter')
    await actions.waitForFunction(() => window.fixture.files['rules.json'].value[1].name === 'Fix spelling')
    await idle(actions)
    await name.fill('Shortest')
    await name.press('Enter')
    await actions.getByRole('alert').filter({ hasText: 'Actions changed outside Settings.' }).waitFor()
    assert.equal((await file(actions, 'rules.json')).value[1].name, 'Fix spelling')

    // Keyboard: a queued change after the first one's write meets the outside edit.
    const keyboard = await start(t)
    await fixture(keyboard, () => {
      window.fixture.holdSaves = true
      window.fixture.afterWrite['hotkey.json'] = f => { f.text = JSON.stringify({ capsLock: false, shortcut: 'Option+KeyX' }) }
    })
    await keyboard.getByRole('radio', { name: 'Keyboard shortcut' }).click()
    await keyboard.waitForFunction(() => window.fixture.held.length === 1)
    await keyboard.getByRole('radio', { name: 'Caps Lock' }).click()
    await fixture(keyboard, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await keyboard.getByRole('alert').filter({ hasText: 'The shortcut settings changed outside Settings.' }).waitFor()
    assert.equal((await file(keyboard, 'hotkey.json')).value.shortcut, 'Option+KeyX')

    // Model: the same with two option changes.
    const model = await start(t, { fixture: 'connected', pane: 'model' })
    await model.getByRole('button', { name: 'Advanced' }).click()
    await fixture(model, () => {
      window.fixture.holdSaves = true
      window.fixture.afterWrite['model.json'] = f => { const v = JSON.parse(f.text); v.openrouter.model = 'external/model'; f.text = JSON.stringify(v) }
    })
    await model.getByLabel('OpenRouter reasoning effort').selectOption('low')
    await model.waitForFunction(() => window.fixture.held.length === 1)
    await model.getByLabel('OpenRouter service tier').selectOption('flex')
    await fixture(model, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await model.getByRole('alert').filter({ hasText: 'The model settings changed outside Settings.' }).waitFor()
    const written = (await file(model, 'model.json')).value.openrouter
    assert.equal(written.model, 'external/model')
    assert.equal(written.tier, 'fast', 'the queued change waits for a decision')
  })

  await t.test('round 5: Undo writes back the saved version of a deleted action or term whose draft was invalid', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('')
    await page.getByRole('textbox', { name: 'Name' }).press('Enter')
    await page.getByText('Give the action a name.').waitFor()
    await page.getByRole('button', { name: 'Delete Untitled' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.length === 5)
    await idle(page)
    // Undo while another save is in flight: the restored list goes after it.
    await fixture(page, () => { window.fixture.holdSaves = true })
    await page.locator('.action-head', { hasText: 'Clarify' }).click()
    await page.getByRole('button', { name: 'Move up' }).last().click()
    await page.waitForFunction(() => window.fixture.held.length === 1)
    // The move closed the toast; ⌘Z outside a text field still takes the delete back.
    assert.equal(await page.locator('#toast').isVisible(), false)
    await page.locator('.action-head', { hasText: 'Clarify' }).focus()
    await page.keyboard.press('Meta+z')
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.some(r => r.id === 'shorten'))
    await idle(page)
    assert.equal((await file(page, 'rules.json')).value.find(r => r.id === 'shorten').name, 'Shorten', 'the saved version is back')
    await page.locator('.action-head', { hasText: 'Untitled' }).locator('.pill.error').waitFor()

    const library = await start(t, { pane: 'library' })
    const first = await library.locator('.term').first().getAttribute('data-key')
    await library.locator('#term-to-' + first).fill('')
    await library.locator('#term-to-' + first).press('Enter')
    await library.getByRole('button', { name: 'Delete the term mac whisper' }).click()
    await library.waitForFunction(() => window.fixture.files['dictionary.json'].value.length === 3)
    await idle(library)
    await library.locator('#toast').getByRole('button', { name: 'Undo' }).click()
    await library.waitForFunction(() => window.fixture.files['dictionary.json'].value.some(t => t.from === 'mac whisper'))
    assert.equal((await file(library, 'dictionary.json')).value.find(t => t.from === 'mac whisper').to, 'MacWhisper')
  })

  await t.test('round 6: a refused save whose reply carries an outside edit is a conflict, never a new base', async t => {
    // Dictionary: a → A1, b → B1; a → A2 fails; b → B-external lands before the reply; then a → A3.
    const page = await start(t, { pane: 'library', tweak: s => { s.files['dictionary.json'] = { text: json({ terms: [{ from: 'a', to: 'A1' }, { from: 'b', to: 'B1' }] }) } } })
    const a = await page.locator('.term').first().getAttribute('data-key')
    await fixture(page, () => {
      window.fixture.failNext = 'dictionary.json'
      window.fixture.afterRefusal['dictionary.json'] = f => { f.text = JSON.stringify({ terms: [{ from: 'a', to: 'A1' }, { from: 'b', to: 'B-external' }] }, null, 2) + '\n' }
    })
    await page.locator('#term-to-' + a).fill('A2')
    await page.locator('#term-to-' + a).press('Enter')
    const banner = page.getByRole('alert').filter({ hasText: 'The dictionary changed outside Settings.' })
    await banner.waitFor()
    // Until the choice is made the rows cannot be edited, so nothing goes out under the outside revision.
    assert.equal(await page.locator('#term-to-' + a).isDisabled(), true)
    assert.equal(await page.locator('#term-to-' + a).inputValue(), 'A2', 'the draft is kept')
    assert.equal((await file(page, 'dictionary.json')).value[1].to, 'B-external', 'nothing went out under the outside revision')
    assert.equal((await calls(page, 'prefs_dictionary_save')).length, 1)
    await page.getByRole('button', { name: 'Use the file’s version' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.terms input')].some(input => input.value === 'B-external'))

    // Actions: the same sequence.
    const actions = await start(t, { pane: 'actions' })
    await actions.locator('.action-head', { hasText: 'Shorten' }).click()
    await fixture(actions, () => {
      window.fixture.failNext = 'rules.json'
      window.fixture.afterRefusal['rules.json'] = f => { const v = JSON.parse(f.text); v.rules[1].name = 'Fix spelling'; f.text = JSON.stringify(v) }
    })
    const name = actions.getByRole('textbox', { name: 'Name' })
    await name.fill('Shorter')
    await name.press('Enter')
    await actions.getByRole('alert').filter({ hasText: 'Actions changed outside Settings.' }).waitFor()
    assert.equal(await name.isDisabled(), true)
    assert.equal(await name.inputValue(), 'Shorter')
    assert.equal((await file(actions, 'rules.json')).value[1].name, 'Fix spelling')
    assert.equal((await calls(actions, 'prefs_actions_save')).length, 1)

    // Keyboard: the queued change waits for a decision.
    const keyboard = await start(t)
    await fixture(keyboard, () => {
      window.fixture.holdSaves = true
      window.fixture.failNext = 'hotkey.json'
      window.fixture.afterRefusal['hotkey.json'] = f => { f.text = JSON.stringify({ capsLock: false, shortcut: 'Option+KeyX' }) }
    })
    await keyboard.getByRole('radio', { name: 'Keyboard shortcut' }).click()
    await keyboard.waitForFunction(() => window.fixture.held.length === 1)
    await keyboard.getByRole('button', { name: /Restore the default shortcut/ }).click().catch(() => {})
    await keyboard.getByRole('radio', { name: 'Caps Lock' }).click()
    await fixture(keyboard, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await keyboard.getByRole('alert').filter({ hasText: 'The shortcut settings changed outside Settings.' }).waitFor()
    assert.equal((await file(keyboard, 'hotkey.json')).value.shortcut, 'Option+KeyX')
    assert.equal((await calls(keyboard, 'prefs_keyboard_save')).length, 1)

    // Model: the queued option waits too.
    const model = await start(t, { fixture: 'connected', pane: 'model' })
    await model.getByRole('button', { name: 'Advanced' }).click()
    await fixture(model, () => {
      window.fixture.holdSaves = true
      window.fixture.failNext = 'model.json'
      window.fixture.afterRefusal['model.json'] = f => { const v = JSON.parse(f.text); v.openrouter.model = 'external/model'; f.text = JSON.stringify(v) }
    })
    await model.getByLabel('OpenRouter reasoning effort').selectOption('low')
    await model.waitForFunction(() => window.fixture.held.length === 1)
    await model.getByLabel('OpenRouter service tier').selectOption('flex')
    await fixture(model, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await model.getByRole('alert').filter({ hasText: 'The model settings changed outside Settings.' }).waitFor()
    const written = (await file(model, 'model.json')).value.openrouter
    assert.deepEqual([written.model, written.tier], ['external/model', 'fast'])
    assert.equal((await calls(model, 'prefs_model_option')).length, 1)
  })

  await t.test('round 6: Undo writes the version a save in flight wrote before the delete', async t => {
    const page = await start(t, { pane: 'actions' })
    await page.locator('.action-head', { hasText: 'Shorten' }).click()
    await fixture(page, () => { window.fixture.holdSaves = true })
    const text = page.getByRole('textbox', { name: 'Instruction' })
    await text.fill('A2')
    await page.getByRole('textbox', { name: 'Name' }).focus()
    await page.waitForFunction(() => window.fixture.held.length === 1)
    await page.getByRole('textbox', { name: 'Name' }).fill('')
    await page.getByRole('textbox', { name: 'Name' }).press('Enter')
    await page.getByRole('button', { name: 'Delete Untitled' }).click()
    // The A2 save succeeds, then the delete goes out.
    await fixture(page, () => { window.fixture.holdSaves = false; window.fixture.held.shift()() })
    await page.waitForFunction(() => !window.fixture.files['rules.json'].value.some(r => r.id === 'shorten'))
    await idle(page)
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(() => window.fixture.files['rules.json'].value.some(r => r.id === 'shorten'))
    await idle(page)
    assert.equal((await file(page, 'rules.json')).value.find(r => r.id === 'shorten').instruction, 'A2', 'the last saved version, not the one before it')
  })

  await t.test('round 2: banners say what is true now', async t => {
    // The shortcut banner names the key in effect.
    const hotkey = await start(t, { tweak: s => { s.files['hotkey.json'] = { text: '{"capsLock": true}\n' } } })
    await hotkey.getByText('Meanwhile Caps Lock shows Sushi.', { exact: false }).waitFor()
    // A link whose target has a problem shows it under Error details.
    const linked = await start(t, { tweak: s => { s.files['hotkey.json'] = { text: '{"capsLock": false, "shortcut": "Space"}\n', linked: true } } })
    await linked.getByText('These settings are managed in another file.').waitFor()
    await linked.getByText('Error details').click()
    await linked.getByText(/needs at least one of Control, Option, Shift or Command/).waitFor()
    await capture(linked, 'keyboard-linked-invalid-dark')
    // A broken library-path.txt: the Library cannot open, and nothing is counted.
    const library = await start(t, { fixture: 'library-invalid', pane: 'library' })
    await library.getByText('The Library cannot open until the path is fixed.', { exact: false }).waitFor()
    await library.getByText('Not available until library-path.txt is fixed.').waitFor()
    await capture(library, 'library-invalid-dark')
    // Logging: whether the log is written comes from the pane.
    const about = await start(t, { pane: 'about', tweak: s => { s.files['diagnostics.json'] = { text: '{"record": "yes"}\n' }; s.recording = true } })
    await about.getByText('A problem report is recording, so the log is still written.', { exact: false }).waitFor()
    // A custom folder with prompts and no templates yet.
    const custom = await start(t, { fixture: 'connected', pane: 'library' })
    await custom.getByText('4 prompts · 0 templates').waitFor()
  })

  await t.test('the stub replies what Rust replied for every state of tests/fixtures/prefs', async t => {
    const folder = new URL('./fixtures/prefs/', import.meta.url)
    const names = (await readdir(folder)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort()
    assert.deepEqual(names, Object.keys(rustStates).sort(), 'every fixture has a state here, and no state is invented')
    // Revisions are hashes of the bytes; the stub's bytes and hash differ, the rest is the same.
    const strip = value => JSON.parse(JSON.stringify(value, (key, v) => key === 'revision' ? undefined : v))
    for (const name of names) {
      const page = await start(t, { rust: name })
      const replied = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('prefs_load'))
      const expected = JSON.parse(await readFile(new URL(name + '.json', folder), 'utf8'))
      assert.deepEqual(strip(replied), strip(expected), name)
      await page.context().close()
    }
  })

  await t.test('frames of every pane in both appearances, from the states Rust rendered', async t => {
    const shots = [
      ['keyboard', 'fresh', 'fine'], ['keyboard', 'hotkey-input-sources', 'input-sources'], ['keyboard', 'hotkey-not-registered', 'not-registered'],
      ['keyboard', 'linked-hotkey', 'linked'], ['model', 'connected', 'connected'], ['model', 'fresh', 'ollama'], ['model', 'no-section', 'no-section'],
      ['model', 'custom-model', 'custom-model'], ['model', 'invalid-model', 'invalid'], ['actions', 'fresh', 'list'], ['actions', 'invalid-rules', 'invalid'],
      ['library', 'library-custom', 'chosen'], ['library', 'library-invalid', 'invalid'], ['library', 'library-environment', 'environment'],
      ['about', 'diagnostics-on', 'fine'], ['about', 'recording', 'recording'],
    ]
    for (const scheme of ['dark', 'light']) {
      for (const [pane, rust, label] of shots) {
        const page = await start(t, { rust, pane, scheme })
        assert.equal(await heading(page).textContent(), pane[0].toUpperCase() + pane.slice(1))
        await capture(page, `${pane}-${label}-${scheme}`)
        if (pane === 'actions' && label === 'list') {
          await page.locator('.action-head', { hasText: 'Turn into goal' }).click()
          await page.getByRole('textbox', { name: 'Text to insert' }).waitFor()
          await capture(page, `actions-prefix-${scheme}`)
          await page.locator('.action-head', { hasText: 'Turn into goal' }).click()
          await page.locator('.action-head', { hasText: 'Shorten' }).click()
          await capture(page, `actions-editor-${scheme}`)
        }
        if (pane === 'model' && (label === 'connected' || label === 'no-section')) {
          await page.getByRole('button', { name: 'Advanced' }).click()
          await page.locator('#pane').evaluate(node => { node.scrollTop = node.scrollHeight })
          await capture(page, `model-${label}-advanced-${scheme}`)
        }
        if (pane === 'keyboard' && label === 'fine') {
          await page.locator('#pane').evaluate(node => { node.scrollTop = node.scrollHeight })
          await capture(page, `keyboard-reference-${scheme}`)
        }
        if (pane === 'about' && label === 'fine') {
          await page.getByRole('button', { name: 'Build details' }).click()
          await capture(page, `about-build-details-${scheme}`)
        }
        await page.context().close()
      }
    }
  })
})
