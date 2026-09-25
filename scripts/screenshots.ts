// Captures screenshots of the running app for visual review and as evidence.
//   npx tsx scripts/screenshots.ts [--base http://localhost:3000] [--out docs/screenshots]
//     [--as asha] [--theme light|dark|both] [--width 1440] path [path...]
// Paths are app paths such as / or /library?tab=team. Signs in through the real API.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = argv[i + 1] ?? fallback
  argv.splice(i, 2)
  return value
}
const base = opt('base', 'http://localhost:3000')
const out = opt('out', 'docs/screenshots')
const as = opt('as', 'asha')
const theme = opt('theme', 'light')
const width = Number(opt('width', '1440'))
const height = Number(opt('height', '960'))
const full = opt('full', 'yes') === 'yes'
const password = process.env.SEED_PASSWORD || 'flowpilot-demo'
const paths = argv.length ? argv : ['/']

mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const themes = theme === 'both' ? ['light', 'dark'] : [theme]

for (const t of themes) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: t as 'light' | 'dark', deviceScaleFactor: 1 })
  const page = await context.newPage()
  if (as !== 'none') {
    const res = await page.request.post(`${base}/api/auth/login`, {
      data: { email: `${as}@demo.local`, password },
      headers: { origin: base },
    })
    if (!res.ok()) throw new Error(`login as ${as} failed: ${res.status()} ${await res.text()}`)
  }
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const name = `${p.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home'}-${as}-${t}-${width}.png`
    await page.screenshot({ path: `${out}/${name}`, fullPage: full })
    console.log(`${out}/${name}`)
  }
  await context.close()
}
await browser.close()
