import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checksumOf, declaredVersion, renderCask, tapAction } from './release.mjs'

const script = resolve('.github/scripts/release.mjs')
const template = readFileSync(resolve('.github/homebrew/sushi.rb'), 'utf8')
const SHA = 'a'.repeat(64)
// Fixtures run Git in disposable repositories only: drop the variables that
// select another repository or configuration, such as GIT_DIR exported to a
// hook, and ignore the system and global config, such as tag.gpgSign.
const isolated = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
}
const RELEASE = {
  versions: ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.lock', 'docs/release.mjs'],
  tap: { owner: 'octolab', name: 'homebrew-tap', cask: 'Casks/sushi.rb', template: '.github/homebrew/sushi.rb' },
}
const APPLE = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_PRIVATE_KEY']

function fixture(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'sushi-release-'))
  mkdirSync(join(cwd, '.github'))
  const settings = (pages = {}, release = RELEASE) => writeFileSync(join(cwd, '.github/settings.json'), JSON.stringify({ 'x-release': release, pages }))
  const blank = Object.fromEntries(['OCTOLAB_RELEASER_CLIENT_ID', 'OCTOLAB_RELEASER_KEY', ...APPLE].map((n) => [n, '']))
  let extra = {}
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8',
    env: { ...isolated, GITHUB_REPOSITORY: 'octopot/sushi', GITHUB_OUTPUT: '', ...blank, ...extra },
  })
  const withEnv = (env) => { extra = env }
  try { fn({ cwd, settings, run, withEnv }) } finally { rmSync(cwd, { recursive: true, force: true }) }
}

function versionFiles(cwd, v, lock = v) {
  mkdirSync(join(cwd, 'src-tauri'), { recursive: true })
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'sushi', version: v }))
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'Sushi', version: v }))
  writeFileSync(join(cwd, 'src-tauri/Cargo.toml'), `[package]\nname = "sushi"\nversion = "${v}"\n\n[dependencies]\nserde = { version = "1" }\n`)
  writeFileSync(join(cwd, 'src-tauri/Cargo.lock'), `[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "sushi"\nversion = "${lock}"\n`)
  siteVersion(cwd, v)
}

function siteVersion(cwd, v) {
  mkdirSync(join(cwd, 'docs'), { recursive: true })
  writeFileSync(join(cwd, 'docs/release.mjs'), `export const release = {\n  version: '${v}',\n  tag: 'v${v}',\n  archive: 'sushi_${v}_darwin-arm64.zip',\n}\n`)
}

test('every version file is read by its own rules', () => {
  const toml = '[package]\nname = "sushi"\nversion = "0.1.0"\n\n[dependencies]\ntauri = { version = "2" }\n'
  assert.equal(declaredVersion('src-tauri/Cargo.toml', toml), '0.1.0')
  assert.equal(declaredVersion('src-tauri/Cargo.toml', '[dependencies]\nversion = "9"\n'), null)
  const lock = '[[package]]\nname = "sushi-x"\nversion = "9.9.9"\n\n[[package]]\nname = "sushi"\nversion = "0.1.0"\n'
  assert.equal(declaredVersion('src-tauri/Cargo.lock', lock, () => toml), '0.1.0')
  assert.equal(declaredVersion('package.json', '{"version":"0.1.0"}'), '0.1.0')
  assert.equal(declaredVersion('src-tauri/tauri.conf.json', '{"productName":"Sushi"}'), null)
  const site = (v, tag = `v${v}`, archive = `sushi_${v}_darwin-arm64.zip`) =>
    `export const release = {\n  version: '${v}',\n  tag: '${tag}',\n  macos: '26',\n  archive: '${archive}',\n}\n`
  assert.equal(declaredVersion('docs/release.mjs', site('0.1.0')), '0.1.0')
  assert.equal(declaredVersion('docs/release.mjs', 'export const release = {}\n'), null)
  assert.throws(() => declaredVersion('docs/release.mjs', site('0.1.0', 'v0.0.9')), /tag is v0\.0\.9, not v0\.1\.0/)
  assert.throws(() => declaredVersion('docs/release.mjs', site('0.1.0', 'v0.1.0', 'sushi_0.0.9_darwin-arm64.zip')), /archive is sushi_0\.0\.9/)
})

test('version reports the one version the files agree on', () => fixture(({ cwd, settings, run }) => {
  settings()
  versionFiles(cwd, '0.1.0')
  assert.equal(run('version').stdout, '0.1.0\n')
  versionFiles(cwd, '0.1.0', '0.0.9')
  const result = run('version')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /version files disagree: .*src-tauri\/Cargo.lock=0.0.9/)
}))

test('the cask template renders for both signing modes and passes the placeholders through once', () => {
  const adhoc = renderCask(template, { version: '0.1.0', sha256: SHA })
  assert.match(adhoc, /^cask "sushi" do\n/)
  assert.match(adhoc, /version "0\.1\.0"/)
  assert.match(adhoc, new RegExp(`sha256 "${SHA}"`))
  assert.match(adhoc, /preflight_steps do\n {4}run "\/usr\/bin\/xattr", args: \["-dr", "com\.apple\.quarantine", "\{\{staged_path\}\}\/Sushi\.app"\]/)
  assert.match(adhoc, /depends_on arch: :arm64/)
  assert.match(adhoc, /uninstall quit: "me\.octopot\.sushi"/)
  assert.match(adhoc, /ollama pull qwen3\.5:4b-mlx/)
  assert.doesNotMatch(adhoc, /^#!|@[A-Z0-9_]+@/m)
  const signed = renderCask(template, { version: '0.1.0', sha256: SHA, signing: 'developer-id' })
  assert.doesNotMatch(signed, /xattr|quarantine|preflight/)
  assert.doesNotMatch(signed, /\n\n\n/)
  assert.throws(() => renderCask(template, { version: '0.1.0', sha256: 'abc' }), /sha256/)
  assert.throws(() => renderCask(template, { version: 'v0.1.0', sha256: SHA }), /version/)
  assert.throws(() => renderCask(template, { version: '0.1.0', sha256: SHA, signing: 'apple' }), /signing/)
  assert.throws(() => renderCask('#! adhoc:begin\nx\n', { version: '0.1.0', sha256: SHA }), /without/)
  assert.throws(() => renderCask('@OTHER@', { version: '0.1.0', sha256: SHA }), /unknown placeholder/)
})

test('cask renders from the template that settings.json names', () => fixture(({ cwd, settings, run }) => {
  settings()
  mkdirSync(join(cwd, '.github/homebrew'))
  copyFileSync(resolve('.github/homebrew/sushi.rb'), join(cwd, '.github/homebrew/sushi.rb'))
  const out = join(cwd, 'sushi.rb')
  const result = run('cask', '--version', '0.1.0', '--sha256', SHA, '--out', out)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(out, 'utf8'), renderCask(template, { version: '0.1.0', sha256: SHA }))
}))

test('checksums.txt lookups match the asset name exactly', () => {
  const text = `${'1'.repeat(64)}  sushi_0.1.0_darwin-arm64.zip\n${'2'.repeat(64)} *sushi_0.1.0_darwin-arm64.zip.sig\n`
  assert.equal(checksumOf(text, 'sushi_0.1.0_darwin-arm64.zip'), '1'.repeat(64))
  assert.equal(checksumOf(text, 'sushi_0.1.0_darwin-arm64.zip.sig'), '2'.repeat(64))
  assert.equal(checksumOf(text, 'sushi_0.2.0_darwin-arm64.zip'), null)
})

test('the tap is created, updated, left alone on a rerun and never downgraded', () => {
  const cask = (v, sha = SHA) => renderCask(template, { version: v, sha256: sha })
  assert.equal(tapAction(null, cask('0.1.0')).action, 'create')
  assert.equal(tapAction(cask('0.1.0'), cask('0.1.0')).action, 'skip')
  assert.equal(tapAction(cask('0.1.0'), cask('0.1.0', 'b'.repeat(64))).action, 'update')
  assert.equal(tapAction(cask('0.1.0'), cask('0.2.0')).action, 'update')
  assert.equal(tapAction(cask('0.10.0'), cask('0.9.1')).action, 'refuse')
})

test('tap commits through the contents API with no author, and only when the cask changes', () => fixture(({ cwd, settings, run, withEnv }) => {
  settings()
  mkdirSync(join(cwd, 'bin'))
  const current = join(cwd, 'current.rb')
  const put = join(cwd, 'put.json')
  // a stand-in for gh: GET answers from current.rb or 404s, PUT records its body
  writeFileSync(join(cwd, 'bin/gh'), `#!/bin/sh
case "$*" in
  *"-X PUT"*) cat > "${put}"; echo '{"commit":{"sha":"c0ffee","verification":{"verified":true}}}' ;;
  *) [ -f "${current}" ] || { echo 'gh: Not Found (HTTP 404)' >&2; exit 1; }
     printf '{"sha":"blob1","content":"%s"}' "$(base64 < "${current}" | tr -d '\\n')" ;;
esac
`)
  chmodSync(join(cwd, 'bin/gh'), 0o755)
  const next = join(cwd, 'sushi.rb')
  writeFileSync(next, renderCask(template, { version: '0.2.0', sha256: SHA }))
  withEnv({ PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, GH_TOKEN: '' })
  assert.match(run('tap', next).stderr, /GH_TOKEN is empty/)
  withEnv({ PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, GH_TOKEN: 'fixture' })

  const created = run('tap', next, '--version', '0.2.0')
  assert.equal(created.status, 0, created.stderr)
  assert.match(created.stdout, /created in c0ffee, verified: true/)
  const body = JSON.parse(readFileSync(put, 'utf8'))
  assert.deepEqual(Object.keys(body).sort(), ['content', 'message'])
  assert.equal(body.message, 'Brew cask update for sushi version v0.2.0')
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), readFileSync(next, 'utf8'))

  rmSync(put)
  writeFileSync(current, renderCask(template, { version: '0.1.0', sha256: SHA }))
  assert.equal(run('tap', next).status, 0)
  assert.equal(JSON.parse(readFileSync(put, 'utf8')).sha, 'blob1')

  rmSync(put)
  copyFileSync(next, current)
  const rerun = run('tap', next)
  assert.equal(rerun.status, 0, rerun.stderr)
  assert.match(rerun.stdout, /already has this cask/)
  assert.equal(existsSync(put), false)

  writeFileSync(current, renderCask(template, { version: '0.3.0', sha256: SHA }))
  const older = run('tap', next)
  assert.equal(older.status, 1)
  assert.match(older.stderr, /has 0\.3\.0, newer than 0\.2\.0/)
  assert.equal(existsSync(put), false)
}))

test('preflight needs the App on a stable tag only and Apple secrets all or none', () => fixture(({ cwd, settings, run, withEnv }) => {
  settings()
  const output = join(cwd, 'github-output')
  const read = () => { const t = readFileSync(output, 'utf8'); rmSync(output); return t }
  withEnv({ GITHUB_OUTPUT: output })
  const missing = run('preflight', 'v0.1.0')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /OCTOLAB_RELEASER_CLIENT_ID is empty/)
  assert.match(missing.stderr, /OCTOLAB_RELEASER_KEY is empty/)
  assert.equal(existsSync(output), false)

  const prerelease = run('preflight', 'v0.2.0-rc1')
  assert.equal(prerelease.status, 0, prerelease.stderr)
  assert.equal(read(), 'tap-owner=octolab\ntap-name=homebrew-tap\ncask=false\nsigning=adhoc\n')
  assert.equal(run('preflight').status, 0)
  assert.match(read(), /cask=false/)

  const app = { OCTOLAB_RELEASER_CLIENT_ID: 'Iv1.fixture', OCTOLAB_RELEASER_KEY: 'fixture' }
  withEnv({ GITHUB_OUTPUT: output, ...app })
  assert.equal(run('preflight', 'v0.1.0').status, 0)
  assert.equal(read(), 'tap-owner=octolab\ntap-name=homebrew-tap\ncask=true\nsigning=adhoc\n')

  withEnv({ GITHUB_OUTPUT: output, ...app, APPLE_CERTIFICATE: 'p12', APPLE_CERTIFICATE_PASSWORD: 'pw' })
  const half = run('preflight', 'v0.1.0')
  assert.equal(half.status, 1)
  assert.match(half.stderr, /APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_PRIVATE_KEY are empty/)

  withEnv({ GITHUB_OUTPUT: output, ...app, ...Object.fromEntries(APPLE.map((n) => [n, 'x'])) })
  assert.equal(run('preflight', 'v0.1.0').status, 0)
  assert.match(read(), /signing=developer-id/)
}))

test('Pages preview resolves default and custom domains and rejects drift', () => fixture(({ settings, run }) => {
  settings()
  assert.equal(run('pages', 'https://octopot.github.io/sushi/').status, 0)
  assert.equal(run('pages', 'https://octopot.github.io/indexit/').status, 1)
  assert.equal(run('site-env').stdout, 'SITE_URL=https://octopot.github.io/sushi/\nBASE_PATH=/sushi\n')
  settings({ cname: 'sushi.example.com' })
  assert.equal(run('pages', 'https://sushi.example.com').status, 0)
  assert.equal(run('pages', 'https://octopot.github.io/sushi/').status, 1)
  assert.equal(run('site-env').stdout, 'SITE_URL=https://sushi.example.com/\nBASE_PATH=\n')
}))

test('release notes render site links but preserve code examples', () => fixture(({ cwd, settings, run }) => {
  settings()
  mkdirSync(join(cwd, 'docs/content/changelog'), { recursive: true })
  const note = join(cwd, 'docs/content/changelog/v9.9.9.md')
  writeFileSync(note, '---\ntitle: Example release\ndescription: Test note.\n---\n\n# Example release\n\n[Guide](/guide/keys/)\n\n```md\n[Example](/keep-this/)\n```\n')
  const output = join(cwd, 'rendered.md')
  const result = run('render', 'v9.9.9', '--site-url', 'https://sushi.octolab.org/', '--out', output)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Example release\n')
  const text = readFileSync(output, 'utf8')
  assert.match(text, /https:\/\/sushi.octolab.org\/guide\/keys\//)
  assert.match(text, /\[Example\]\(\/keep-this\/\)/)
  assert.doesNotMatch(text, /# Example release|description:/)
  writeFileSync(note, '---\ntitle: Example release\ndescription: Test.\n---\n\n# Wrong title\n')
  assert.equal(run('render', 'v9.9.9', '--site-url', 'https://example.com', '--out', output).status, 1)
}))

// A local site stands in for Pages: smoke must not reach the network, so no
// repository is set and the default-domain redirect check is skipped.
test('smoke checks pages and assets, and an og:image only when declared', async () => {
  let og = ''
  const server = createServer((req, res) => {
    const html = (status, body) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end(body) }
    if (req.url === '/') return html(200, `<link href="/_next/static/a.css"><script src="/_next/static/b.js"></script>${og}`)
    if (req.url.startsWith('/_next/static/')) { res.writeHead(200); return res.end() }
    if (req.url === '/changelog/') return html(200, 'changelog')
    html(404, '<script src="/_next/static/b.js"></script>')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const site = `http://127.0.0.1:${server.address().port}/`
  const cwd = mkdtempSync(join(tmpdir(), 'sushi-smoke-'))
  const smoke = () => new Promise((done) => {
    const child = spawn(process.execPath, [script, 'smoke', site, '--retries', '0'], {
      cwd, env: { ...isolated, GITHUB_REPOSITORY: '' },
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => done({ status, stderr }))
  })
  try {
    const plain = await smoke()
    assert.equal(plain.status, 0, plain.stderr)
    og = `<meta property="og:image" content="${site}og.png"/>`
    const broken = await smoke()
    assert.equal(broken.status, 1)
    assert.match(broken.stderr, /og\.png: HTTP 404, want an image/)
  } finally {
    server.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('missing release tags fail without creating Git refs', () => fixture(({ run }) => {
  const result = run('check', 'v9.9.9')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /tag not found/)
}))

// All Git objects and refs below belong to disposable fixtures, never this checkout.
function releaseFixture(fn) {
  fixture(({ cwd, settings, run }) => {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd, env: isolated, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git('init', '--initial-branch=main')
    git('config', 'user.name', 'Release tests')
    git('config', 'user.email', 'tests@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    git('config', 'core.hooksPath', '/dev/null')
    settings()
    versionFiles(cwd, '9.9.9')
    git('add', '.')
    git('commit', '-m', 'Base fixture')
    const base = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', base)
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    const note = 'docs/content/changelog/v9.9.9.md'
    mkdirSync(join(cwd, 'docs/content/changelog'), { recursive: true })
    writeFileSync(join(cwd, note), '---\ntitle: Release fixture\ndescription: Fixture.\n---\n\n# Release fixture\n')
    git('add', note)
    git('commit', '-m', 'Release fixture')
    const sha = git('rev-parse', 'HEAD')
    git('tag', '-a', 'v9.9.9', '-m', 'Annotated release fixture')
    fn({ cwd, git, run, note, base, sha })
  })
}

test('local release preparation precedes the branch push; CI still requires the remote branch', () => releaseFixture(({ git, run, sha, note, cwd }) => {
  assert.equal(run('check', 'v9.9.9', '--local').status, 0)
  assert.match(run('check', 'v9.9.9').stderr, /its commit is not on main/)
  assert.equal(run('check', 'v9.9.9', '--pushed', `main=${sha}`).status, 0)
  assert.equal(run('check', 'v9.9.9', '--pushed', `unrelated=${sha}`).status, 1)
  git('update-ref', 'refs/remotes/origin/main', sha)
  assert.equal(run('check', 'v9.9.9').status, 0)
  writeFileSync(join(cwd, note), 'Uncommitted release note')
  assert.match(run('check', 'v9.9.9', '--local').stderr, /has changes not in v9.9.9/)
}))

test('a release tag requires its version in every version file of its commit', () => releaseFixture(({ cwd, git, run }) => {
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '9.9.8' }))
  git('commit', '-am', 'Stale tauri.conf.json')
  git('tag', '-f', '-a', 'v9.9.9', '-m', 'Annotated release fixture')
  const result = run('check', 'v9.9.9', '--local')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /src-tauri\/tauri\.conf\.json: version is 9\.9\.8, not 9\.9\.9 in v9\.9\.9/)
  assert.equal(result.stderr.trim().split('\n').length, 1)
  // the working tree does not count: only the tagged commit does
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '9.9.9' }))
  assert.equal(run('check', 'v9.9.9', '--local').status, 1)
}))

test('a release tag requires the site to name the same version', () => releaseFixture(({ cwd, git, run }) => {
  siteVersion(cwd, '9.9.8')
  git('commit', '-am', 'Site still on 9.9.8')
  git('tag', '-f', '-a', 'v9.9.9', '-m', 'Annotated release fixture')
  const result = run('check', 'v9.9.9', '--local')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /docs\/release\.mjs: version is 9\.9\.8, not 9\.9\.9 in v9\.9\.9/)
  writeFileSync(join(cwd, 'docs/release.mjs'), `export const release = {\n  version: '9.9.9',\n  tag: 'v9.9.8',\n  archive: 'sushi_9.9.9_darwin-arm64.zip',\n}\n`)
  git('commit', '-am', 'Site tag left behind')
  git('tag', '-f', '-a', 'v9.9.9', '-m', 'Annotated release fixture')
  assert.match(run('check', 'v9.9.9', '--local').stderr, /docs\/release\.mjs: tag is v9\.9\.8, not v9\.9\.9 for version 9\.9\.9.* in v9\.9\.9/)
  assert.match(run('version').stderr, /docs\/release\.mjs: tag is v9\.9\.8/)
}))

test('pre-push checks annotated tags and destination branches, deletions and tag-only pushes', () => releaseFixture(({ cwd, git, sha, base }) => {
  mkdirSync(join(cwd, '.github/scripts'))
  copyFileSync(script, join(cwd, '.github/scripts/release.mjs'))
  mkdirSync(join(cwd, 'test-bin'))
  const makeLog = join(cwd, 'make.log')
  writeFileSync(join(cwd, 'test-bin/make'), '#!/bin/sh\nprintf "%s\n" "$*" >> "$MAKE_LOG"\n')
  chmodSync(join(cwd, 'test-bin/make'), 0o755)
  const hook = resolve('.github/hooks/pre-push')
  const push = (input) => {
    rmSync(makeLog, { force: true })
    return spawnSync('/bin/bash', [hook, 'origin', 'unused'], {
      cwd, input, encoding: 'utf8',
      env: { ...isolated, DEFAULT_BRANCH: 'main', MAKE_LOG: makeLog, PATH: `${join(cwd, 'test-bin')}:${process.env.PATH}` },
    })
  }
  const zero = '0'.repeat(40)
  const tag = `refs/tags/v9.9.9 ${git('rev-parse', 'v9.9.9')} refs/tags/v9.9.9 ${zero}\n`
  // A tag alone cannot introduce a commit absent from the remote branch.
  assert.equal(push(tag).status, 1)
  assert.equal(push(`refs/heads/release ${sha} refs/heads/main ${base}\n${tag}`).status, 0)
  assert.equal(readFileSync(makeLog, 'utf8').trim(), 'verify')
  assert.equal(push(`refs/heads/main ${sha} refs/heads/unrelated ${base}\n${tag}`).status, 1)
  assert.equal(push(`(delete) ${zero} refs/tags/v9.9.9 ${sha}\n`).status, 0)
  assert.equal(readFileSync(makeLog, 'utf8').trim(), 'verify')
  git('update-ref', 'refs/remotes/origin/main', sha)
  assert.equal(push(tag).status, 0)
  assert.equal(readFileSync(makeLog, 'utf8').trim(), 'verify')
}))

test('hooks are wired in place through the local core.hooksPath and leave shared hooks alone', () => releaseFixture(({ cwd, git }) => {
  mkdirSync(join(cwd, '.github/hooks'), { recursive: true })
  mkdirSync(join(cwd, 'shared-hooks'))
  for (const name of ['pre-commit', 'pre-push', 'post-merge']) {
    copyFileSync(resolve('.github/hooks', name), join(cwd, '.github/hooks', name))
    writeFileSync(join(cwd, 'shared-hooks', name), 'shared hook: keep me')
  }
  const globalConfig = join(cwd, 'global.gitconfig')
  writeFileSync(globalConfig, `[core]\n\thooksPath = ${join(cwd, 'shared-hooks')}\n`)
  git('config', '--local', '--unset', 'core.hooksPath')
  const env = { ...isolated, GIT_CONFIG_GLOBAL: globalConfig }
  const make = (target) => spawnSync('make', ['-f', resolve('Makefile'), target], { cwd, env, encoding: 'utf8' })
  const hooksPath = () => spawnSync('git', ['config', 'core.hooksPath'], { cwd, env, encoding: 'utf8' }).stdout.trim()
  assert.equal(hooksPath(), join(cwd, 'shared-hooks'))
  const installed = make('git-hooks')
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(hooksPath(), '.github/hooks')
  assert.equal(make('git-unhook').status, 0)
  assert.equal(hooksPath(), join(cwd, 'shared-hooks'))
  assert.equal(make('git-unhook').status, 0)
  assert.match(readFileSync(globalConfig, 'utf8'), /shared-hooks/)
  for (const name of ['pre-commit', 'pre-push', 'post-merge']) {
    assert.equal(readFileSync(join(cwd, 'shared-hooks', name), 'utf8'), 'shared hook: keep me')
  }
}))

test('fixtures ignore the Git repository and config the caller selects', () => {
  const victim = mkdtempSync(join(tmpdir(), 'sushi-victim-'))
  try {
    const git = (...args) => spawnSync('git', ['-C', victim, ...args], { env: isolated, encoding: 'utf8' }).stdout
    git('init', '-q')
    const config = git('config', '--local', '--list')
    // a nested run of one fixture test, as if a hook ran the suite; without
    // NODE_TEST_CONTEXT it reports to stdout instead of to this runner
    const { NODE_TEST_CONTEXT, ...caller } = process.env
    const inner = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^local release preparation', fileURLToPath(import.meta.url)], {
      encoding: 'utf8', env: { ...caller, GIT_DIR: join(victim, '.git') },
    })
    assert.equal(inner.status, 0, inner.stdout + inner.stderr)
    assert.match(inner.stdout, /^# pass 1$/m)
    assert.equal(git('config', '--local', '--list'), config)
    assert.equal(git('for-each-ref'), '')
  } finally {
    rmSync(victim, { recursive: true, force: true })
  }
})
