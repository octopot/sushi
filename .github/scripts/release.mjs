#!/usr/bin/env node
// Release guardrails and packaging shared by the pre-push hook, make targets and CI.
// Zero dependencies: Node, git, gh and, for packaging, the macOS ditto and codesign.
//
//   release.mjs check  <tag> [--local] [--sha <commit>] [--pushed <branch>=<sha>]...
//   release.mjs version                                      (prints the version the files agree on)
//   release.mjs render <tag> --site-url <url> --out <file>   (prints the title)
//   release.mjs package [--app <path>] [--out <dir>] [--signing adhoc|developer-id]
//                                                            (zip, checksums.txt and the cask for these bytes)
//   release.mjs cask --version <v> --sha256 <hex> [--signing adhoc|developer-id] [--out <file>]
//   release.mjs tap <cask-file> --version <v>                (CI: commit the cask to the tap through the API)
//   release.mjs preflight [<tag>]                            (CI: secrets a release needs; outputs the tap and the signing mode)
//   release.mjs doctor                                       (on demand: config vs GitHub, with remediation)
//   release.mjs pages  <base-url>                            (CI: the Pages URL matches settings.json pages)
//   release.mjs site-env                                     (CI: SITE_URL and BASE_PATH of a preview, from settings.json pages)
//   release.mjs smoke  <site-url> [--retries <n>]            (CI: the deployed site serves pages and assets)
//   release.mjs signature <tag>                              (CI: GitHub verifies the tag's signature)

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SETTINGS = '.github/settings.json'
const DEFAULTS = {
  tag_pattern: '^v\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$',
  notes: 'docs/content/changelog/{tag}.md',
  branches: [],
  versions: ['package.json'],
  app: 'Susi.app',
  asset: 'susi_{version}_darwin-arm64.zip',
  tap: null,
}
const BUNDLE_DIR = 'src-tauri/target/release/bundle/macos'

// --- helpers -----------------------------------------------------------------

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function tryGit(...args) {
  try { return git(...args) } catch { return null }
}

function gh(...args) {
  const opts = typeof args.at(-1) === 'object' ? args.pop() : {}
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'], input: opts.input, env: { ...process.env, ...(opts.env || {}) } })
  } catch (e) {
    const err = new Error((e.stderr || e.message || '').trim())
    err.status = e.status
    throw err
  }
}

function settings(sha) {
  const raw = sha ? tryGit('show', `${sha}:${SETTINGS}`) : (existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null)
  const cfg = raw ? JSON.parse(raw) : {}
  return { release: { ...DEFAULTS, ...(cfg['x-release'] || {}) }, secrets: cfg.secrets || {}, pages: cfg.pages || null, workflows: cfg.workflows || {} }
}

function args(argv) {
  const out = { _: [], pushed: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pushed') {
      const [b, s] = argv[++i].split('=')
      out.pushed[b] = s
    } else if (a === '--local') {
      out.local = true
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[++i]
    } else {
      out._.push(a)
    }
  }
  return out
}

// Splits a Markdown document into frontmatter and body, parsing `key: value` lines.
export function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return { meta: null, body: text }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^".*"$/.test(v)) v = JSON.parse(v)
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'")
    meta[kv[1]] = v
  }
  return { meta, body: text.slice(m[0].length) }
}

// Calls fn for every piece of prose, skipping fenced code blocks and inline code spans.
function mapProse(body, fn) {
  let fence = null
  return body.split('\n').map((line, i) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return line
    }
    if (f) { fence = f[1]; return line }
    return line.split(/(`+[^`]*`+)/).map((part, j) => (j % 2 ? part : fn(part, i + 1))).join('')
  }).join('\n')
}

function releaseBranch(tag, release, defaultBranch) {
  for (const { match, branch } of release.branches) {
    const m = tag.match(new RegExp(match))
    if (m) return branch.replace(/\$(\d+)/g, (_, n) => m[n] ?? '')
  }
  return defaultBranch
}

function defaultBranch() {
  if (process.env.DEFAULT_BRANCH) return process.env.DEFAULT_BRANCH
  const head = tryGit('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  return head ? head.trim().replace(/^origin\//, '') : null
}

export const isPrerelease = (tag) => tag.replace(/^v/, '').includes('-')

// --- versions ----------------------------------------------------------------

// The version a file declares, by its name: package.json and tauri.conf.json
// carry "version", Cargo.toml its [package] version, Cargo.lock the entry of
// the package that the Cargo.toml next to it names. release.mjs, the site's,
// carries `version: '…'`, and its `tag` and `archive` must name the same
// version (archive as x-release.asset spells it); otherwise this throws.
export function declaredVersion(file, text, read = () => null, asset = DEFAULTS.asset) {
  const name = basename(file)
  if (name.endsWith('.json')) return JSON.parse(text).version ?? null
  if (name === 'release.mjs') {
    const field = (key) => text.match(new RegExp(`^\\s*${key}:\\s*'([^'\\n]*)'`, 'm'))?.[1] ?? null
    const version = field('version')
    if (version === null) return null
    const want = { tag: `v${version}`, archive: asset.replace('{version}', version) }
    for (const [key, value] of Object.entries(want)) {
      if (field(key) !== value) throw new Error(`${file}: ${key} is ${field(key) ?? 'missing'}, not ${value} for version ${version}; keep version, tag and archive in step`)
    }
    return version
  }
  if (name === 'Cargo.toml') {
    const pkg = text.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] || ''
    return pkg.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null
  }
  if (name === 'Cargo.lock') {
    const manifest = read(join(dirname(file), 'Cargo.toml'))
    const pkg = manifest?.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] || ''
    const crate = pkg.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
    if (!crate) return null
    const esc = crate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.match(new RegExp(`^\\[\\[package\\]\\]\\s*\\nname = "${esc}"\\s*\\nversion = "([^"]+)"`, 'm'))?.[1] ?? null
  }
  throw new Error(`${file}: unsupported version file`)
}

// [file, version or null, problem] for every file of x-release.versions, read
// from the working tree or from a commit.
function versions(release, sha) {
  const read = (f) => (sha ? tryGit('show', `${sha}:${f}`) : (existsSync(f) ? readFileSync(f, 'utf8') : null))
  return release.versions.map((f) => {
    const text = read(f)
    if (text === null) return [f, null]
    try { return [f, declaredVersion(f, text, read, release.asset)] } catch (e) { return [f, null, e.message] }
  })
}

function versionErrors(found, want, where) {
  const errors = []
  for (const [file, v, problem] of found) {
    if (problem) errors.push(`${problem}${where ? ` in ${where}` : ''}`)
    else if (v === null) errors.push(`${file}: no version${where ? ` in ${where}` : ''}`)
    else if (want !== undefined && v !== want) errors.push(`${file}: version is ${v}, not ${want}${where ? ` in ${where}` : ''}; set ${want} in every version file (cargo updates Cargo.lock), commit it and move the tag`)
  }
  if (want === undefined) {
    const seen = new Set(found.map(([, v]) => v).filter(Boolean))
    if (seen.size > 1) errors.push(`version files disagree: ${found.map(([f, v]) => `${f}=${v}`).join(', ')}`)
  }
  return errors
}

function currentVersion() {
  const found = versions(settings().release)
  const errors = versionErrors(found)
  if (errors.length) throw new Error(errors.join('\n'))
  return found[0][1]
}

// --- check -------------------------------------------------------------------

function check(tag, opts) {
  const errors = []
  const sha = (opts.sha || tryGit('rev-parse', `${tag}^{commit}`) || '').trim()
  if (!sha) return [`${tag}: tag not found; create it first`]

  const { release } = settings(sha)
  if (!new RegExp(release.tag_pattern).test(tag)) {
    errors.push(`${tag}: does not match x-release.tag_pattern ${release.tag_pattern} in ${SETTINGS}`)
  }

  const note = release.notes.replace('{tag}', tag)
  const committed = tryGit('show', `${sha}:${note}`)
  if (committed === null) {
    errors.push(`${note}: missing in ${tag}; write the release note, commit it and move the tag`)
  } else {
    const staged = tryGit('show', `:${note}`)
    const worktree = existsSync(note) ? readFileSync(note, 'utf8') : null
    if (staged !== committed || worktree !== committed) {
      errors.push(`${note}: has changes not in ${tag}; commit them and move the tag`)
    }
    errors.push(...lint(note, committed))
  }

  errors.push(...versionErrors(versions(release, sha), tag.replace(/^v/, ''), tag))

  const base = defaultBranch()
  const branch = releaseBranch(tag, release, base)
  if (!branch) {
    errors.push(`${tag}: cannot resolve the default branch; run: git remote set-head origin --auto`)
  } else {
    // Local preparation may precede a branch push; hooks and CI validate the
    // actual push transaction or the fetched remote branch instead.
    const ref = opts.local ? `refs/heads/${branch}` : `refs/remotes/origin/${branch}`
    const tip = opts.pushed[branch] || tryGit('rev-parse', '--verify', '-q', ref)?.trim()
    if (!tip) {
      errors.push(`${tag}: branch ${branch} is unknown; push it together with the tag: git push --atomic origin ${branch} ${tag}`)
    } else if (tryGit('merge-base', '--is-ancestor', sha, tip) === null) {
      errors.push(`${tag}: its commit is not on ${branch}; push both at once: git push --atomic origin ${branch} ${tag}`)
    }
  }
  return errors
}

// A release comes only from a tag GitHub verifies. Checked before anything is
// published, a bad tag can still be replaced.
function signature(tag) {
  const slug = repoSlug()
  if (!slug) return ['cannot resolve the repository; set GITHUB_REPOSITORY']
  const fix = `git push --delete origin ${tag}, git tag -s, then push it with the branch`
  let ref
  try {
    ref = JSON.parse(gh('api', `repos/${slug}/git/ref/tags/${encodeURIComponent(tag)}`))
  } catch (e) {
    return [`${tag}: not found on ${slug}: ${e.message}`]
  }
  if (ref.object.type !== 'tag') return [`${tag}: lightweight tag; replace it with a signed one: ${fix}`]
  const { object, verification } = JSON.parse(gh('api', `repos/${slug}/git/tags/${ref.object.sha}`))
  if (object.type !== 'commit') return [`${tag}: points at a ${object.type}, not a commit; replace it: ${fix}`]
  if (!verification?.verified) {
    return [`${tag}: GitHub does not verify its signature (${verification?.reason || 'unsigned'}); replace it with one signed by a key your GitHub account has: ${fix}`]
  }
  return []
}

export function lint(file, text) {
  const errors = []
  const { meta, body } = frontmatter(text)
  if (!meta) return [`${file}: no frontmatter; add title and description`]
  for (const key of ['title', 'description']) {
    if (!meta[key]) errors.push(`${file}: frontmatter has no ${key}`)
  }
  const first = body.split('\n').find((l) => l.trim() !== '')
  if (!first || first.trim() !== `# ${meta.title}`) {
    errors.push(`${file}: the first line must be the H1 "# ${meta.title}", as in frontmatter title`)
  }
  const offset = text.slice(0, text.length - body.length).split('\n').length - 1
  let h1 = 0
  mapProse(body, (prose, n) => {
    const line = n + offset
    if (/^# /.test(prose)) h1++
    if (/^\s*(import|export)\s/.test(prose)) errors.push(`${file}:${line}: MDX import/export is not supported in release notes`)
    if (/<[A-Z][\w.]*[\s/>]/.test(prose)) errors.push(`${file}:${line}: MDX components are not supported in release notes`)
    return prose
  })
  if (h1 > 1) errors.push(`${file}: more than one H1`)
  return errors
}

// --- render ------------------------------------------------------------------

function render(tag, opts) {
  if (!opts['site-url'] || !opts.out) throw new Error('render needs --site-url and --out')
  const { release } = settings()
  const note = release.notes.replace('{tag}', tag)
  const text = readFileSync(note, 'utf8')
  const errors = lint(note, text)
  if (errors.length) throw new Error(errors.join('\n'))

  const { meta, body } = frontmatter(text)
  const site = opts['site-url'].replace(/\/+$/, '')
  const abs = (url) => `${site}${url}`
  const out = mapProse(body.replace(/^\s*# .*\n+/, ''), (prose) => prose
    .replace(/(\]\()(\/(?!\/)[^)\s]*)/g, (_, p, url) => p + abs(url))           // [text](/path) and ![alt](/path)
    .replace(/^(\s*\[[^\]]+\]:\s*)(\/(?!\/)\S*)/, (_, p, url) => p + abs(url)) // [ref]: /path
    .replace(/(\s(?:href|src)=["'])(\/(?!\/)[^"']*)/g, (_, p, url) => p + abs(url)))
  writeFileSync(opts.out, out.trimEnd() + '\n')
  process.stdout.write(meta.title + '\n')
}

// --- cask --------------------------------------------------------------------

const SIGNING = ['adhoc', 'developer-id']

// Fills the cask template: "#!" lines are template comments; the block between
// "#! adhoc:begin" and "#! adhoc:end" stays only for an ad-hoc signed build,
// which Gatekeeper refuses while it is quarantined.
export function renderCask(template, { version, sha256, signing = 'adhoc' }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error(`cask: version ${version} is not X.Y.Z`)
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error(`cask: sha256 ${sha256} is not 64 lowercase hex digits`)
  if (!SIGNING.includes(signing)) throw new Error(`cask: signing ${signing} is not one of ${SIGNING.join(', ')}`)
  let inAdhoc = false
  const lines = []
  for (const line of template.split('\n')) {
    const marker = line.match(/^#! adhoc:(begin|end)\s*$/)
    if (marker) { inAdhoc = marker[1] === 'begin'; continue }
    if (line.startsWith('#!')) continue
    if (inAdhoc && signing !== 'adhoc') continue
    lines.push(line)
  }
  if (inAdhoc) throw new Error('cask: "#! adhoc:begin" without "#! adhoc:end"')
  const out = lines.join('\n').replaceAll('@VERSION@', version).replaceAll('@SHA256@', sha256)
  if (/@[A-Z0-9_]+@/.test(out)) throw new Error(`cask: unknown placeholder ${out.match(/@[A-Z0-9_]+@/)[0]}`)
  return out.replace(/^\n+/, '')
}

function cask(opts) {
  const { release } = settings()
  if (!release.tap) throw new Error(`no x-release.tap in ${SETTINGS}`)
  const text = renderCask(readFileSync(release.tap.template, 'utf8'), { version: opts.version, sha256: opts.sha256, signing: opts.signing })
  if (opts.out) writeFileSync(opts.out, text)
  else process.stdout.write(text)
}

// --- package -----------------------------------------------------------------

const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

// Packs the bundle the way the cask unpacks it, proves that the signature
// survives the round trip and writes the checksums and the cask for exactly
// these bytes. macOS only: ditto keeps the extended attributes and resource
// forks that zip drops.
function pack(opts) {
  const { release } = settings()
  const version = currentVersion()
  const app = opts.app || join(BUNDLE_DIR, release.app)
  const out = opts.out || 'artifacts'
  const signing = opts.signing || 'adhoc'
  if (!SIGNING.includes(signing)) throw new Error(`--signing ${signing} is not one of ${SIGNING.join(', ')}`)
  if (!existsSync(app)) throw new Error(`${app}: not found; build it first: npm run bundle`)
  const plist = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
  if (plist !== version) throw new Error(`${app}: CFBundleShortVersionString is ${plist}, the version files say ${version}; rebuild it`)
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })

  mkdirSync(out, { recursive: true })
  const asset = release.asset.replace('{version}', version)
  const zip = join(out, asset)
  rmSync(zip, { force: true })
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { stdio: 'inherit' })

  const scratch = mkdtempSync(join(tmpdir(), 'susi-unpack-'))
  try {
    execFileSync('ditto', ['-x', '-k', zip, scratch], { stdio: 'inherit' })
    const unpacked = join(scratch, basename(app))
    execFileSync('codesign', ['--verify', '--deep', '--strict', unpacked], { stdio: 'inherit' })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  const sum = sha256File(zip)
  writeFileSync(join(out, 'checksums.txt'), `${sum}  ${asset}\n`)
  if (release.tap) {
    const caskFile = join(out, basename(release.tap.cask))
    writeFileSync(caskFile, renderCask(readFileSync(release.tap.template, 'utf8'), { version, sha256: sum, signing }))
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `asset=${asset}\nversion=${version}\nsha256=${sum}\n`)
  console.log(`${zip}\n${join(out, 'checksums.txt')}\nsha256 ${sum}`)
}

// The sha256 of an asset as a checksums.txt names it.
export function checksumOf(text, asset) {
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/)
    if (m && m[2].trim() === asset) return m[1]
  }
  return null
}

// --- tap ---------------------------------------------------------------------

export const caskVersion = (text) => text?.match(/^\s*version\s+"([^"]+)"/m)?.[1] ?? null

function compareVersions(a, b) {
  const parse = (v) => v.split('-')[0].split('.').map(Number)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

// What publishing a cask should do, given what the tap holds: the same text
// is a no-op (a rerun after a partial failure), a newer version there is a
// refusal (never downgrade the tap), anything else is a write.
export function tapAction(current, next) {
  if (current === null) return { action: 'create' }
  if (current === next) return { action: 'skip', reason: 'the tap already has this cask' }
  const have = caskVersion(current)
  const want = caskVersion(next)
  if (have && want && compareVersions(have, want) > 0) {
    return { action: 'refuse', reason: `the tap has ${have}, newer than ${want}; refusing to downgrade it` }
  }
  return { action: 'update' }
}

// Commits through the contents API with the token minted from the Releaser
// App and no author or committer, so GitHub signs the commit as the App.
function tap(file, opts) {
  const { release } = settings()
  if (!release.tap) throw new Error(`no x-release.tap in ${SETTINGS}`)
  if (!process.env.GH_TOKEN) throw new Error('tap: GH_TOKEN is empty; pass the token minted for the tap')
  const { owner, name, cask: path } = release.tap
  const next = readFileSync(file, 'utf8')
  const version = opts.version || caskVersion(next)
  const endpoint = `repos/${owner}/${name}/contents/${path}`
  let current = null
  let sha
  try {
    const got = JSON.parse(gh('api', endpoint))
    current = Buffer.from(got.content, 'base64').toString('utf8')
    sha = got.sha
  } catch (e) {
    if (!/Not Found|HTTP 404/.test(e.message)) throw e
  }
  const decision = tapAction(current, next)
  if (decision.action === 'refuse') throw new Error(`tap: ${decision.reason}`)
  if (decision.action === 'skip') { console.log(`tap: ${owner}/${name} ${path}: ${decision.reason}`); return }
  const body = { message: `Brew cask update for susi version v${version}`, content: Buffer.from(next).toString('base64'), ...(sha ? { sha } : {}) }
  const res = JSON.parse(gh('api', '-X', 'PUT', endpoint, '--input', '-', { input: JSON.stringify(body) }))
  console.log(`tap: ${owner}/${name} ${path} ${decision.action}d in ${res.commit.sha}, verified: ${res.commit.verification?.verified ?? 'unknown'}`)
}

// --- pages and smoke ---------------------------------------------------------

// owner/name from GITHUB_REPOSITORY or the origin remote.
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const m = tryGit('remote', 'get-url', 'origin')?.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : null
}

// The URL the site must be built for: the custom domain, or the default one.
function expectedSite(pages, slug) {
  if (pages?.cname) return `https://${pages.cname}/`
  if (!slug) return null
  const [owner, name] = slug.toLowerCase().split('/')
  return name === `${owner}.github.io` ? `https://${name}/` : `https://${owner}.github.io/${name}/`
}

const slash = (url) => url.replace(/\/*$/, '/')

// The build bakes the base path and the origin in; a domain changed in Settings
// but not in settings.json (or the reverse) must stop the build, not ship it.
function pagesCheck(baseUrl) {
  const expected = expectedSite(settings().pages, repoSlug())
  if (!baseUrl) return ['no Pages base URL; is actions/configure-pages set up?']
  if (!expected) return ['cannot resolve the repository; set GITHUB_REPOSITORY or the origin remote']
  if (slash(baseUrl) === expected) return []
  return [`Pages serves ${slash(baseUrl)}, ${SETTINGS} expects ${expected}; ` +
    'update pages.cname there or Settings → Pages → Custom domain so they agree']
}

async function probe(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init })
    return { status: res.status, type: res.headers.get('content-type') || '', location: res.headers.get('location'), text: init.method === 'HEAD' ? '' : await res.text() }
  } catch (e) {
    return { status: 0, type: '', location: null, text: '', error: e.cause?.code || e.message }
  }
}

async function smokeOnce(site) {
  const errors = []
  const expect = (cond, msg) => { if (!cond) errors.push(msg) }
  const show = (r) => r.error || `HTTP ${r.status}`

  const home = await probe(site)
  expect(home.status === 200 && home.type.includes('text/html'), `${site}: ${show(home)}, want an HTML page`)
  if (home.status !== 200) return errors

  // A stale base path is exactly this: the page loads, its assets do not.
  const assets = [...new Set(home.text.match(/(?:href|src)="([^"]*\/_next\/static\/[^"]+\.(?:css|js))"/g) || [])]
    .map((a) => new URL(a.replace(/^(?:href|src)="|"$/g, ''), site).href)
  expect(assets.length > 0, `${site}: no /_next/static assets referenced`)
  for (const url of [assets.find((a) => a.endsWith('.css')), assets.find((a) => a.endsWith('.js'))].filter(Boolean)) {
    const r = await probe(url, { method: 'HEAD' })
    expect(r.status === 200, `${url}: ${show(r)}; the site was built for another base path, rebuild it`)
  }

  // A social preview is optional; when the page declares one, it must load.
  const og = home.text.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)?.[1]
  if (og) {
    expect(og.startsWith(site), `og:image ${og} is outside ${site}; SITE_URL is stale, rebuild the site`)
    const r = await probe(og, { method: 'HEAD' })
    expect(r.status === 200 && r.type.startsWith('image/'), `${og}: ${show(r)}, want an image`)
  }

  const nested = await probe(new URL('changelog/', site).href)
  expect(nested.status === 200, `${site}changelog/: ${show(nested)}`)

  const missing = await probe(new URL('smoke-missing-page/', site).href)
  expect(missing.status === 404 && missing.text.includes('/_next/static/'), `${site}smoke-missing-page/: ${show(missing)}, want the site's own 404`)

  // With a custom domain, the default one only redirects, keeping the path.
  const slug = repoSlug()
  const fallback = expectedSite(null, slug)
  if (fallback && fallback !== site) {
    const r = await probe(new URL('changelog/', fallback).href)
    expect([301, 302, 308].includes(r.status) && r.location === new URL('changelog/', site).href,
      `${fallback}changelog/: ${show(r)} to ${r.location}, want a redirect to ${site}changelog/`)
  }
  return errors
}

// Pages may serve the previous deployment for a while after deploy-pages returns.
async function smoke(site, retries) {
  if (!Number.isInteger(retries) || retries < 0) return [`--retries must be a non-negative integer, got ${retries}`]
  let errors = []
  for (let i = 0; i <= retries; i++) {
    errors = await smokeOnce(slash(site))
    if (!errors.length || i === retries) break
    await new Promise((r) => setTimeout(r, 15000))
  }
  return errors
}

// --- preflight and doctor ----------------------------------------------------

// The tap token is not a secret: cd.yml mints it per run from the OctoLab
// Releaser GitHub App installed on the tap, so GitHub signs the commits there.
const RELEASER_APP = { id: 'OCTOLAB_RELEASER_CLIENT_ID', key: 'OCTOLAB_RELEASER_KEY' }
// Developer ID signing and notarization switch on together, only when all of
// these are set: a signed but not notarized app fails Gatekeeper all the same.
const APPLE = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_PRIVATE_KEY']

function secretGuide(name, t) {
  const save = `(gh secret set ${name} -o <org> or -R <owner>/<repo>)`
  if (t && (name === RELEASER_APP.id || name === RELEASER_APP.key)) {
    const app = `a GitHub App owned by ${t.owner} with no webhook and Repository permissions → Contents: Read and write, ` +
      `installed on ${t.owner}/${t.name}`
    return name === RELEASER_APP.id
      ? `create ${app}; save its Client ID as secret ${name} ${save}`
      : `generate a private key for ${app}; save the .pem file as secret ${name} ${save}`
  }
  if (APPLE.includes(name) || name === 'APPLE_SIGNING_IDENTITY') {
    return `optional, with the other APPLE_* secrets: Developer ID signing and notarization, see .github/workflows/README.md ${save}`
  }
  return `save it as secret ${name} ${save}`
}

// Checks the credentials before anything is built. A stable tag needs the App
// to publish the cask; a prerelease or a snapshot leaves the tap alone. The
// Apple secrets are all or nothing.
export function preflight(tag, env = process.env) {
  const { release } = settings()
  const t = release.tap
  const errors = []
  const stable = Boolean(tag) && !isPrerelease(tag)
  if (stable && t) {
    errors.push(...Object.values(RELEASER_APP)
      .filter((name) => !env[name])
      .map((name) => `secret ${name} is empty or not passed to this step; ${secretGuide(name, t)}`))
  }
  const apple = APPLE.filter((name) => env[name])
  if (apple.length && apple.length < APPLE.length) {
    const missing = APPLE.filter((name) => !env[name])
    errors.push(`Developer ID signing needs all of ${APPLE.join(', ')}; ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} empty. Set them, or remove the others to stay ad-hoc`)
  }
  const signing = apple.length === APPLE.length ? 'developer-id' : 'adhoc'
  if (!errors.length && env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `tap-owner=${t?.owner ?? ''}\ntap-name=${t?.name ?? ''}\ncask=${stable && t ? 'true' : 'false'}\nsigning=${signing}\n`)
  }
  return errors
}

async function doctor() {
  const report = []
  const ok = (m) => report.push(['ok', m])
  const fail = (m) => report.push(['fail', m])
  const skip = (m) => report.push(['unverified', m])

  try {
    const v = currentVersion()
    ok(`version ${v} in ${settings().release.versions.join(', ')}`)
  } catch (e) {
    e.message.split('\n').forEach((m) => fail(m))
  }

  let repo
  try {
    repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'))
  } catch (e) {
    fail(`gh cannot reach the repository (${e.message}); run: gh auth login`)
    return report
  }
  const slug = repo.nameWithOwner
  const owner = slug.split('/')[0]

  const local = defaultBranch()
  const remote = repo.defaultBranchRef?.name
  if (local === remote) ok(`default branch ${remote}`)
  else fail(`local origin/HEAD is ${local ?? 'unset'}, GitHub says ${remote}; run: git remote set-head origin --auto`)

  try {
    const workflows = JSON.parse(gh('api', `repos/${slug}/actions/workflows`, '--paginate', '--slurp'))
      .flatMap((page) => page.workflows)
    const declared = settings().workflows
    for (const workflow of workflows.filter((w) => w.path.startsWith('.github/workflows/'))) {
      const file = workflow.path.split('/').at(-1)
      const want = declared[file]?.state || 'active'
      if (workflow.state === want) {
        if (want !== 'active') ok(`${workflow.name} is ${want} on purpose: ${declared[file].reason || SETTINGS}`)
      } else if (want === 'active') {
        fail(`${workflow.name} is ${workflow.state}; after pushing the reviewed YAML, run: gh workflow enable ${file} -R ${slug}`)
      } else {
        fail(`${workflow.name} is ${workflow.state}, ${SETTINGS} wants ${want}; run: gh workflow disable ${file} -R ${slug}, or drop it from ${SETTINGS}`)
      }
    }
  } catch (e) {
    skip(`workflow activation state is not readable (${e.message})`)
  }

  let pages = null
  try {
    pages = JSON.parse(gh('api', `repos/${slug}/pages`))
  } catch {
    if (settings().pages) fail(`Pages is not enabled or not readable, but ${SETTINGS} declares it; check https://github.com/${slug}/settings/pages`)
    else skip(`Pages is not enabled or not readable; enable it in https://github.com/${slug}/settings/pages if docs are published`)
  }
  if (pages) {
    const want = settings().pages || {}
    const where = `https://github.com/${slug}/settings/pages`
    if (pages.build_type === (want.build_type || 'workflow')) ok(`Pages publishes ${pages.html_url} from GitHub Actions`)
    else fail(`Pages builds from a branch; set Settings → Pages → Source: GitHub Actions (${where})`)
    if ((pages.cname || null) === (want.cname || null)) ok(`Pages domain ${pages.cname || 'default'} matches ${SETTINGS}`)
    else fail(`Pages domain is ${pages.cname || 'default'}, ${SETTINGS} says ${want.cname || 'default'}; align them (${where}), then rebuild the docs: gh workflow run cd.docs.yml`)
    if (want.https_enforced !== undefined) {
      if (pages.https_enforced === want.https_enforced) ok(`Pages HTTPS enforcement is ${pages.https_enforced ? 'on' : 'off'}`)
      else fail(`Pages HTTPS enforcement is ${pages.https_enforced ? 'on' : 'off'}, ${SETTINGS} wants ${want.https_enforced ? 'on' : 'off'}; toggle Enforce HTTPS (${where})`)
    }
    const site = expectedSite(want, slug)
    const errors = await smoke(site, 0)
    if (errors.length) errors.forEach((e) => fail(`site: ${e}`))
    else ok(`site ${site} serves its pages and assets`)
  }

  const t = settings().release.tap
  if (t) {
    try {
      const text = Buffer.from(JSON.parse(gh('api', `repos/${t.owner}/${t.name}/contents/${t.cask}`)).content, 'base64').toString('utf8')
      ok(`${t.owner}/${t.name} ${t.cask} has version ${caskVersion(text)}`)
    } catch (e) {
      if (/Not Found|HTTP 404/.test(e.message)) ok(`${t.owner}/${t.name} has no ${t.cask} yet; the first stable release creates it`)
      else skip(`${t.owner}/${t.name} is not readable (${e.message})`)
    }
  }

  const { secrets } = settings()
  const workflows = existsSync('.github/workflows')
    ? (tryGit('ls-files', '--cached', '--others', '--exclude-standard', '.github/workflows') || '').trim().split('\n').filter((f) => f && existsSync(f))
    : []
  const list = (flag, target) => {
    try { return new Set(JSON.parse(gh('secret', 'list', flag, target, '--json', 'name')).map((s) => s.name)) } catch { return null }
  }
  const repoSecrets = list('-R', slug)
  // organization secrets this repository can use; unlike the organization
  // listing, it needs no admin:org and honours per-repository visibility
  const shared = () => {
    try {
      return new Set(JSON.parse(gh('api', `repos/${slug}/actions/organization-secrets`, '--paginate', '--slurp'))
        .flatMap((page) => page.secrets).map((s) => s.name))
    } catch { return null }
  }
  const orgSecrets = shared() ?? list('-o', owner)
  for (const [name, spec] of Object.entries(secrets)) {
    const used = workflows.filter((f) => readFileSync(f, 'utf8').includes(`secrets.${name}`))
    if (!used.length) fail(`secret ${name} is declared but no workflow passes it; reference \${{ secrets.${name} }} where it is needed`)
    if (repoSecrets?.has(name)) ok(`secret ${name} is set on ${slug}${used.length ? `, used by ${used.join(', ')}` : ''}`)
    else if (orgSecrets?.has(name)) ok(`secret ${name} is shared by organization ${owner}${used.length ? `, used by ${used.join(', ')}` : ''}`)
    else if (spec.optional) ok(`secret ${name} is not set: optional, its feature is off`)
    else if (orgSecrets === null) skip(`secret ${name} is not on ${slug}; organization secrets are not readable (gh auth refresh -s admin:org); if missing: ${secretGuide(name, t)}`)
    else fail(`secret ${name} is missing; ${secretGuide(name, t)}`)
  }
  const apple = APPLE.filter((n) => repoSecrets?.has(n) || orgSecrets?.has(n))
  if (apple.length && apple.length < APPLE.length) fail(`Developer ID signing is half set up: ${apple.join(', ')} present, ${APPLE.filter((n) => !apple.includes(n)).join(', ')} missing; cd refuses to build until all or none are set`)
  else ok(`release signing: ${apple.length ? 'Developer ID with notarization' : 'ad-hoc'}`)
  return report
}

// --- main --------------------------------------------------------------------

async function main(argv) {
  const [mode, ...rest] = argv
  const opts = args(rest)
  const exit = (errors, prefix) => {
    errors.forEach((e) => console.error(`${prefix}: ${e}`))
    process.exit(errors.length ? 1 : 0)
  }
  switch (mode) {
    case 'check': return exit(check(opts._[0], opts), 'release')
    case 'version': console.log(currentVersion()); return
    case 'render': return render(opts._[0], opts)
    case 'package': return pack(opts)
    case 'cask': return cask(opts)
    case 'tap': return tap(opts._[0], opts)
    case 'preflight': return exit(preflight(opts._[0]), 'preflight')
    case 'doctor': {
      const report = await doctor()
      for (const [status, msg] of report) console.log(`${status.padEnd(10)} ${msg}`)
      process.exit(report.some(([s]) => s === 'fail') ? 1 : 0)
      return
    }
    case 'site-env': {
      const site = expectedSite(settings().pages, repoSlug())
      if (!site) throw new Error('cannot resolve the Pages URL')
      console.log(`SITE_URL=${site}`)
      console.log(`BASE_PATH=${new URL(site).pathname.replace(/\/$/, '')}`)
      return
    }
    case 'pages': return exit(pagesCheck(opts._[0]), 'pages')
    case 'smoke': return exit(await smoke(opts._[0], Number(opts.retries ?? 20)), 'smoke')
    case 'signature': return exit(signature(opts._[0]), 'signature')
    default:
      console.error('usage: release.mjs check|version|render|package|cask|tap|preflight|doctor|pages|site-env|smoke|signature ...')
      process.exit(2)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (e) {
    console.error(`release: ${e.message}`)
    process.exit(1)
  }
}
