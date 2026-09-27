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
  await expect(page.getByRole('heading', { name: new RegExp(`Welcome, ${name}`) })).toBeVisible()
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
  await expect(page.getByText('Unsupported step type "sql". Only filter, group_sum, aggregate, sort, limit, select and date_part are allowed.')).toBeVisible()
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
  await expect(page.getByText('15 triggers')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

// ----- Phase 10 review: each test pins a problem that was found and fixed ------------

const BY_REP = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { status: 'string', sales_rep: 'string', amount: 'integer_inr' } },
  parameters: {},
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    { id: 's2', type: 'group_sum', groupBy: 'sales_rep', valueColumn: 'amount', as: 'total' },
  ],
  output: { format: 'table' },
}
const BY_REGION = {
  ...BY_REP,
  input: { format: 'csv', columns: { status: 'string', region: 'string', amount: 'integer_inr' } },
  steps: [BY_REP.steps[0], { id: 's2', type: 'group_sum', groupBy: 'region', valueColumn: 'amount', as: 'total' }],
}

test('switching versions keeps the chosen file and re-checks it against that version', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id, versionId: v1 } = await createRecipe(page, 'QA version switch', BY_REP)
  const origin = new URL(page.url()).origin
  const saved = await page.request.post(`/api/workflows/${id}/versions`, { headers: { origin }, data: { definition: BY_REGION } })
  const v2 = (await saved.json()).version.id as string
  const run = page.getByRole('button', { name: 'Run recipe' })

  // On v2 (latest), a file without "region" can't run.
  await open(page, `/w/${id}`)
  await page.locator('#run-file').setInputFiles({ name: 'no_region.csv', mimeType: 'text/csv', buffer: Buffer.from('status,sales_rep,amount\npaid,Ravi,100\n') })
  await expect(page.getByText('Missing required column: region')).toBeVisible()
  await expect(run).toBeDisabled()

  // v1 isn't loaded yet: the page (and the file) stay while it loads, then the file is re-checked.
  await page.getByRole('combobox', { name: 'Version' }).selectOption(v1)
  await expect(page.getByText("You're viewing version 1")).toBeVisible()
  await expect(page.getByText('no_region.csv')).toBeVisible()
  await expect(page.getByText('Missing required column: region')).toHaveCount(0)
  await expect(run).toBeEnabled()

  // Back to v2, now cached: the check follows immediately.
  await page.getByRole('combobox', { name: 'Version' }).selectOption(v2)
  await expect(page.getByText('Missing required column: region')).toBeVisible()
  await expect(run).toBeDisabled()
})

test('the run panel refuses a file that is not UTF-8 before anything is uploaded', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id } = await createRecipe(page, 'QA encoding')
  await open(page, `/w/${id}`)
  const windows1252 = Buffer.concat([Buffer.from('order_id,region,sales_rep,status,amount\nO-1,Montr'), Buffer.from([0xe9]), Buffer.from('al,Asha,paid,100\n')])
  await page.locator('#run-file').setInputFiles({ name: 'excel.csv', mimeType: 'text/csv', buffer: windows1252 })
  await expect(page.getByText(/isn't saved as UTF-8 text/)).toBeVisible()
  await expect(page.getByText(/Line 2 has characters that aren't UTF-8/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()
})

test('an unknown address shows a 404 inside the app, with navigation', async ({ page }) => {
  await signIn(page, 'Asha')
  const res = await page.goto('/no-such-page')
  expect(res?.status()).toBe(404)
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  await expect(page).toHaveTitle('Not found · FlowPilot')
  await page.getByRole('link', { name: 'Recipe library' }).first().click()
  await expect(page).toHaveURL(/\/library/)
})

test('wide tables scroll inside their card: no page scrolls sideways on a phone, results never cover the run panel', async ({ page }) => {
  await signIn(page, 'Asha')
  const columns = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`column_${String(i + 1).padStart(2, '0')}`, 'string']))
  const wide = {
    schemaVersion: 1,
    input: { format: 'csv', columns },
    parameters: {},
    steps: [{ id: 's1', type: 'filter', column: 'column_01', operator: 'eq', value: { literal: 'keep' } }],
    output: { format: 'table' },
  }
  const { id } = await createRecipe(page, 'QA wide result', wide)
  const header = Object.keys(columns).join(',')
  const row = ['keep', ...Array.from({ length: 11 }, (_, i) => `a fairly long value number ${i + 1}`)].join(',')
  await open(page, `/w/${id}`)
  await page.locator('#run-file').setInputFiles({ name: 'wide.csv', mimeType: 'text/csv', buffer: Buffer.from(`${header}\n${row}\n`) })
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByText('1 row', { exact: false }).first()).toBeVisible()

  // Desktop: the result card ends before the run panel starts.
  const result = await page.getByRole('table').filter({ hasText: 'column_12' }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').boundingBox()
  const panel = await page.getByRole('complementary').filter({ hasText: 'Run on your file' }).boundingBox()
  expect(result!.x + result!.width).toBeLessThanOrEqual(panel!.x)

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/welcome', '/', '/library', '/runs', '/access', '/audit', '/account', '/system-design', '/workflows/new', page.url().replace(/^https?:\/\/[^/]+/, ''), `/w/${id}/edit`]) {
    await open(page, path)
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390)
  }
})

test('the library shows 60 recipes at a time and loads the rest on request', async ({ page }) => {
  await signIn(page, 'Vikram')
  const origin = new URL(page.url()).origin
  for (let i = 0; i < 61; i++) {
    const res = await page.request.post('/api/workflows', { headers: { origin }, data: { title: `QA bulk ${i}`, definition: ORIGINAL } })
    expect(res.status()).toBe(201)
  }
  const total = (await (await page.request.get('/api/workflows?scope=mine&limit=1')).json()).total as number
  await open(page, '/library')
  const cards = page.locator('article')
  await expect(cards).toHaveCount(60)
  await expect(page.getByText(`Showing 60 of ${total} recipes`)).toBeVisible()
  await page.getByRole('button', { name: `Show ${Math.min(total - 60, 60)} more` }).click()
  await expect(cards).toHaveCount(Math.min(total, 120))
})

test('AI drafts a top-N summary; the new step cards show it, and the run ranks reps with plain-number counts', async ({ page }) => {
  await signIn(page, 'Asha')
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: 'Use sales_A.csv' }).click()
  await page.getByLabel('Describe the report').fill('Top 2 sales reps by paid revenue, with how many orders each.')
  await page.getByRole('button', { name: 'Generate steps' }).click()

  // The draft arrives as editable cards of the new kinds.
  await expect(page.getByLabel('Step 2 type')).toHaveValue('aggregate')
  await expect(page.getByLabel('Figure 2', { exact: true })).toHaveValue('count')
  await expect(page.getByLabel('Step 3 type')).toHaveValue('sort')
  await expect(page.getByLabel('Step 4 type')).toHaveValue('limit')
  await expect(page.getByText('Group by sales_rep: total amount as revenue, number of rows as orders', { exact: true })).toBeVisible()
  await expect(page.getByText('Keep the first 2 rows')).toBeVisible()

  // Add a column choice by hand, with a friendly header.
  await page.getByRole('button', { name: 'Add column choice' }).click()
  await page.getByRole('button', { name: /Keep all 3/ }).click()
  await page.getByLabel('Header for column 2', { exact: true }).fill('Paid revenue')
  await page.getByRole('textbox', { name: /title/i }).first().fill('Top reps')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('heading', { name: 'Top reps' })).toBeVisible()

  await page.locator('#run-file').setInputFiles('fixtures/sales_A.csv')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByText('Rows through each step')).toBeVisible()
  const table = page.getByRole('table').filter({ hasText: 'Paid revenue' })
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table.getByRole('row').nth(1)).toHaveText(/Asha\s*₹1,80,000\s*3/)
  await expect(table.getByRole('row').nth(2)).toHaveText(/Vikram\s*₹40,000\s*1/)
  // The summary line is shown as chips, one per step.
  for (const chip of ['2 rows', 'status = "paid"', 'grouped by sales_rep', 'sorted by revenue ↓', 'first 2']) {
    await expect(page.getByText(chip, { exact: true })).toBeVisible()
  }
})

test('an owner archives and restores a recipe; an admin reads and filters the audit log', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id } = await createRecipe(page, 'QA retire me')
  await open(page, `/w/${id}`)
  await page.getByRole('button', { name: 'Archive' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archive recipe' }).click()
  await expect(page.getByText('Recipe archived')).toBeVisible()
  await expect(page.getByText(/^Archived /).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Archived: can’t run' })).toBeDisabled()

  await open(page, '/library?tab=archived')
  await expect(page.getByRole('link', { name: 'QA retire me' })).toBeVisible()
  await open(page, '/library')
  await expect(page.getByRole('link', { name: 'QA retire me' })).toHaveCount(0)

  await open(page, `/w/${id}`)
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Recipe restored')).toBeVisible()
  await expect(page.getByRole('button', { name: /Choose a file to run|Run recipe/ })).toBeVisible()

  // Admins see the audit log in the sidebar; runs never appear in it.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  await expect(page.getByText('Asha Rao restored “QA retire me”')).toBeVisible()
  await expect(page.getByText('Asha Rao archived “QA retire me”')).toBeVisible()
  await page.getByRole('tab', { name: 'People' }).click()
  await expect(page).toHaveURL(/category=people/)
  await expect(page.getByText('Asha Rao archived “QA retire me”')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/workspace/audit.csv?category=people')

  // A member doesn't get the page (or the link).
  await signIn(page, 'Vikram')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' })).toHaveCount(0)
  await open(page, '/audit')
  await expect(page.getByText('Only admins can read the audit log')).toBeVisible()
})

test('Excel files: the browser converts the chosen sheet, runs it, and downloads results as a real workbook', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id } = await createRecipe(page, 'QA Excel input')
  await open(page, `/w/${id}`)

  // The first sheet is a cover page, so nothing can run until the data sheet is chosen.
  await page.locator('#run-file').setInputFiles(F + 'sales_two_sheets.xlsx')
  await expect(page.getByText(/workbook · sheet “Read me”/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()
  await page.getByLabel('Sheet', { exact: true }).selectOption('Orders')
  await expect(page.getByText(/sheet “Orders” · \d+ rows as CSV/)).toBeVisible()
  await expect(page.getByText('Header check')).toBeVisible()
  await expect(page.getByText('Converted to CSV in your browser; the workbook itself is never uploaded.')).toBeVisible()
  await page.getByRole('button', { name: 'Run recipe' }).click()
  const table = page.getByRole('table', { name: /Result of run/ })
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByText(/sales_two_sheets\.xlsx · \d+ rows read/)).toBeVisible()

  // The Excel download keeps numbers as numbers and says where they came from.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()])
  expect(download.suggestedFilename()).toMatch(/^qa-excel-input-v1-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const XLSX = await import('xlsx')
  const book = XLSX.read(readFileSync(await download.path()), { type: 'buffer' })
  expect(book.SheetNames).toEqual(['Results', 'About this run'])
  const rows = XLSX.utils.sheet_to_json<{ region: string; total: unknown }>(book.Sheets.Results!)
  expect(rows).toHaveLength(2)
  expect(typeof rows[0]!.total).toBe('number')
  expect(XLSX.utils.sheet_to_json<string[]>(book.Sheets['About this run']!, { header: 1 })[0]).toEqual(['Recipe', 'QA Excel input'])

  // A single-sheet workbook needs no choice; a CSV renamed .xlsx is refused before anything is read.
  await page.getByRole('button', { name: /Remove sales_two_sheets.xlsx/ }).click()
  await page.locator('#run-file').setInputFiles(F + 'sales_A.xlsx')
  await expect(page.getByText(/sheet “Orders” · \d+ rows as CSV/)).toBeVisible()
  await expect(page.getByLabel('Sheet', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Remove sales_A.xlsx/ }).click()
  await page.locator('#run-file').setInputFiles({
    name: 'fake.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('region,status,amount\nNorth,paid,5\n'),
  })
  await expect(page.getByText('This file could not be read as a spreadsheet. Save it as .xlsx or CSV and try again.')).toBeVisible()
})

test('dates: the monthly example runs as of a chosen day, and the editor drafts a by-month recipe from a dated sample', async ({ page }) => {
  await signIn(page, 'Vikram')
  const found = await (await page.request.get('/api/workflows?scope=mine&q=Monthly')).json()
  const id = found.items[0].id as string
  await open(page, `/w/${id}`)
  await runFile(page, F + 'orders_dated.csv')
  await page.getByLabel('As of').fill('2026-09-27')
  await expect(page.getByText(/counts “last month” and “N days ago” from this day \(27 Sep 2026\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Run recipe' }).click()
  const table = page.getByRole('table', { name: /Result of run/ })
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(table.locator('tbody tr').first()).toContainText('2026-04')
  await expect(table.locator('tbody tr').last()).toContainText('2026-09')
  await expect(page.getByText(/the start of the month 5 months ago \(1 Apr 2026\)/).first()).toBeVisible()

  // A dated sample suggests the date type; the AI draft (mock) uses a relative date and a period; the cards explain both.
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: 'Use orders_dated.csv' }).click()
  await expect(page.getByLabel('Type of ordered_on')).toHaveValue('date')
  await page.getByLabel('Describe the report').fill('Paid revenue by month for the last 6 months')
  await page.getByRole('button', { name: 'Generate steps' }).click()
  await expect(page.getByText('Add month: the month of ordered_on').first()).toBeVisible()
  await expect(page.getByText(/the start of the month 5 months ago · run today, that is \d{1,2} \w{3} \d{4}/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Relative to run day', pressed: true })).toBeVisible()
  // Switch that filter to a fixed date by hand and see the date input.
  await page.getByRole('button', { name: 'Fixed date' }).click()
  await page.getByPlaceholder('YYYY-MM-DD').fill('2026-04-01')
  await expect(page.getByText('= 1 Apr 2026')).toBeVisible()
  await expect(page.getByText('Keep rows where ordered_on is on or after 1 Apr 2026').first()).toBeVisible()
})

test('the front door: signed-out visitors to / see the landing page, and a template link opens the editor pre-filled', async ({ page }) => {
  await page.context().clearCookies()
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Describe the report once.')
  await expect(page.getByRole('link', { name: /Try the demo|Sign in/ }).first()).toBeVisible()
  // Link previews and crawlers get what they need.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og\.png$/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /FlowPilot/)
  expect((await page.request.get('/robots.txt')).status()).toBe(200)
  expect((await page.request.get('/og.png')).headers()['content-type']).toContain('image/png')
  // A deeper link still goes to sign-in and comes back.
  await page.goto('/library')
  await expect(page).toHaveURL(/\/login\?redirect=%2Flibrary$/)

  await signIn(page, 'Asha')
  await open(page, '/welcome')
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Refunds last quarter by region' }).click()
  await expect(page).toHaveURL(/\/workflows\/new\?template=refunds_last_quarter$/)
  await expect(page.getByText('Loaded “Refunds last quarter by region”')).toBeVisible()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Refunds last quarter by region')
  await expect(page.getByLabel(/^Step \d+ type$/)).toHaveCount(5)
  // Sample values came along with the template (the sample file was read in the browser).
  await expect(page.getByText('2026-01-08').first()).toBeVisible()
})

test('templates: pick one in the gallery, save it, run it on its sample, and read the result as a chart', async ({ page }) => {
  await signIn(page, 'Asha')
  await open(page, '/workflows/new')
  await page.getByRole('button', { name: 'Dates' }).click()
  await expect(page.getByRole('article')).toHaveCount(4)
  await page.getByRole('button', { name: 'All' }).click()
  await page.getByRole('article').filter({ hasText: 'Average deal size by region' }).getByRole('button', { name: 'Use this template' }).click()
  await expect(page.getByText('Started from “Average deal size by region”')).toBeVisible()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page).toHaveURL(/\/w\/wf_/)
  await expect(page.getByRole('heading', { name: 'Average deal size by region', exact: true }).first()).toBeVisible()

  await runFile(page, F + 'sales_A.csv')
  await page.getByRole('button', { name: 'Run recipe' }).click()
  const table = page.getByRole('table', { name: /Result of run/ })
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: 'Chart' }).click()
  await expect(page.getByRole('list', { name: 'avg_deal per row' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'West: ₹70,000' })).toBeVisible()
  await page.getByLabel('Figure to chart').selectOption('orders')
  await expect(page.getByRole('img', { name: 'North: 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(table).toBeVisible()
})

test('a near-miss header is fixed in the browser with one click, and a version shows what changed since the one before', async ({ page }) => {
  await signIn(page, 'Asha')
  const { id } = await createRecipe(page, 'QA header fix')
  await open(page, `/w/${id}`)
  await page.locator('#run-file').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from('Status,Region,Sales Rep,amount\npaid,North,Asha,60000\nrefunded,South,Vikram,5\n') })
  await expect(page.getByText(/the file has "Status"/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run recipe' })).toBeDisabled()
  await page.getByRole('button', { name: 'Use “Status” as status' }).click()
  await page.getByRole('button', { name: 'Use “Region” as region' }).click()
  await page.getByRole('button', { name: 'Use “Sales Rep” as sales_rep' }).click()
  await expect(page.getByText('Renamed in your browser only')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run recipe' }).click()
  await expect(page.getByRole('table', { name: /Result of run/ }).locator('tbody tr')).toHaveCount(1)

  // The table copies as tab-separated text.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: /Copy the table/ }).click()
  await expect(page.getByRole('button', { name: /Copy the table/ })).toContainText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('region\ttotal\nNorth\t60000')

  // A second version with a different default: the recipe page explains the change in words.
  const origin = new URL(page.url()).origin
  const v2 = { ...ORIGINAL, parameters: { threshold: { type: 'integer', default: 80000, min: 0, max: 1000000000 } } }
  const saved = await page.request.post(`/api/workflows/${id}/versions`, { headers: { origin }, data: { definition: v2 } })
  expect(saved.status()).toBe(201)
  await open(page, `/w/${id}`)
  await expect(page.getByRole('heading', { name: 'Changes from v1' })).toBeVisible()
  await expect(page.getByText('threshold: default ₹1,00,000 → ₹80,000')).toBeVisible()
})
