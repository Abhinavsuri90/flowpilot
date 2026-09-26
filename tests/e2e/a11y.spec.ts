import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../../src/lib/workflow/examples'

// Every page must pass an automated WCAG 2.1 AA scan (axe-core) in both themes.

const PUBLIC_PAGES = ['/welcome', '/login', '/signup', '/forgot-password', '/reset-password/not-a-real-token', '/invite/not-a-real-token'] as const
const APP_PAGES = ['/', '/library?tab=team', '/library?tab=archived', '/workflows/new', '/runs', '/access', '/audit', '/system-design', '/account'] as const

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every page passes an automated WCAG 2.1 AA scan (${colorScheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const scan = async (label: string) => {
      await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
      await page.waitForLoadState('networkidle')
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(
        violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes[0]?.target.join(' ')}`),
        `${label} should have no WCAG violations`,
      ).toEqual([])
    }

    for (const path of PUBLIC_PAGES) {
      await page.goto(path)
      await scan(path)
    }

    // A real invitation, opened signed out.
    const origin = new URL(page.url()).origin
    const registered = await page.request.post('/api/auth/register', {
      data: { name: 'Axe Tester', email: `axe.${colorScheme}.${Date.now()}@acme.test`, password: 'correct horse battery 42', workspaceName: 'Axe Co' },
      headers: { origin },
    })
    expect(registered.status()).toBe(201)
    const invite = await (await page.request.post('/api/workspace/invites', { data: { role: 'member' }, headers: { origin } })).json()
    const anonymous = await browser.newContext({ colorScheme, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
    const invitePage = await anonymous.newPage()
    await invitePage.goto(new URL(invite.link).pathname)
    await invitePage.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
    await invitePage.waitForLoadState('networkidle')
    const inviteScan = await new AxeBuilder({ page: invitePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(inviteScan.violations.map((v) => `/invite: ${v.id} (${v.impact}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
    await anonymous.close()

    const login = await page.request.post('/api/auth/login', {
      data: { email: 'asha@demo.local', password: 'flowpilot-demo' },
      headers: { origin: new URL(page.url()).origin },
    })
    expect(login.status()).toBe(200)
    const created = await page.request.post('/api/workflows', {
      data: { title: `A11y ${colorScheme}`, definition: ORIGINAL },
      headers: { origin: new URL(page.url()).origin },
    })
    const recipePath = `/w/${(await created.json()).workflow.id}`

    for (const path of [...APP_PAGES, recipePath]) {
      await page.goto(path)
      await scan(path)
    }
    await context.close()
  })
}
