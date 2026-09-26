import { beforeEach, describe, expect, it } from 'vitest'
import { Client, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { createApiToken } from '../src/server/accounts'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Personal API tokens: minted in a browser session, shown once, hashed at rest,
// usable by scripts without cookies or an Origin header, and never able to touch
// account, security or membership settings.

const PASSWORD = 'a long enough passphrase 42'
let app: Awaited<ReturnType<typeof freshApp>>

beforeEach(async () => {
  app = await freshApp()
})

async function newAccount(email = 'sam@acme.test') {
  const client = new Client()
  const res = await client.post('/api/auth/register', { name: 'Sam Patel', email, password: PASSWORD, workspaceName: 'Acme Finance' })
  expect(res.status, res.text).toBe(201)
  return client
}

/** A script: bearer token, no cookie, no Origin header (what curl sends). */
class Script extends Client {
  constructor(private readonly secret: string) {
    super()
  }
  override call<T = any>(method: string, path: string, opts: Parameters<Client['call']>[2] = {}) {
    return super.call<T>(method, path, { ...opts, headers: { origin: '', authorization: `Bearer ${this.secret}`, ...opts.headers } })
  }
}

describe('personal API tokens', () => {
  it('mints a token shown once, lists only its prefix, and lets a script work without cookies or an Origin', async () => {
    const sam = await newAccount()
    const minted = await sam.post('/api/me/tokens', { name: 'nightly-report', expiresInDays: 30 })
    expect(minted.status, minted.text).toBe(201)
    const secret: string = minted.body.secret
    expect(secret).toMatch(/^fp_[A-Za-z0-9_-]{40,}$/)
    expect(minted.body.token).toMatchObject({ name: 'nightly-report', prefix: `${secret.slice(0, 11)}…`, lastUsedAt: null, expired: false })
    // Only a hash is stored.
    const stored = app.db.prepare('SELECT token_hash FROM api_tokens').pluck().get() as string
    expect(stored).toHaveLength(64)
    expect(stored).not.toContain(secret.slice(3, 20))
    const listed = await sam.get('/api/me/tokens')
    expect(listed.body.tokens).toHaveLength(1)
    expect(listed.body.tokens[0]).not.toHaveProperty('secret')

    const bot = new Script(secret)
    const me = await bot.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('sam@acme.test')
    expect(me.body.workspace.workspaceName).toBe('Acme Finance')
    // Writes work without an Origin header (a script isn't a cross-site browser request).
    const created = await bot.post('/api/workflows', { title: 'From a script', definition: ORIGINAL })
    expect(created.status, created.text).toBe(201)
    const run = await bot.run(created.body.version.id, fixture('sales_A.csv'))
    expect(run.status, run.text).toBe(201)
    expect(run.body.rowCount).toBe(2)
    expect((await sam.get('/api/me/tokens')).body.tokens[0].lastUsedAt).not.toBeNull()
  })

  it('refuses account, security and membership changes from a token, and tokens for demo accounts', async () => {
    const sam = await newAccount()
    const bot = new Script((await sam.post('/api/me/tokens', { name: 'ci' })).body.secret)
    for (const [method, path, json] of [
      ['POST', '/api/me/tokens', { name: 'escalate' }],
      ['GET', '/api/me/tokens', undefined],
      ['PATCH', '/api/me', { name: 'Someone else' }],
      ['POST', '/api/me/password', { currentPassword: PASSWORD, newPassword: 'another long passphrase 42' }],
      ['GET', '/api/me/sessions', undefined],
      ['DELETE', '/api/me/sessions', undefined],
      ['POST', '/api/workspaces', { name: 'Shadow' }],
      ['POST', '/api/workspace/invites', { role: 'admin' }],
    ] as const) {
      const res = await bot.call(method, path, json ? { json } : {})
      expect(res.status, `${method} ${path}`).toBe(403)
      expect(res.body.error.code, `${method} ${path}`).toBe('SESSION_REQUIRED')
    }
    // Reading and running are fine; so is the workspace overview.
    expect((await bot.get('/api/workspace')).status).toBe(200)
    expect((await bot.get('/api/dashboard')).status).toBe(200)

    const asha = await signIn('asha')
    const demo = await asha.post('/api/me/tokens', { name: 'demo' })
    expect(demo.status).toBe(403)
    expect(demo.body.error.message).toContain('Demo accounts can’t create API tokens')
  })

  it('stops working once revoked or expired, ignores junk, and caps how many you hold', async () => {
    const sam = await newAccount()
    const userId = (await sam.get('/api/me')).body.user.id as string
    const minted = await sam.post('/api/me/tokens', { name: 'short-lived' })
    const bot = new Script(minted.body.secret)
    expect((await bot.get('/api/me')).status).toBe(200)
    expect((await sam.del(`/api/me/tokens/${minted.body.token.id}`)).body).toEqual({ revoked: true })
    expect((await bot.get('/api/me')).status).toBe(401)
    expect((await sam.del(`/api/me/tokens/${minted.body.token.id}`)).status).toBe(404)
    expect((await sam.get('/api/me/tokens')).body.tokens).toHaveLength(0)

    const old = createApiToken(app.db, userId, { name: 'forgotten', expiresInDays: 30, now: Date.now() - 31 * 24 * 60 * 60 * 1000 })
    expect((await new Script(old.secret).get('/api/me')).status).toBe(401)
    expect((await sam.get('/api/me/tokens')).body.tokens[0]).toMatchObject({ name: 'forgotten', expired: true })

    for (const junk of ['Bearer nope', 'Bearer fp_not-a-real-token', 'Basic abc', 'Bearer']) {
      const res = await new Client().call('GET', '/api/me', { headers: { authorization: junk, origin: '' } })
      expect(res.status, junk).toBe(401)
    }

    expect((await sam.post('/api/me/tokens', { name: 'x'.repeat(61) })).status).toBe(422)
    expect((await sam.post('/api/me/tokens', { name: 'weird expiry', expiresInDays: 7 })).status).toBe(422)
    for (let i = 0; i < 10; i++) expect((await sam.post('/api/me/tokens', { name: `t${i}` })).status).toBe(201)
    const eleventh = await sam.post('/api/me/tokens', { name: 'one too many' })
    expect(eleventh.status).toBe(422)
    expect(eleventh.body.error.code).toBe('TOKEN_LIMIT')
  })

  it('works in your first workspace unless X-Workspace-Id names another you belong to', async () => {
    const sam = await newAccount()
    const second = await sam.post('/api/workspaces', { name: 'Acme Ops' })
    expect(second.status, second.text).toBe(201)
    const secondId: string = second.body.workspace?.workspaceId ?? second.body.workspaceId ?? second.body.workspace?.id
    const bot = new Script((await sam.post('/api/me/tokens', { name: 'ops' })).body.secret)
    expect((await bot.get('/api/me')).body.workspace.workspaceName).toBe('Acme Finance')
    const inOps = await bot.call('GET', '/api/me', { headers: { 'x-workspace-id': secondId } })
    expect(inOps.body.workspace.workspaceId).toBe(secondId)
    const elsewhere = await bot.call('GET', '/api/me', { headers: { 'x-workspace-id': app.seed.workspaces.Sales } })
    expect(elsewhere.body.workspace.workspaceName).toBe('Acme Finance')
  })
})
