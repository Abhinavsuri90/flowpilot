import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../../src/lib/workflow/examples'

// Every page must pass an automated WCAG 2.1 AA scan (axe-core) in both themes.

const PAGES = ['/login', '/', '/library?tab=team', '/workflows/new', '/runs', '/access', '/system-design'] as const

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

    await page.goto('/login')
    await scan('/login')
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

    for (const path of [...PAGES.slice(1), recipePath]) {
      await page.goto(path)
      await scan(path)
    }
    await context.close()
  })
}
