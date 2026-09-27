// Screenshots of the newer features, with the clicks they need (the plain
// screenshots script only visits paths). Evidence for the README and for a
// visual check. Needs a running dev server with the demo seed.
//   npx tsx scripts/screenshots-features.ts [--base http://localhost:3000] [--out docs/screenshots] [--only 17,18]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { REGIONAL_REVENUE_EXCEPTIONS } from '../src/lib/workflow/examples'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (argv[i + 1] ?? fallback)
}
const base = opt('base', 'http://localhost:3000')
const out = opt('out', 'docs/screenshots')
const password = process.env.SEED_PASSWORD || 'flowpilot-demo'
// --only takes shots by number (and "og"); each block signs in for itself, so any subset works.
const only = opt('only', '').split(',').filter(Boolean)
const want = (key: string) => only.length === 0 || only.includes(key)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
// Reduced motion: the app then skips entrance animations, so no shot catches a dialog mid-fade.
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
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

// 0. The social preview image (1200×630) for link cards.
if (want('og')) {
  const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  const ogPage = await og.newPage()
  await ogPage.goto(`${base}/welcome`)
  await ogPage.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
  await ogPage.waitForLoadState('networkidle')
  await ogPage.screenshot({ path: 'public/og.png' })
  console.log('saved public/og.png')
  await og.close()
}

// 11. The landing page, signed out.
if (want('11')) {
  await context.clearCookies()
  await page.goto(`${base}/welcome`)
  await settle()
  await shot('11-landing', true)
}

// 12. Templates on New recipe.
if (want('12')) {
  await context.clearCookies()
  await signIn('asha')
  await page.goto(`${base}/workflows/new`)
  await settle()
  await shot('12-templates')
}

// 13. A date filter in the editor, relative to the run day.
if (want('13')) {
  await context.clearCookies()
  await signIn('asha')
  await page.goto(`${base}/workflows/new?template=refunds_last_quarter`)
  await settle()
  await page.getByText(/Started from/).waitFor()
  await page.getByRole('button', { name: 'Hide templates' }).click()
  await page.evaluate(() => window.scrollTo(0, 560))
  await shot('13-date-filter-editor')
}

// 14. The monthly example run as of a day, shown as a chart.
if (want('14')) {
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
}

// 15. An Excel workbook with two sheets in the run panel (a recipe the workbook's columns fit).
if (want('15')) {
  await context.clearCookies()
  await signIn('vikram')
  const byRep = await (await page.request.get(`${base}/api/workflows?scope=mine&q=Paid%20revenue%20by%20sales%20rep`)).json()
  await page.goto(`${base}/w/${byRep.items[0].id}`)
  await settle()
  await page.locator('#run-file').setInputFiles('fixtures/sales_two_sheets.xlsx')
  await page.getByLabel('Sheet', { exact: true }).waitFor()
  await page.getByLabel('Sheet', { exact: true }).selectOption('Orders')
  await page.getByText('Header check').waitFor()
  await shot('15-excel-upload')
}

/** A fresh account of its own (demo accounts can't mint tokens or turn on two-step sign-in). */
const registerAccount = async (name: string, workspaceName: string) => {
  await context.clearCookies()
  const stamp = Date.now().toString(36)
  const reg = await page.request.post(`${base}/api/auth/register`, {
    data: { name, email: `${name.split(' ')[0]!.toLowerCase()}.${stamp}@example.com`, password: `screenshot passphrase ${stamp}`, workspaceName, timeZone: 'Asia/Kolkata' },
    headers: { origin: base },
  })
  if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`)
}

// 16. API tokens on the account page.
if (want('16')) {
  await registerAccount('Priya Menon', 'Finance Ops')
  await page.goto(`${base}/account`)
  await settle()
  await page.getByRole('button', { name: 'New token' }).click()
  await page.locator('#new-token-name').fill('nightly-sales-report')
  await page.getByRole('button', { name: 'Create token' }).click()
  await page.getByLabel('Token', { exact: true }).waitFor()
  await shot('16-api-token')
}

// 17. Turning on two-step sign-in: the QR code and the key for the authenticator app.
if (want('17')) {
  await registerAccount('Kabir Shah', 'Finance Ops')
  await page.goto(`${base}/account`)
  await settle()
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByRole('dialog').getByRole('img', { name: /QR code/ }).waitFor()
  await shot('17-two-step-sign-in')
}

// 18. A rerun on next week's file: what changed since the previous run, row by row.
if (want('18')) {
  await context.clearCookies()
  await signIn('asha')
  const created = await page.request.post(`${base}/api/workflows`, {
    data: { title: 'Regional revenue exceptions', description: 'Paid orders by region below a threshold.', definition: REGIONAL_REVENUE_EXCEPTIONS },
    headers: { origin: base },
  })
  if (!created.ok()) throw new Error(`create failed: ${created.status()}`)
  const { workflow } = await created.json()
  await page.goto(`${base}/w/${workflow.id}`)
  await settle()
  for (const [i, file] of ['fixtures/sales_A.csv', 'fixtures/sales_B.csv'].entries()) {
    if (i > 0) await page.getByRole('button', { name: /^Remove / }).click()
    await page.locator('#run-file').setInputFiles(file)
    await page.getByText('Header check').waitFor()
    await page.getByRole('button', { name: 'Run recipe' }).click()
    await page.getByRole('table', { name: /Result of run/ }).waitFor()
  }
  const changes = page.getByRole('region', { name: 'Changes between runs' })
  await changes.getByRole('button', { name: /Show the changes/ }).click()
  await changes.getByRole('table').waitFor()
  // The comparison's last row just above the bottom edge, with the result above it.
  await changes.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await page.evaluate(() => window.scrollBy(0, 24))
  await shot('18-run-comparison')
}

await browser.close()
