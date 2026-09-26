import { expect, test, type Page } from '@playwright/test'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../../src/lib/workflow/examples'

// Accounts and teams in a real browser: sign-up creates a workspace, an invite
// link brings a teammate in, the workspace switcher, and account settings.

const PASSWORD = 'correct horse battery 42'
/** Unique per run, so reruns against a kept database never collide. */
const unique = Date.now().toString(36)

async function open(page: Page, path: string) {
  await page.goto(path)
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
}

async function signUp(page: Page, input: { name: string; email: string; workspace?: string }) {
  await page.getByLabel('Full name').fill(input.name)
  if (await page.getByLabel('Work email').isEditable()) await page.getByLabel('Work email').fill(input.email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  if (input.workspace) await page.getByLabel('Workspace name').fill(input.workspace)
}

test('a new team signs up, invites a teammate by link, and the teammate joins and runs a shared recipe', async ({ browser }) => {
  const samContext = await browser.newContext()
  const sam = await samContext.newPage()
  await open(sam, '/login')
  await sam.getByRole('link', { name: 'Create an account' }).click()
  await expect(sam.getByRole('heading', { name: 'Create your account' })).toBeVisible()

  // Field rules show on blur, before anything is sent.
  await sam.getByLabel('Password', { exact: true }).fill('password123')
  await sam.getByLabel('Password', { exact: true }).blur()
  await expect(sam.getByText('That password is too common')).toBeVisible()

  await signUp(sam, { name: 'Sam Patel', email: `sam.${unique}@acme.test`, workspace: `Acme Finance ${unique}` })
  await sam.getByRole('button', { name: /Create account/ }).click()
  await expect(sam.getByRole('heading', { name: 'Welcome, Sam' })).toBeVisible()
  await expect(sam.getByRole('link', { name: 'Invite your team' })).toBeVisible()

  // A recipe to share, created through the API as Sam.
  const origin = new URL(sam.url()).origin
  const created = await sam.request.post('/api/workflows', { headers: { origin }, data: { title: 'Month-end exceptions', definition: ORIGINAL } })
  const recipeId = (await created.json()).workflow.id as string
  await sam.request.patch(`/api/workflows/${recipeId}`, { headers: { origin }, data: { visibility: 'team' } })

  // Invite link from the Access page.
  await open(sam, '/access')
  await sam.getByLabel('Role', { exact: true }).selectOption('member')
  await sam.getByRole('button', { name: 'Create link' }).click()
  const link = await sam.locator('code').filter({ hasText: '/invite/' }).innerText()
  await expect(sam.getByText('Anyone with the link')).toBeVisible()

  // Ria opens it, creates her account through it, and lands in Sam's workspace.
  const riaContext = await browser.newContext()
  const ria = await riaContext.newPage()
  await open(ria, link.replace(origin, ''))
  await expect(ria.getByRole('heading', { name: `Join Acme Finance ${unique}` })).toBeVisible()
  await ria.getByRole('link', { name: /Create an account and join/ }).click()
  await expect(ria.getByText(`invited you to Acme Finance ${unique}`)).toBeVisible()
  await expect(ria.getByLabel('Workspace name')).toHaveCount(0)
  await signUp(ria, { name: 'Ria Shah', email: `ria.${unique}@acme.test` })
  await ria.getByRole('button', { name: `Join Acme Finance ${unique}` }).click()
  await expect(ria.getByRole('heading', { name: 'Welcome, Ria' })).toBeVisible()
  await expect(ria.getByRole('button', { name: `Workspace: Acme Finance ${unique}. Switch or create a workspace` }).first()).toBeVisible()

  // She finds Sam's shared recipe and runs it on her own file.
  await open(ria, '/library?tab=team')
  await ria.getByRole('link', { name: 'Month-end exceptions' }).click()
  await ria.locator('#run-file').setInputFiles('fixtures/sales_A.csv')
  await ria.getByRole('button', { name: 'Run recipe' }).click()
  await expect(ria.getByText('Rows through each step')).toBeVisible()

  // Sam sees her as a member; the link is still valid for others.
  await open(sam, '/access')
  await expect(sam.getByText(`ria.${unique}@acme.test`)).toBeVisible()
  await expect(sam.getByText('1 of 25 used')).toBeVisible()
  await samContext.close()
  await riaContext.close()
})

test('the workspace switcher creates and switches workspaces, and lists follow it', async ({ page }) => {
  await open(page, '/signup')
  await signUp(page, { name: 'Dev Rao', email: `dev.${unique}@acme.test`, workspace: `Dev Team ${unique}` })
  await page.getByRole('button', { name: /Create account/ }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Dev' })).toBeVisible()
  const origin = new URL(page.url()).origin
  await page.request.post('/api/workflows', { headers: { origin }, data: { title: 'Only in the first workspace', definition: ORIGINAL } })

  await page.getByRole('button', { name: new RegExp(`Workspace: Dev Team ${unique}`) }).first().click()
  await page.getByRole('menuitem', { name: /Create a workspace/ }).click()
  await page.getByLabel('Workspace name').fill(`Side project ${unique}`)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByText(`Side project ${unique} is ready`)).toBeVisible()

  await open(page, '/library')
  await expect(page.getByText("You don't own any recipes yet")).toBeVisible()

  // Keyboard: open the switcher with the arrow key, move, and choose.
  const switcher = page.getByRole('button', { name: new RegExp(`Workspace: Side project ${unique}`) }).first()
  await switcher.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitemradio', { name: new RegExp(`Dev Team ${unique}`) }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Now working in Dev Team ${unique}`)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Only in the first workspace' })).toBeVisible()
})

test('account settings: rename, change password (other devices are signed out), sign in with the new one', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = `lee.${unique}@acme.test`
  await open(page, '/signup')
  await signUp(page, { name: 'Lee Wong', email, workspace: `Lee Co ${unique}` })
  await page.getByRole('button', { name: /Create account/ }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Lee' })).toBeVisible()

  // A second device.
  const laptop = await browser.newContext()
  const origin = new URL(page.url()).origin
  expect((await laptop.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { email, password: PASSWORD } })).status()).toBe(200)

  await page.getByRole('link', { name: 'Account settings' }).first().click()
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()
  await expect(page.getByText('This device')).toBeVisible()
  await page.getByLabel('Name').fill('Lee Wong-Iyer')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Name saved')).toBeVisible()

  await page.getByLabel('Current password').fill(PASSWORD)
  await page.getByLabel('New password', { exact: true }).fill('a new and better passphrase')
  await page.getByLabel('Repeat the new password').fill('a new and better passphrase')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Signed out 1 other device.')).toBeVisible()
  expect((await laptop.request.get(`${origin}/api/me`)).status()).toBe(401)

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('a new and better passphrase')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Lee' })).toBeVisible()
  await context.close()
  await laptop.close()
})

test('forgot password answers the same whether or not the account exists, and bad links explain themselves', async ({ page }) => {
  await open(page, '/login')
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await page.getByLabel('Email').fill(`nobody.${unique}@acme.test`)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText('If an account exists for that email')).toBeVisible()

  await open(page, '/reset-password/not-a-real-token')
  await expect(page.getByText('This reset link has expired or was already used')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()

  await open(page, '/invite/not-a-real-token')
  await expect(page.getByRole('heading', { name: 'This invite can’t be used' })).toBeVisible()
})

test('sign-in, sign-up and reset pages fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/login', '/signup', '/forgot-password', '/reset-password/not-a-real-token', '/invite/not-a-real-token']) {
    await open(page, path)
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390)
  }
})
