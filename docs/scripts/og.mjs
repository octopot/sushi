// Renders scripts/og.html to public/og.png (1733×908) with headless Chrome.
// playwright-core comes from the app's own dev dependencies: run `npm ci` in the repository root first.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright-core')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1733, height: 908 }, deviceScaleFactor: 1 })
await page.goto(new URL('og.html', import.meta.url).href)
await page.waitForLoadState('networkidle')
await page.screenshot({ path: fileURLToPath(new URL('../public/og.png', import.meta.url)) })
await browser.close()
