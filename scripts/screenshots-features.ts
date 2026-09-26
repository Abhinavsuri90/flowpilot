// Screenshots of the newer features, with the clicks they need (the plain
// screenshots script only visits paths). Evidence for the README and for a
// visual check. Needs a running dev server with the demo seed.
//   npx tsx scripts/screenshots-features.ts [--base http://localhost:3000] [--out docs/screenshots]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (argv[i + 1] ?? fallback)
}
const base = opt('base', 'http://localhost:3000')
const out = opt('out', 'docs/screenshots')
const password = process.env.SEED_PASSWORD || 'flowpilot-demo'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const settle = async () => {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
  await page.waitForLoadState('networkidle')
}
const shot = async (name: string, fullPage = false) => {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage })
  console.log(`saved ${out}/${name}.png`)
}
const signIn = async (who: string) => {
  const res = await page.request.post(`${base}/api/auth/login`, { data: { email: `${who}@demo.local`, password }, headers: { origin: base } })
  if (!res.ok()) throw new Error(`login as ${who} failed: ${res.status()}`)
}

// 11. The landing page, signed out.
await page.goto(`${base}/welcome`)
await settle()
await shot('11-landing', true)

// 12. Templates on New recipe.
await signIn('asha')
await page.goto(`${base}/workflows/new`)
await settle()
await shot('12-templates')

// 13. A date filter in the editor, relative to the run day.
await page.goto(`${base}/workflows/new?template=refunds_last_quarter`)
await settle()
await page.getByText(/Started from/).waitFor()
await page.getByRole('button', { name: 'Hide templates' }).click()
await page.evaluate(() => window.scrollTo(0, 560))
await shot('13-date-filter-editor')

// 14. The monthly example run as of a day, shown as a chart.
await context.clearCookies()
await signIn('vikram')
const found = await (await page.request.get(`${base}/api/workflows?scope=mine&q=Monthly`)).json()
await page.goto(`${base}/w/${found.items[0].id}`)
await settle()
await page.locator('#run-file').setInputFiles('fixtures/orders_dated.csv')
await page.getByText('Header check').waitFor()
await page.getByLabel('As of').fill('2026-09-27')
await page.getByRole('button', { name: 'Run recipe' }).click()
await page.getByRole('table', { name: /Result of run/ }).waitFor()
await page.getByRole('button', { name: 'Chart' }).click()
await page.getByRole('list', { name: /per row/ }).waitFor()
await page.getByRole('list', { name: /per row/ }).scrollIntoViewIfNeeded()
await page.evaluate(() => window.scrollBy(0, -120))
await shot('14-monthly-revenue-chart')

// 15. An Excel workbook with two sheets in the run panel (a recipe the workbook's columns fit).
const byRep = await (await page.request.get(`${base}/api/workflows?scope=mine&q=Paid%20revenue%20by%20sales%20rep`)).json()
await page.goto(`${base}/w/${byRep.items[0].id}`)
await settle()
await page.locator('#run-file').setInputFiles('fixtures/sales_two_sheets.xlsx')
await page.getByLabel('Sheet', { exact: true }).waitFor()
await page.getByLabel('Sheet', { exact: true }).selectOption('Orders')
await page.getByText('Header check').waitFor()
await shot('15-excel-upload')

// 16. API tokens on the account page (a registered account; demo accounts can't mint).
await context.clearCookies()
const stamp = Date.now().toString(36)
const reg = await page.request.post(`${base}/api/auth/register`, {
  data: { name: 'Priya Menon', email: `priya.${stamp}@example.com`, password: `screenshot passphrase ${stamp}`, workspaceName: 'Finance Ops' },
  headers: { origin: base },
})
if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`)
await page.goto(`${base}/account`)
await settle()
await page.getByRole('button', { name: 'New token' }).click()
await page.locator('#new-token-name').fill('nightly-sales-report')
await page.getByRole('button', { name: 'Create token' }).click()
await page.getByLabel('Token', { exact: true }).waitFor()
await shot('16-api-token')

await browser.close()
