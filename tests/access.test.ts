import { beforeEach, describe, expect, it } from 'vitest'
import { Client, freshApp, pairs, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL, groupedBy } from '../src/lib/workflow/examples'
import { MATRIX_COLUMNS, decide, decideRoleChange, permissionMatrix } from '../src/lib/policy'

let app: Awaited<ReturnType<typeof freshApp>>
beforeEach(async () => {
  app = await freshApp()
})

async function sharedRecipe() {
  const asha = await signIn('asha')
  const created = await asha.post('/api/workflows', {
    title: 'Regional revenue exceptions',
    description: 'Paid orders by region below a threshold',
    definition: ORIGINAL,
  })
  expect(created.status).toBe(201)
  const id: string = created.body.workflow.id
  const versionId: string = created.body.version.id
  expect((await asha.patch(`/api/workflows/${id}`, { visibility: 'team' })).status).toBe(200)
  return { asha, id, versionId }
}

async function versionOf(client: Client, workflowId: string): Promise<string> {
  return (await client.get(`/api/workflows/${workflowId}`)).body.version.id
}

describe('access control', () => {
  it('answers 401 on every endpoint without a session', async () => {
    const anon = new Client()
    const calls: Array<[string, string]> = [
      ['GET', '/api/me'],
      ['GET', '/api/dashboard'],
      ['GET', '/api/workflows'],
      ['POST', '/api/workflows'],
      ['GET', '/api/workflows/wf_x'],
      ['PATCH', '/api/workflows/wf_x'],
      ['POST', '/api/workflows/wf_x/versions'],
      ['POST', '/api/workflows/wf_x/fork'],
      ['GET', '/api/workflows/wf_x/access'],
      ['POST', '/api/generate'],
      ['POST', '/api/runs'],
      ['GET', '/api/runs'],
      ['DELETE', '/api/runs'],
      ['GET', '/api/runs/run_x'],
      ['GET', '/api/runs/run_x/csv'],
      ['GET', '/api/workspace'],
      ['PATCH', '/api/workspace/members/usr_x'],
      ['GET', '/api/system'],
    ]
    for (const [method, path] of calls) {
      const res = await anon.call(method, path, method === 'GET' || method === 'DELETE' ? {} : { json: {} })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
  })

  it('gives the same answer for an unknown email and a wrong password, and throttles after 10 failures', async () => {
    const anon = new Client()
    const unknown = await anon.post('/api/auth/login', { email: 'nobody@demo.local', password: 'flowpilot-demo' })
    const wrong = await anon.post('/api/auth/login', { email: 'asha@demo.local', password: 'not-it' })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(unknown.body).toEqual(wrong.body)
    for (let i = 0; i < 9; i++) await anon.post('/api/auth/login', { email: 'asha@demo.local', password: 'not-it' })
    const locked = await anon.post('/api/auth/login', { email: 'ASHA@demo.local', password: 'flowpilot-demo' })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS')
    expect((await anon.post('/api/auth/login', { email: 'vikram@demo.local', password: 'flowpilot-demo' })).status).toBe(200)
  })

  it('lets a member read, run and copy a team recipe', async () => {
    const { id, versionId } = await sharedRecipe()
    const vikram = await signIn('vikram')
    const detail = await vikram.get(`/api/workflows/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ role: 'member', isOwner: false, forkCount: null })
    expect(detail.body.permissions.run.allowed).toBe(true)
    expect(detail.body.permissions.fork.allowed).toBe(true)
    expect((await vikram.run(versionId, fixture('sales_B.csv'))).status).toBe(201)
    const copy = await vikram.post(`/api/workflows/${id}/fork`, { versionId, title: 'By rep' })
    expect(copy.status).toBe(201)
    expect(copy.body.workflow).toMatchObject({ visibility: 'private', isMine: true, owner: { name: 'Vikram Nair' } })
  })

  it('answers 403 when a member (or an admin) tries to edit or re-share someone else’s recipe', async () => {
    const { id } = await sharedRecipe()
    const vikram = await signIn('vikram')
    const save = await vikram.post(`/api/workflows/${id}/versions`, { definition: groupedBy(ORIGINAL, 'sales_rep') })
    expect(save.status).toBe(403)
    expect((await vikram.patch(`/api/workflows/${id}`, { title: 'Mine now' })).status).toBe(403)
    const unshare = await vikram.patch(`/api/workflows/${id}`, { visibility: 'private' })
    expect(unshare.status).toBe(403)
    expect(unshare.body.error.message).toBe('Only the owner can change who this recipe is shared with')

    // Admins manage roles only; they can't edit others' recipes either.
    const vikramsId = app.seed.examples.paid_by_rep
    const asha = await signIn('asha')
    expect((await asha.post(`/api/workflows/${vikramsId}/versions`, { definition: ORIGINAL })).status).toBe(403)
  })

  it('keeps runs and result downloads private to their runner, even from the owner', async () => {
    const { asha, versionId } = await sharedRecipe()
    const vikram = await signIn('vikram')
    const ashaRun = await asha.run(versionId, fixture('sales_A.csv'))
    const vikramRun = await vikram.run(versionId, fixture('sales_B.csv'))
    expect(ashaRun.status).toBe(201)
    expect(vikramRun.status).toBe(201)

    expect((await vikram.get(`/api/runs/${ashaRun.body.id}`)).status).toBe(404)
    expect((await vikram.get(`/api/runs/${ashaRun.body.id}/csv`)).status).toBe(404)
    expect((await asha.get(`/api/runs/${vikramRun.body.id}`)).status).toBe(404)
    expect((await asha.get('/api/runs')).body.runs.map((r: { id: string }) => r.id)).toEqual([ashaRun.body.id])

    const csv = await asha.get(`/api/runs/${ashaRun.body.id}/csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="regional-revenue-exceptions-v1-run_[0-9a-f]+\.csv"$/)
    expect(csv.headers.get('x-content-type-options')).toBe('nosniff')
    expect(csv.text).toBe('region,total\r\nSouth,40000\r\nWest,70000')
  })

  it('lets a viewer run but not copy or create', async () => {
    const { id, versionId } = await sharedRecipe()
    const meera = await signIn('meera')
    const detail = await meera.get(`/api/workflows/${id}`)
    expect(detail.body.permissions.fork).toEqual({ allowed: false, status: 403, reason: 'Viewers can run recipes but cannot make copies' })
    expect((await meera.run(versionId, fixture('sales_A.csv'))).status).toBe(201)
    const fork = await meera.post(`/api/workflows/${id}/fork`, { versionId, title: 'Copy' })
    expect(fork.status).toBe(403)
    const create = await meera.post('/api/workflows', { title: 'Mine', definition: ORIGINAL })
    expect(create.status).toBe(403)
    expect(create.body.error.message).toBe('Viewers can run recipes but cannot create them')
  })

  it('answers an outsider with 404 everywhere, exactly like a missing id', async () => {
    const { asha, id, versionId } = await sharedRecipe()
    const ashaRun = await asha.run(versionId, fixture('sales_A.csv'))
    const olivia = await signIn('olivia')
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', `/api/workflows/${id}`],
      ['GET', `/api/workflows/${id}?v=${versionId}`],
      ['GET', `/api/workflows/${id}/access`],
      ['PATCH', `/api/workflows/${id}`, { title: 'x' }],
      ['POST', `/api/workflows/${id}/versions`, { definition: ORIGINAL }],
      ['POST', `/api/workflows/${id}/fork`, { versionId, title: 'x' }],
      ['GET', `/api/runs/${ashaRun.body.id}`],
      ['GET', `/api/runs/${ashaRun.body.id}/csv`],
    ]
    for (const [method, path, json] of attempts) {
      expect((await olivia.call(method, path, json === undefined ? {} : { json })).status, `${method} ${path}`).toBe(404)
    }
    expect((await olivia.run(versionId, fixture('sales_A.csv'))).status).toBe(404)
    const missing = await olivia.get('/api/workflows/wf_0000000000000000')
    const hidden = await olivia.get(`/api/workflows/${id}`)
    expect(hidden.body).toEqual(missing.body)
  })

  it('isolates workspaces: each library lists only its own team', async () => {
    const asha = await signIn('asha')
    const olivia = await signIn('olivia')
    const salesTeam = (await asha.get('/api/workflows?scope=team')).body
    const marketingTeam = (await olivia.get('/api/workflows?scope=team')).body
    expect(salesTeam.items.map((w: { title: string }) => w.title)).toEqual(['Paid revenue by sales rep'])
    expect(marketingTeam.items.map((w: { title: string }) => w.title)).toEqual(['Live spend by channel'])
    expect((await olivia.get(`/api/workflows/${app.seed.examples.paid_by_rep}`)).status).toBe(404)
    expect((await asha.get(`/api/workflows/${app.seed.examples.live_spend}`)).status).toBe(404)
    expect((await olivia.get('/api/workflows?scope=all&q=paid')).body.items).toEqual([])
  })

  it('hides private recipes from everyone but the owner, including admins', async () => {
    const asha = await signIn('asha')
    const vikram = await signIn('vikram')
    const draft = await asha.post('/api/workflows', { title: 'Asha draft', definition: ORIGINAL })
    expect((await vikram.get(`/api/workflows/${draft.body.workflow.id}`)).status).toBe(404)
    const own = await vikram.post('/api/workflows', { title: 'Vikram draft', definition: ORIGINAL })
    const ownId = own.body.workflow.id
    expect((await asha.get(`/api/workflows/${ownId}`)).status).toBe(404)
    expect((await asha.post(`/api/workflows/${ownId}/fork`, { versionId: own.body.version.id, title: 'x' })).status).toBe(404)
    expect((await asha.get('/api/workflows?scope=team')).body.items.map((w: { id: string }) => w.id)).not.toContain(ownId)
  })

  it('treats a ?v= from another recipe as not found', async () => {
    const { asha, id, versionId } = await sharedRecipe()
    const foreign = await versionOf(asha, app.seed.examples.paid_by_rep)
    expect((await asha.get(`/api/workflows/${id}?v=${foreign}`)).status).toBe(404)
    expect((await asha.post(`/api/workflows/${id}/fork`, { versionId: foreign, title: 'x' })).status).toBe(404)
    expect((await asha.get(`/api/workflows/${id}?v=${versionId}`)).status).toBe(200)
  })

  it('keeps v1 and its runs unchanged after v2 is saved', async () => {
    const { asha, id, versionId: v1 } = await sharedRecipe()
    const run1 = await asha.run(v1, fixture('sales_A.csv'))
    const v2def = structuredClone(ORIGINAL)
    ;(v2def.parameters.threshold as { default: number }).default = 80000
    const saved = await asha.post(`/api/workflows/${id}/versions`, { definition: v2def })
    expect(saved.body.version.number).toBe(2)

    const latest = (await asha.get(`/api/workflows/${id}`)).body
    expect(latest.version).toMatchObject({ number: 2, isLatest: true })
    expect(latest.version.definition.parameters.threshold.default).toBe(80000)
    const pinned = (await asha.get(`/api/workflows/${id}?v=${v1}`)).body
    expect(pinned.version).toMatchObject({ number: 1, isLatest: false })
    expect(pinned.version.definition).toEqual(ORIGINAL)
    expect((await asha.get(`/api/runs/${run1.body.id}`)).body.versionNumber).toBe(1)

    const vikram = await signIn('vikram')
    const onV1 = await vikram.run(v1, fixture('sales_A.csv'))
    expect(onV1.body.versionNumber).toBe(1)
    expect(pairs(onV1.body.rows)).toEqual([
      ['South', 40000],
      ['West', 70000],
    ])
  })

  it('enforces the invariants in the database itself', async () => {
    const { asha, id, versionId } = await sharedRecipe()
    const run = await asha.run(versionId, fixture('sales_A.csv'))
    const { db, seed } = app
    const foreign = await versionOf(asha, seed.examples.paid_by_rep)
    expect(() => db.prepare('UPDATE workflow_versions SET definition = ? WHERE id = ?').run('{}', versionId)).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM workflow_versions WHERE id = ?').run(versionId)).toThrow(/cannot be deleted/)
    expect(() => db.prepare('UPDATE workflows SET owner_id = ? WHERE id = ?').run(seed.users.vikram, id)).toThrow(/cannot change/)
    expect(() => db.prepare('UPDATE workflows SET workspace_id = ? WHERE id = ?').run(seed.workspaces.Marketing, id)).toThrow(/cannot change/)
    expect(() => db.prepare('UPDATE workflows SET current_version_id = ? WHERE id = ?').run(foreign, id)).toThrow(/version of this recipe/)
    expect(() => db.prepare(`UPDATE runs SET status = 'failed', error_code = 'X' WHERE id = ?`).run(run.body.id)).toThrow(/final/)
    expect(() => db.prepare(`UPDATE events SET type = 'x'`).run()).toThrow(/append-only/)
    expect(() => db.prepare('DELETE FROM events').run()).toThrow(/append-only/)
    const insertVersion = db.prepare(
      'INSERT INTO workflow_versions (id, workflow_id, version_number, definition, created_by) VALUES (?, ?, ?, ?, ?)',
    )
    expect(() => insertVersion.run('ver_a', id, 5, '{}', seed.users.asha)).toThrow(/sequentially/)
    expect(() => insertVersion.run('ver_b', id, 2, '{}', seed.users.vikram)).toThrow(/owner/)
    expect(() => insertVersion.run('ver_c', id, 2, 'not json', seed.users.asha)).toThrow(/CHECK constraint/)
  })

  it('ignores identity fields on create and rejects unknown keys and crafted definitions', async () => {
    const vikram = await signIn('vikram')
    const created = await vikram.post('/api/workflows', {
      title: 'Sneaky',
      definition: ORIGINAL,
      owner_id: app.seed.users.asha,
      workspace_id: app.seed.workspaces.Marketing,
      visibility: 'team',
    })
    expect(created.status).toBe(201)
    expect(created.body.workflow).toMatchObject({ owner: { name: 'Vikram Nair' }, workspace: { name: 'Sales' }, visibility: 'private' })

    const patched = await vikram.patch(`/api/workflows/${created.body.workflow.id}`, { owner_id: app.seed.users.asha })
    expect(patched.status).toBe(422)
    expect(patched.body.error.message).toBe('Unknown field "owner_id"')

    const crafted = await vikram.post('/api/workflows', {
      title: 'x',
      definition: { ...ORIGINAL, steps: [{ id: 's1', type: 'sql', query: 'DROP TABLE runs' }] },
    })
    expect(crafted.status).toBe(422)
    expect(crafted.body.error.issues[0].message).toBe('Unsupported step type "sql". Only filter and group_sum are allowed.')

    const run = await vikram.run(created.body.version.id, fixture('sales_A.csv'), undefined, { runner_id: app.seed.users.asha })
    expect(run.status).toBe(201)
    expect((await (await signIn('asha')).get(`/api/runs/${run.body.id}`)).status).toBe(404)

    const badParam = await vikram.run(created.body.version.id, fixture('sales_A.csv'), { limit: 5 })
    expect(badParam.status).toBe(422)
    expect(badParam.body.error.code).toBe('PARAMETERS_INVALID')
    const wrongType = await vikram.call('POST', '/api/workflows', { headers: { 'content-type': 'text/plain' } })
    expect(wrongType.status).toBe(415)
  })

  it('blocks new access immediately on unshare while the copy keeps working', async () => {
    const { asha, id, versionId } = await sharedRecipe()
    const vikram = await signIn('vikram')
    const copy = await vikram.post(`/api/workflows/${id}/fork`, { versionId, title: 'Regional (mine)' })
    expect(copy.body.workflow.forkedFrom).toMatchObject({ kind: 'visible', title: 'Regional revenue exceptions', versionNumber: 1 })

    expect((await asha.patch(`/api/workflows/${id}`, { visibility: 'private' })).status).toBe(200)
    expect((await vikram.get(`/api/workflows/${id}`)).status).toBe(404)
    expect((await vikram.run(versionId, fixture('sales_B.csv'))).status).toBe(404)

    const mine = await vikram.get(`/api/workflows/${copy.body.workflow.id}`)
    expect(mine.status).toBe(200)
    expect(mine.body.workflow.forkedFrom).toEqual({ kind: 'hidden', versionNumber: 1 })
    const run = await vikram.run(copy.body.version.id, fixture('sales_B.csv'))
    expect(run.status).toBe(201)
    expect(pairs(run.body.rows)).toEqual([
      ['North', 70000],
      ['West', 20000],
    ])
  })

  it('reports runs stuck in running for over 60 seconds as failed STALE', async () => {
    const { id, versionId } = await sharedRecipe()
    const vikram = await signIn('vikram')
    const insert = app.db.prepare(
      `INSERT INTO runs (id, version_id, workflow_id, runner_id, status, parameters, created_at) VALUES (?, ?, ?, ?, 'running', '{}', ?)`,
    )
    insert.run('run_stale', versionId, id, app.seed.users.vikram, new Date(Date.now() - 61_000).toISOString())
    insert.run('run_fresh', versionId, id, app.seed.users.vikram, new Date(Date.now() - 5_000).toISOString())
    const runs = (await vikram.get('/api/runs')).body.runs as Array<{ id: string; status: string; errorCode: string | null }>
    expect(runs.find((r) => r.id === 'run_stale')).toMatchObject({ status: 'failed', errorCode: 'STALE' })
    expect(runs.find((r) => r.id === 'run_fresh')).toMatchObject({ status: 'running', errorCode: null })
  })

  it('blocks cross-site writes', async () => {
    const { asha, id, versionId } = await sharedRecipe()
    const evil = { origin: 'https://evil.example' }
    const run = await asha.run(versionId, fixture('sales_A.csv'), undefined, {}, evil)
    expect(run.status).toBe(403)
    expect(run.body.error.code).toBe('BAD_ORIGIN')
    expect((await asha.call('PATCH', `/api/workflows/${id}`, { json: { visibility: 'private' }, headers: evil })).status).toBe(403)
    const noOrigin = await asha.call('DELETE', '/api/runs', { headers: { origin: '', 'sec-fetch-site': 'cross-site' } })
    expect(noOrigin.status).toBe(403)
    expect((await asha.call('GET', `/api/workflows/${id}`, { headers: evil })).status).toBe(200)
    expect((await asha.get(`/api/workflows/${id}`)).body.workflow.visibility).toBe('team')
  })

  it('lets only admins change roles, never their own, and applies changes on the next request', async () => {
    const { id, versionId } = await sharedRecipe()
    const asha = await signIn('asha')
    const vikram = await signIn('vikram')
    const meera = await signIn('meera')
    const olivia = await signIn('olivia')
    const meeraId = app.seed.users.meera

    expect((await meera.post(`/api/workflows/${id}/fork`, { versionId, title: 'x' })).status).toBe(403)
    const byMember = await vikram.patch(`/api/workspace/members/${meeraId}`, { role: 'member' })
    expect(byMember.status).toBe(403)
    expect(byMember.body.error.message).toBe('Only admins can change roles')
    expect((await asha.patch(`/api/workspace/members/${app.seed.users.asha}`, { role: 'member' })).body.error.message).toBe(
      "You can't change your own role",
    )
    expect((await olivia.patch(`/api/workspace/members/${meeraId}`, { role: 'admin' })).status).toBe(404)

    expect((await asha.patch(`/api/workspace/members/${meeraId}`, { role: 'member' })).status).toBe(200)
    // Same session, no re-login: the role is read per request.
    expect((await meera.post(`/api/workflows/${id}/fork`, { versionId, title: 'Now allowed' })).status).toBe(201)
    const ws = (await asha.get('/api/workspace')).body
    expect(ws.members.find((m: { user: { id: string } }) => m.user.id === meeraId).role).toBe('member')
    const feed = (await asha.get('/api/dashboard')).body.activity as Array<{ text: string }>
    expect(feed.map((a) => a.text)).toContain("You changed Meera Iyer's role to member in Sales")
  })

  it('never demotes the last admin', async () => {
    const base = { actorId: 'usr_a', actorRole: 'admin' as const, targetId: 'usr_b', targetRole: 'admin' as const, newRole: 'member' as const }
    expect(decideRoleChange({ ...base, adminCount: 1 })).toEqual({ allowed: false, status: 403, reason: "The last admin can't be demoted" })
    expect(decideRoleChange({ ...base, adminCount: 2 }).allowed).toBe(true)
    // Olivia is Marketing's only admin, and can't change her own role either.
    const olivia = await signIn('olivia')
    const res = await olivia.patch(`/api/workspace/members/${app.seed.users.olivia}`, { role: 'member' })
    expect(res.status).toBe(403)
    expect((await olivia.get('/api/workspace')).body).toMatchObject({ role: 'admin', adminCount: 1 })
  })

  it('renders the permission matrix from the same policy the API enforces', async () => {
    const labels = (visibility: 'team' | 'private') => permissionMatrix(visibility).map((row) => [row.label, ...row.cells.map((c) => c.label)])
    expect(labels('team')).toEqual([
      ['See the recipe', 'Yes', 'Yes', 'Yes', 'Yes', 'No (404)'],
      ['Run it on their own file', 'Yes', 'Yes', 'Yes', 'Yes', 'No (404)'],
      ['Make a copy', 'Yes', 'Yes', 'Yes', 'No (403)', 'No (404)'],
      ['Save a new version', 'Yes', 'No (403)', 'No (403)', 'No (403)', 'No (404)'],
      ['Change sharing', 'Yes', 'No (403)', 'No (403)', 'No (403)', 'No (404)'],
      ["See someone else's runs", 'No (404)', 'No (404)', 'No (404)', 'No (404)', 'No (404)'],
      ['Create recipes in the workspace', 'n/a', 'Yes', 'Yes', 'No (403)', 'No'],
      ["Change members' roles", 'n/a', 'Yes', 'No (403)', 'No (403)', 'No'],
    ])
    for (const row of labels('private').slice(0, 5)) expect(row.slice(2)).toEqual(['No (404)', 'No (404)', 'No (404)', 'No (404)'])

    // The API reports the same decision to each real person.
    const { id } = await sharedRecipe()
    const people = { admin: 'asha', member: 'vikram', viewer: 'meera', outsider: 'olivia' } as const
    const vikramsRecipe = app.seed.examples.paid_by_rep
    for (const column of MATRIX_COLUMNS.filter((c) => c.key !== 'owner' && c.key !== 'admin')) {
      const client = await signIn(people[column.key as keyof typeof people])
      const res = await client.get(`/api/workflows/${column.key === 'member' ? id : vikramsRecipe}`)
      if (column.rel.role === null) {
        expect(res.status).toBe(404)
      } else {
        for (const action of ['view', 'run', 'fork', 'edit', 'share'] as const) {
          expect(res.body.permissions[action].allowed, `${column.key} ${action}`).toBe(decide(action, column.rel, 'team').allowed)
        }
      }
    }
  })
})
