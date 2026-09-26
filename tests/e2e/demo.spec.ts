import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The full demo in a real browser:
// describe → review → save → run → share → a second person runs it on their own
// file → makes a copy → the copy runs independently, and the original is unchanged.
// "Generate steps" talks to tests/e2e/mock-model.ts, never a real provider.

const SHOTS = 'docs/screenshots'
mkdirSync(SHOTS, { recursive: true })
const REQUEST = 'Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000.'

test.describe.configure({ mode: 'serial' })

let recipePath = ''

/** Full page loads are server-rendered first; interact only once React has hydrated. */
async function open(page: Page, path: string) {
  await page.goto(path)
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
}

async function signIn(page: Page, name: 'Asha' | 'Vikram' | 'Meera' | 'Olivia') {
  await open(page, '/login')
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Welcome back, ${name}`) })).toBeVisible()
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}

async function runOn(page: Page, file: string) {
  await page.locator('#run-file').setInputFiles(file)
  await expect(page.getByText('Header check')).toBeVisible()
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByText('Rows through each step')).toBeVisible()
}

function resultTable(page: Page) {
  return page.getByRole('table', { name: /Result of run/ })
}

async function expectRows(page: Page, rows: string[][]) {
  const table = resultTable(page)
  await expect(table.locator('tbody tr')).toHaveCount(rows.length)
  for (const [i, row] of rows.entries()) {
    await expect(table.locator('tbody tr').nth(i)).toHaveText(new RegExp(row.join('.*')))
  }
}

test('Asha describes, reviews, saves, runs and shares the recipe', async ({ page }) => {
  await signIn(page, 'Asha')
  await page.getByRole('link', { name: 'New recipe' }).first().click()
  await page.getByLabel('Title', { exact: true }).fill('Regional revenue exceptions')
  await page.getByLabel('Description', { exact: true }).fill('Paid orders totalled by region; flags regions below a threshold.')
  await page.getByRole('button', { name: 'Use sales_A.csv' }).click()
  await expect(page.getByRole('checkbox', { name: 'Require column order_id' })).not.toBeChecked()

  await page.getByLabel('Describe the report').fill(REQUEST)
  await page.getByRole('button', { name: 'Generate steps' }).click()
  await expect(page.getByText('Draft ready for review')).toBeVisible()
  await expect(page.getByText('AI draft — review before saving')).toBeVisible()
  await expect(page.getByLabel(/^Step \d+ type$/)).toHaveCount(3)
  await expect(page.getByText('Ready to save')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01-editor-ai-draft.png`, fullPage: true })

  await page.getByRole('button', { name: 'Save recipe' }).click()
  await page.waitForURL(/\/w\/wf_[0-9a-f]+$/)
  recipePath = new URL(page.url()).pathname
  await expect(page.getByRole('heading', { name: 'Regional revenue exceptions' })).toBeVisible()
  await expect(page.getByText('Private', { exact: true })).toBeVisible()

  await runOn(page, 'fixtures/sales_A.csv')
  await expectRows(page, [
    ['South', '₹40,000'],
    ['West', '₹70,000'],
  ])
  await expect(page.getByText('grouped by region', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/02-asha-runs-file-A.png`, fullPage: true })

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Team/ }).click()
  await expect(dialog.getByText(/\?v=ver_/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/03-share-dialog.png` })
  await dialog.getByRole('button', { name: 'Share with Sales' }).click()
  await expect(page.getByText('Shared with Sales').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await signOut(page)
})

test('Vikram reruns it on his own file, adjusts the threshold, then makes a copy grouped by rep', async ({ page }) => {
  await signIn(page, 'Vikram')
  await page.getByRole('link', { name: 'Recipe library' }).click()
  await page.getByRole('tab', { name: /Team library/ }).click()
  await page.getByRole('link', { name: 'Regional revenue exceptions' }).click()
  await expect(page.getByRole('heading', { name: 'Regional revenue exceptions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)

  await runOn(page, 'fixtures/sales_B.csv')
  await expectRows(page, [
    ['North', '₹70,000'],
    ['West', '₹20,000'],
  ])

  await page.getByLabel('threshold').fill('50000')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByText(/threshold\s*=\s*₹50,000/)).toBeVisible()
  await expectRows(page, [['West', '₹20,000']])
  await page.screenshot({ path: `${SHOTS}/04-vikram-threshold-50000.png`, fullPage: true })
  await page.getByRole('button', { name: /Reset to ₹1,00,000/ }).click()
  await expect(page.getByLabel('threshold')).toHaveValue('100000')

  await page.getByRole('button', { name: 'Make a copy' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title of your copy').fill('Rep revenue exceptions')
  await dialog.getByRole('button', { name: 'Make a copy' }).click()
  await page.waitForURL(/\/w\/wf_[0-9a-f]+\/edit$/)
  await page.getByLabel('Group by', { exact: true }).selectOption('sales_rep')
  await page.getByRole('button', { name: 'Save as version 2' }).click()
  await page.waitForURL(/\/w\/wf_[0-9a-f]+$/)
  expect(new URL(page.url()).pathname).not.toBe(recipePath)
  await expect(page.getByText('Total amount by sales_rep as total')).toBeVisible()
  await expect(page.getByText(/Copied from Asha Rao/)).toBeVisible()

  await runOn(page, 'fixtures/sales_B.csv')
  await expectRows(page, [['Asha', '₹90,000']])
  await page.screenshot({ path: `${SHOTS}/05-vikram-copy-by-rep.png`, fullPage: true })
  await signOut(page)
})

test("Asha's original is unchanged and she is told a copy was made", async ({ page }) => {
  await signIn(page, 'Asha')
  await expect(page.getByText('Vikram Nair made a private copy of your Regional revenue exceptions v1')).toBeVisible()
  await expect(page.getByText('Rep revenue exceptions')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/06-asha-dashboard.png`, fullPage: true })

  await open(page, recipePath)
  await expect(page.getByText('Total amount by region as total')).toBeVisible()
  await expect(page.getByRole('combobox').filter({ hasText: 'v1 (latest)' })).toBeVisible()
  await expect(page.getByText('1 copy made')).toBeVisible()
  await signOut(page)
})

test('Meera can run but not copy, and Olivia cannot see the recipe at all', async ({ page }) => {
  await signIn(page, 'Meera')
  await open(page, recipePath)
  await expect(page.getByRole('button', { name: 'Make a copy' })).toBeDisabled()
  await runOn(page, 'fixtures/sales_A.csv')
  await expectRows(page, [
    ['South', '₹40,000'],
    ['West', '₹70,000'],
  ])
  await signOut(page)

  await signIn(page, 'Olivia')
  await open(page, recipePath)
  await expect(page.getByText('Nothing here')).toBeVisible()
  await expect(page.getByText('Regional revenue exceptions')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/07-olivia-404.png` })
})
