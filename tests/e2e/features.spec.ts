import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../../src/lib/workflow/examples'

// Every feature outside the happy path, in a real browser. Each test creates the
// data it needs through the API, so tests don't depend on each other.

const F = 'fixtures/'

async function open(page: Page, path: string) {
  await page.goto(path)
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
}

async function signIn(page: Page, name: 'Asha' | 'Vikram' | 'Meera') {
  await page.context().clearCookies()
  await open(page, '/login')
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Welcome back, ${name}`) })).toBeVisible()
}

/** Creates a recipe as the signed-in user and returns its id and first version id. */
async function createRecipe(page: Page, title: string, definition: unknown = ORIGINAL) {
  const origin = new URL(page.url()).origin
  const res = await page.request.post('/api/workflows', { headers: { origin }, data: { title, definition } })
  expect(res.status()).toBe(201)
  const body = await res.json()
  return { id: body.workflow.id as string, versionId: body.version.id as string }
}

async function runFile(page: Page, file: string) {
  await page.locator('#run-file').setInputFiles(file)
  await expect(page.getByText('Header check')).toBeVisible()
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()))
})

test('editor warns when a text value never occurs in the sample, and fixes the casing in one click', async ({ page }) => {
  await signIn(page, 'Asha')
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: 'Use sales_A.csv' }).click()
  await page.getByRole('button', { name: 'Add filter' }).click()
  await page.getByLabel('Column', { exact: true }).selectOption('status')
  await page.getByLabel('Value', { exact: true }).fill('Paid')
  await expect(page.getByText('In your sample file, status is "paid" in the data, not "Paid"')).toBeVisible()
  await page.getByRole('button', { name: 'Use “paid”' }).click()
  await expect(page.getByLabel('Value', { exact: true })).toHaveValue('paid')
  await expect(page.getByText(/In your sample file/)).toHaveCount(0)
  await page.getByLabel('Value', { exact: true }).fill('pending')
  await expect(page.getByText('No row has status = "pending". The data has "paid", "refunded", "cancelled".')).toBeVisible()
})

test('AI: an invalid draft loads with its problems pinned; an ambiguous request asks a question', async ({ page }) => {
  await signIn(page, 'Asha')
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: 'Use sales_A.csv' }).click()
  await page.getByLabel('Describe the report').fill('Please make a broken draft for paid orders by region.')
  await page.getByRole('button', { name: 'Generate steps' }).click()
  await expect(page.getByText('The draft needs fixing')).toBeVisible()
  await expect(page.getByText(/Column "sales_rep" is no longer available: step s2 grouped the rows/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save recipe' })).toBeDisabled()

  await page.getByLabel('Describe the report').fill('Total the amount for each rep please.')
  await page.getByRole('button', { name: /Regenerate steps|Generate steps/ }).click()
  await expect(page.getByText('One question first')).toBeVisible()
  await expect(page.getByText('Which column should the totals be grouped by?')).toBeVisible()
})

test('Advanced JSON rejects an invalid recipe and applies a valid one', async ({ page }) => {
  await signIn(page, 'Asha')
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: /Advanced: view or paste JSON/ }).click()
  const bad = { ...ORIGINAL, steps: [{ id: 's1', type: 'sql', query: 'DROP TABLE runs' }] }
  await page.getByLabel('Definition JSON').fill(JSON.stringify(bad))
  await page.getByRole('button', { name: 'Apply to editor' }).click()
  await expect(page.getByText('Unsupported step type "sql". Only filter and group_sum are allowed.')).toBeVisible()
  await page.getByLabel('Definition JSON').fill(JSON.stringify(ORIGINAL))
  await page.getByRole('button', { name: 'Apply to editor' }).click()
  await expect(page.getByText('JSON applied')).toBeVisible()
  await expect(page.getByLabel(/^Step \d+ type$/)).toHaveCount(3)
})

test('run panel checks the file in the browser, offers samples, and validates parameters', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id } = await createRecipe(page, 'QA run checks')
  await open(page, `/w/${id}`)

  await runFile(page, F + 'invalid/bad_amounts.csv')
  await expect(page.getByText(/The file has 5 problems\. Fix these lines/)).toBeVisible()
  await expect(page.getByText('Line 6, amount: "60,000" contains separators; write it as 60000')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()

  await page.getByRole('button', { name: /Remove bad_amounts.csv/ }).click()
  await runFile(page, F + 'invalid/missing_amount.csv')
  await expect(page.getByText('Missing required column: amount')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()

  await page.getByRole('button', { name: /Remove missing_amount.csv/ }).click()
  await page.getByRole('button', { name: 'sales_B.csv' }).click()
  await expect(page.getByText('Header check')).toBeVisible()
  await page.getByLabel('threshold').fill('12,000')
  await expect(page.getByText('Whole rupees only (digits, no commas)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()
  await page.getByLabel('threshold').fill('100000')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByRole('table', { name: /Result of run/ }).locator('tbody tr')).toHaveCount(2)
})

test('a details-only edit saves without a new version; a step change saves v2 and v1 shows a banner', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id, versionId } = await createRecipe(page, 'QA versions')
  await open(page, `/w/${id}/edit`)
  await page.getByLabel('Title', { exact: true }).fill('QA versions (renamed)')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Details saved')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'QA versions (renamed)' })).toBeVisible()
  await expect(page.getByRole('combobox').first().locator('option')).toHaveCount(1)

  await open(page, `/w/${id}/edit`)
  await page.getByLabel('Default', { exact: true }).fill('80000')
  await page.getByRole('button', { name: 'Save as version 2' }).click()
  await expect(page.getByText('Saved version 2')).toBeVisible()
  await open(page, `/w/${id}?v=${versionId}`)
  await expect(page.getByText("You're viewing version 1 (latest is 2)")).toBeVisible()
  await expect(page.getByText('default ₹1,00,000')).toBeVisible()
})

test('a run from another recipe is not shown as this recipe’s result', async ({ page }) => {
  await signIn(page, 'Asha')
  const a = await createRecipe(page, 'QA recipe A')
  const b = await createRecipe(page, 'QA recipe B')
  await open(page, `/w/${a.id}`)
  await runFile(page, F + 'sales_A.csv')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await page.waitForURL(/run=run_/)
  const runId = new URL(page.url()).searchParams.get('run')
  await open(page, `/w/${b.id}?run=${runId}`)
  await expect(page.getByText('That result belongs to another recipe')).toBeVisible()
  await page.getByRole('link', { name: 'QA recipe A' }).click()
  await expect(page.getByRole('table', { name: /Result of run/ })).toBeVisible()
})

test('large results page in the browser, and the CSV download escapes formulas', async ({ page }) => {
  await signIn(page, 'Asha')
  const keepAll = {
    schemaVersion: 1,
    input: { format: 'csv', columns: { region: 'string', status: 'string', amount: 'integer_inr' } },
    parameters: {},
    steps: [{ id: 's1', type: 'filter', column: 'status', operator: 'neq', value: { literal: 'void' } }],
    output: { format: 'table' },
  }
  const { id } = await createRecipe(page, 'QA big table', keepAll)
  await open(page, `/w/${id}`)
  const rows = Array.from({ length: 150 }, (_, i) => `r${i},paid,${i}`).join('\n')
  await page.locator('#run-file').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(`region,status,amount\n${rows}\n`) })
  await page.getByRole('button', { name: 'Run recipe' }).click()
  const table = page.getByRole('table', { name: /Result of run/ })
  await expect(table.locator('tbody tr')).toHaveCount(100)
  await expect(page.getByText('Showing 100 of 150 rows.')).toBeVisible()
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(table.locator('tbody tr')).toHaveCount(150)

  await page.getByRole('button', { name: /Remove big.csv/ }).click()
  await runFile(page, F + 'invalid/formula_cell.csv')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(table.locator('tbody tr')).toHaveCount(3)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV' }).first().click()])
  const csv = readFileSync(await download.path(), 'utf8')
  expect(csv).toContain(`"'=HYPERLINK(""http://example.com"")"`)
  expect(download.suggestedFilename()).toMatch(/^qa-big-table-v1-run_[0-9a-f]+\.csv$/)
})

test('command palette, theme, roles, my runs and the mobile drawer all work', async ({ page }) => {
  await signIn(page, 'Asha')
  await createRecipe(page, 'QA palette target')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.getByPlaceholder(/Search recipes you can open/).fill('palette target')
  await page.getByRole('option', { name: /QA palette target/ }).click()
  await expect(page.getByRole('heading', { name: 'QA palette target' })).toBeVisible()

  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await open(page, '/library')
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()

  await open(page, '/access')
  await page.getByLabel('Role of Meera Iyer').selectOption('member')
  await expect(page.getByText('Meera Iyer is now a member')).toBeVisible()
  await page.getByLabel('Role of Meera Iyer').selectOption('viewer')
  await expect(page.getByText('Meera Iyer is now a viewer')).toBeVisible()

  await open(page, '/runs')
  await page.getByRole('tab', { name: /Succeeded/ }).click()
  await expect(page).toHaveURL(/status=succeeded/)
  await page.getByRole('button', { name: 'Delete all my results' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete all my results' }).click()
  await expect(page.getByText('No runs yet')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'System design' }).click()
  await expect(page.getByText('Live schema and triggers')).toBeVisible()
  await expect(page.getByText('12 triggers')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
