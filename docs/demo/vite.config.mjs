// Builds the real Susi frontend (../index.html and ../src) into public/demo/ for the landing page.
// The only addition is demo/shim.ts, which runs before src/main.ts and answers the Tauri IPC calls
// in the browser. Bare imports from ../src resolve to this project's node_modules, so `npm ci`
// inside docs/ is enough; keep the versions in package.json in step with the root package.json.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(docs, '..')
const shim = resolve(docs, 'demo/shim.ts')
const main = '<script type="module" src="/src/main.ts"></script>'

// Shared runtime dependencies must match the product, or the demo would show different behaviour.
const product = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).dependencies
const ours = JSON.parse(readFileSync(resolve(docs, 'package.json'), 'utf8')).devDependencies
const drift = Object.keys(product).filter(name => ours[name] !== product[name])
if (drift.length) {
  throw new Error(`docs/package.json devDependencies differ from the app's dependencies: ${drift.map(name => `${name} ${ours[name] ?? '(missing)'} ≠ ${product[name]}`).join(', ')}`)
}

export default defineConfig({
  root: repo,
  base: './',
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: resolve(docs, 'public/demo'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(repo, 'index.html') },
  },
  plugins: [{
    name: 'susi-demo',
    enforce: 'pre',
    transformIndexHtml: { order: 'pre', handler(html) {
      if (!html.includes(main)) throw new Error('index.html no longer loads /src/main.ts: update docs/demo/vite.config.mjs')
      return html
        .replace('<title>Susi</title>', '<title>Susi · interactive demo</title>\n  <meta name="robots" content="noindex">')
        .replace(main, `<script type="module" src="/docs/demo/shim.ts"></script>\n  ${main}`)
    } },
    // Resolve bare imports of the app's sources from docs/node_modules (the repository root may have none).
    async resolveId(source, importer) {
      if (!importer || /^[./\0]/.test(source) || source.startsWith('/') || importer.startsWith(docs)) return null
      return this.resolve(source, shim, { skipSelf: true })
    },
  }],
})
