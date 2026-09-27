import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE, Client, PASSWORD, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { handleApi } from '../src/server/api/router'
import { recordEvent } from '../src/server/events'
import { finishRunFailed, insertRun } from '../src/server/repo'
import { hashToken } from '../src/server/auth'
import { safeRedirect } from '../src/lib/redirect'
import { clientIp } from '../src/server/config'
import { readFileSync } from 'node:fs'
import { APP_VERSION } from '../src/lib/version'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Problems found in the phase 10 review, each pinned by a test.

let app: Awaited<ReturnType<typeof freshApp>>
beforeEach(async () => {
  app = await freshApp()
})

async function createRecipe(client: Client, title = 'Regional revenue exceptions') {
  const res = await client.post('/api/workflows', { title, definition: ORIGINAL })
  expect(res.status).toBe(201)
  return { id: res.body.workflow.id as string, versionId: res.body.version.id as string }
}

describe('HTTP semantics of the API', () => {
  it('answers HEAD like GET, without a body', async () => {
    const res = await handleApi(new Request(`${BASE}/api/health`, { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.text()).toBe('')
  })

  it('answers OPTIONS with 204 and the allowed methods, and other methods with 405', async () => {
    const asha = await signIn('asha')
    const options = await asha.call('OPTIONS', '/api/workflows')
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, POST, HEAD, OPTIONS')
    const put = await asha.call('PUT', '/api/workflows')
    expect(put.status).toBe(405)
    expect(put.body.error.code).toBe('METHOD_NOT_ALLOWED')
    expect(put.headers.get('allow')).toBe('GET, POST, HEAD, OPTIONS')
    expect((await asha.call('OPTIONS', '/api/nope')).status).toBe(404)
  })

  it('asks browsers to stay on HTTPS (HSTS) only when served over HTTPS', async () => {
    const plain = await handleApi(new Request(`${BASE}/api/health`))
    expect(plain.headers.get('strict-transport-security')).toBeNull()
    const proxied = await handleApi(new Request(`${BASE}/api/health`, { headers: { 'x-forwarded-proto': 'https' } }))
    expect(proxied.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
  })

  it('treats malformed percent-encoding in an id as not found, not a server error', async () => {
    const asha = await signIn('asha')
    for (const path of ['/api/workflows/%E0%A4%A', '/api/runs/%ZZ', '/api/runs/%E0/csv']) {
      const res = await asha.get(path)
      expect(res.status, path).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    }
  })
})

describe('sign-in redirects', () => {
  it('only allows paths on this site', () => {
    expect(safeRedirect('/library?tab=team')).toBe('/library?tab=team')
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login?x=1', '/api/me', undefined, '']) {
      expect(safeRedirect(bad), String(bad)).toBe('/')
    }
  })

  it('refuses control characters, which browsers strip ("/<tab>/evil.example" → "//evil.example")', () => {
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\u0000x', '/\u007fx']) {
      expect(safeRedirect(bad), JSON.stringify(bad)).toBe('/')
    }
  })
})

describe('sessions', () => {
  const sessionsOf = (userId: string) => app.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').pluck().all(userId) as string[]

  it('purges expired sessions on sign-in', async () => {
    const asha = app.seed.users.asha
    app.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken('stale-token'), asha, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z')
    expect(sessionsOf(asha)).toContain(hashToken('stale-token'))
    await signIn('vikram')
    expect(sessionsOf(asha)).not.toContain(hashToken('stale-token'))
  })

  it("replaces the browser's previous session when someone signs in again", async () => {
    const client = await signIn('asha')
    const first = client.cookie!.split('=')[1]!
    const again = await client.post('/api/auth/login', { email: 'vikram@demo.local', password: PASSWORD })
    expect(again.status).toBe(200)
    expect(sessionsOf(app.seed.users.asha)).not.toContain(hashToken(first))
    expect((await client.get('/api/me')).body.user.email).toBe('vikram@demo.local')
  })
})

describe('recipe details', () => {
  it('a PATCH that changes nothing leaves updated_at and the audit log alone', async () => {
    const asha = await signIn('asha')
    const { id } = await createRecipe(asha)
    const updatedAt = () => app.db.prepare('SELECT updated_at FROM workflows WHERE id = ?').pluck().get(id)
    const events = () => app.db.prepare('SELECT COUNT(*) FROM events WHERE workflow_id = ?').pluck().get(id) as number
    const before = { at: updatedAt(), events: events() }
    await new Promise((r) => setTimeout(r, 5))
    expect((await asha.patch(`/api/workflows/${id}`, { visibility: 'private', title: 'Regional revenue exceptions' })).status).toBe(200)
    expect({ at: updatedAt(), events: events() }).toEqual(before)
    // A real change still moves it and is recorded once.
    expect((await asha.patch(`/api/workflows/${id}`, { visibility: 'team' })).status).toBe(200)
    expect(updatedAt()).not.toBe(before.at)
    expect(events()).toBe(before.events + 1)
  })
})

describe('activity feed', () => {
  it("keeps your own events when teammates' private runs flood the workspace", async () => {
    const asha = await signIn('asha')
    const { id } = await createRecipe(asha)
    const { seed } = app
    const sales = app.db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ?').pluck().get(seed.users.asha) as string
    for (let i = 0; i < 900; i++) {
      const actorId = i % 2 ? seed.users.vikram : seed.users.meera
      recordEvent(app.db, { workspaceId: sales, actorId, type: 'run.succeeded', workflowId: id, detail: { runId: `run_${i}`, versionNumber: 1 } })
    }
    const activity = (await asha.get('/api/dashboard')).body.activity as Array<{ text: string }>
    expect(activity.map((a) => a.text)).toContain('You created Regional revenue exceptions')
  })

  it('stops linking to results that were deleted', async () => {
    const asha = await signIn('asha')
    const { id, versionId } = await createRecipe(asha)
    const run = await asha.run(versionId, fixture('sales_A.csv'))
    expect(run.status).toBe(201)
    let item = (await asha.get('/api/dashboard')).body.activity.find((a: { runId: string | null }) => a.runId)
    expect(item).toMatchObject({ runId: run.body.id, workflowId: id })
    expect((await asha.del('/api/runs')).body.deleted).toBe(1)
    item = (await asha.get('/api/dashboard')).body.activity[0]
    expect(item.text).toBe('You ran Regional revenue exceptions v1 (result deleted)')
    expect(item.runId).toBeNull()
    expect(item.workflowId).toBe(id)
  })
})

describe('lists page instead of returning everything', () => {
  it('pages the library: limit, offset, total and nextOffset', async () => {
    const asha = await signIn('asha')
    for (let i = 0; i < 65; i++) await createRecipe(asha, `Recipe ${String(i).padStart(2, '0')}`)
    const first = (await asha.get('/api/workflows?scope=mine')).body
    expect(first.items).toHaveLength(60)
    expect(first).toMatchObject({ total: 65, nextOffset: 60, counts: { mine: 65 } })
    const second = (await asha.get('/api/workflows?scope=mine&offset=60')).body
    expect(second.items).toHaveLength(5)
    expect(second.nextOffset).toBeNull()
    // The order is total (updated_at, then id), so pages never overlap or skip.
    const titles = [...first.items, ...second.items].map((w: { title: string }) => w.title)
    expect(new Set(titles).size).toBe(65)
    // Bounds: at least 1, at most 200; junk falls back to the default page.
    expect((await asha.get('/api/workflows?scope=mine&limit=7')).body.items).toHaveLength(7)
    expect((await asha.get('/api/workflows?scope=mine&limit=0')).body.items).toHaveLength(1)
    expect((await asha.get('/api/workflows?scope=mine&limit=abc')).body.items).toHaveLength(60)
    expect((await asha.get('/api/workflows?scope=mine&limit=-5&offset=-1')).body.items).toHaveLength(60)
  })

  it('filters runs by status on the server and counts every run exactly', async () => {
    const asha = await signIn('asha')
    const { id, versionId } = await createRecipe(asha)
    for (let i = 0; i < 3; i++) expect((await asha.run(versionId, fixture('sales_A.csv'))).status).toBe(201)
    const failed = insertRun(app.db, { versionId, workflowId: id, runnerId: app.seed.users.asha, parameters: {}, inputName: 'x.csv', inputRows: 1 })
    finishRunFailed(app.db, failed, { code: 'EXECUTION_TIMEOUT', message: 'Too slow', durationMs: 30000 })

    const all = (await asha.get('/api/runs')).body
    expect(all.runs).toHaveLength(4)
    expect(all.counts).toEqual({ all: 4, running: 0, succeeded: 3, failed: 1 })
    const onlyFailed = (await asha.get('/api/runs?status=failed')).body
    expect(onlyFailed.runs.map((r: { id: string }) => r.id)).toEqual([failed])
    expect(onlyFailed.counts.all).toBe(4)
    const two = (await asha.get('/api/runs?status=succeeded&limit=2')).body
    expect(two.runs).toHaveLength(2)
    expect(two.counts.succeeded).toBe(3)
    // Unknown statuses are ignored rather than matching nothing.
    expect((await asha.get('/api/runs?status=bogus')).body.runs).toHaveLength(4)
    // Other people's runs never count.
    expect((await (await signIn('vikram')).get('/api/runs')).body.counts.all).toBe(0)
  })
})

describe('client address behind a proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const login = (email: string, password: string, headers: Record<string, string>) =>
    new Client().call('POST', '/api/auth/login', { json: { email, password }, headers })

  it('believes only the address the nearest proxy appended, so forged hops cannot dodge the sign-in throttle', async () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    // Caddy/nginx append the address they saw; everything before it is the client's own claim.
    for (let i = 0; i < 10; i++) {
      const res = await login('asha@demo.local', 'wrong-password', { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9`, 'fly-client-ip': `10.1.0.${i}` })
      expect(res.status).toBe(401)
    }
    const blocked = await login('asha@demo.local', PASSWORD, { 'x-forwarded-for': '10.9.9.9, 203.0.113.9' })
    expect(blocked.status).toBe(429)
    // Someone at another address is unaffected.
    expect((await login('asha@demo.local', PASSWORD, { 'x-forwarded-for': '198.51.100.7' })).status).toBe(200)
  })

  it('reads Fly-Client-IP only on Fly, and nothing forwarded unless told to', () => {
    const request = new Request(`${BASE}/api/health`, { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2', 'fly-client-ip': '3.3.3.3' } })
    vi.stubEnv('TRUST_PROXY', 'fly')
    expect(clientIp(request)).toBe('3.3.3.3')
    vi.stubEnv('TRUST_PROXY', 'true')
    expect(clientIp(request)).toBe('2.2.2.2')
    vi.stubEnv('TRUST_PROXY', '')
    expect(clientIp(request)).toBe('unknown')
  })
})

describe('health', () => {
  it('reports the version and schema state to anyone, and the version matches package.json', async () => {
    const res = await handleApi(new Request(`${BASE}/api/health`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok', version: APP_VERSION, schema: { migrations: 6, triggers: 15 } })
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(APP_VERSION)
  })
})
