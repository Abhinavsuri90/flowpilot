import { beforeEach, describe, expect, it } from 'vitest'
import { Client, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Retiring recipes (archive / restore) and the admin audit log.

let app: Awaited<ReturnType<typeof freshApp>>
beforeEach(async () => {
  app = await freshApp()
})

async function sharedRecipe(owner: Client, title = 'Regional revenue exceptions') {
  const created = await owner.post('/api/workflows', { title, definition: ORIGINAL })
  expect(created.status).toBe(201)
  expect((await owner.patch(`/api/workflows/${created.body.workflow.id}`, { visibility: 'team' })).status).toBe(200)
  return { id: created.body.workflow.id as string, versionId: created.body.version.id as string }
}

describe('archiving a recipe', () => {
  it('takes it out of the library and stops runs, copies and new versions until restored', async () => {
    const asha = await signIn('asha')
    const vikram = await signIn('vikram')
    const { id, versionId } = await sharedRecipe(asha)
    expect((await vikram.patch(`/api/workflows/${id}`, { archived: true })).status).toBe(403) // owners only

    expect((await asha.patch(`/api/workflows/${id}`, { archived: true })).status).toBe(200)
    const team = (await vikram.get('/api/workflows?scope=team')).body
    expect(team.items.map((w: { id: string }) => w.id)).not.toContain(id)
    expect(team.counts.archived).toBe(1)
    const archived = (await vikram.get('/api/workflows?scope=all&archived=1')).body
    expect(archived.items).toMatchObject([{ id, archivedAt: expect.any(String), canFork: false }])

    // Still viewable, but nothing new can happen to it.
    const detail = (await vikram.get(`/api/workflows/${id}`)).body
    expect(detail.permissions.run).toEqual({ allowed: false, reason: 'Archived by its owner', status: 403 })
    const run = await vikram.run(versionId, fixture('sales_A.csv'))
    expect(run.status).toBe(409)
    expect(run.body.error.code).toBe('RECIPE_ARCHIVED')
    expect((await vikram.post(`/api/workflows/${id}/fork`, { versionId, title: 'Copy' })).status).toBe(409)
    expect((await asha.post(`/api/workflows/${id}/versions`, { definition: ORIGINAL })).status).toBe(409)

    // Restoring brings it all back.
    expect((await asha.patch(`/api/workflows/${id}`, { archived: false })).status).toBe(200)
    expect((await vikram.run(versionId, fixture('sales_A.csv'))).status).toBe(201)
    const feed = (await asha.get('/api/dashboard')).body.activity.map((a: { text: string }) => a.text)
    expect(feed).toEqual(expect.arrayContaining(['You archived Regional revenue exceptions', 'You restored Regional revenue exceptions']))
  })
})

describe('audit log', () => {
  it('is for admins only', async () => {
    expect((await (await signIn('vikram')).get('/api/workspace/audit')).status).toBe(403)
    expect((await (await signIn('meera')).get('/api/workspace/audit.csv')).status).toBe(403)
    expect((await (await signIn('asha')).get('/api/workspace/audit')).status).toBe(200)
  })

  it('lists changes newest first, never runs, and never names recipes the admin cannot see', async () => {
    const asha = await signIn('asha')
    const vikram = await signIn('vikram')
    const shared = await sharedRecipe(vikram, 'Shared by Vikram')
    await vikram.run(shared.versionId, fixture('sales_A.csv'))
    const hidden = await vikram.post('/api/workflows', { title: 'Vikram secret draft', definition: ORIGINAL })
    await asha.patch(`/api/workspace/members/${app.seed.users.meera}`, { role: 'member' })
    const fork = await asha.post(`/api/workflows/${shared.id}/fork`, { versionId: shared.versionId, title: 'Asha private copy' })
    expect(fork.status).toBe(201)

    const log = (await asha.get('/api/workspace/audit')).body
    const texts = log.entries.map((e: { text: string }) => e.text)
    expect(texts.slice(0, 5)).toEqual([
      'Asha Rao made a private copy of “Shared by Vikram” (v1)',
      "Asha Rao changed Meera Iyer's role from viewer to member",
      'Vikram Nair created a private recipe',
      'Vikram Nair shared “Shared by Vikram” with the workspace',
      'Vikram Nair created “Shared by Vikram”',
    ])
    expect(JSON.stringify(log)).not.toContain('Vikram secret draft')
    expect(JSON.stringify(log)).not.toContain(hidden.body.workflow.id)
    expect(texts.join(' ')).not.toMatch(/ ran /)
    expect(log.entries.find((e: { action: string }) => e.action === 'workflow.shared')).toMatchObject({ category: 'sharing', recipe: { id: shared.id } })
  })

  it('filters by kind and person, pages with before, and exports a formula-safe CSV', async () => {
    const asha = await signIn('asha')
    const vikram = await signIn('vikram')
    for (let i = 0; i < 3; i++) await sharedRecipe(vikram, `=cmd|' /C calc'!A${i}`)
    await asha.patch(`/api/workspace/members/${app.seed.users.meera}`, { role: 'member' })

    const people = (await asha.get('/api/workspace/audit?category=people')).body.entries
    expect(people.map((e: { action: string }) => e.action)).toEqual(['role.changed'])
    const byVikram = (await asha.get(`/api/workspace/audit?actor=${app.seed.users.vikram}`)).body.entries
    expect(byVikram.every((e: { actor: { name: string } }) => e.actor.name === 'Vikram Nair')).toBe(true)

    const first = (await asha.get('/api/workspace/audit?limit=2')).body
    expect(first.entries).toHaveLength(2)
    const second = (await asha.get(`/api/workspace/audit?limit=2&before=${first.nextBefore}`)).body
    expect(second.entries[0].id).toBeLessThan(first.entries[1].id)

    const csv = await asha.get('/api/workspace/audit.csv?category=recipes')
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="audit-sales-\d{4}-\d{2}-\d{2}\.csv"$/)
    const lines = csv.text.split('\r\n')
    expect(lines[0]).toBe('time_utc,actor,category,action,description,recipe_id')
    // Descriptions quote titles, so a formula-like title can't start a cell.
    expect(lines.slice(1).every((line) => !/,=|^=/.test(line))).toBe(true)
    // Header + "recipes" events only: Vikram's 3 new recipes and the 2 seeded Sales examples (shares are "sharing").
    expect(lines).toHaveLength(1 + 5)
  })
})
