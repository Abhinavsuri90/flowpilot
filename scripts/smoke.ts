// End-to-end smoke test of every API endpoint and the important error codes,
// against any running FlowPilot (local or deployed):
//
//   npm run smoke                                  # http://localhost:3000
//   npm run smoke -- --base https://your-app.example.com
//   npm run smoke -- --ai                          # also spend one real AI draft
//   npm run smoke -- --metrics-token <token>       # also scrape /api/metrics (METRICS_TOKEN)
//
// It signs up two throwaway accounts (smoke-<time>@example.com), so the server
// needs REGISTRATION=open, and exits non-zero if any check fails.

import { base32Decode, totp } from '../src/server/totp'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const BASE = (option('base') ?? process.env.SMOKE_BASE ?? 'http://localhost:3000').replace(/\/+$/, '')
const STAMP = Date.now().toString(36)
const PASSWORD = `smoke test passphrase ${STAMP}`

type Result = { name: string; method: string; path: string; expected: string; got: string; ok: boolean; note?: string }
const results: Result[] = []

class Actor {
  cookie: string | null = null
  constructor(readonly label: string) {}

  async call(method: string, path: string, init: { json?: unknown; form?: FormData; headers?: Record<string, string>; origin?: string | null } = {}) {
    const headers: Record<string, string> = { ...init.headers }
    if (init.origin !== null) headers.origin = init.origin ?? BASE
    if (this.cookie) headers.cookie = this.cookie
    let body: BodyInit | undefined
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    } else if (init.form) body = init.form
    const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]!
      this.cookie = pair.endsWith('=') ? null : pair
    }
    const text = method === 'HEAD' ? '' : await res.text()
    let data: any
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return { status: res.status, headers: res.headers, text, data }
  }
}

type Response_ = Awaited<ReturnType<Actor['call']>>

/** Records one check: the status must match, and `extra` (if given) must hold. */
async function check(
  name: string,
  actor: Actor,
  method: string,
  path: string,
  expected: number | number[],
  init: Parameters<Actor['call']>[2] = {},
  extra?: (r: Response_) => string | true,
): Promise<Response_> {
  let r: Response_
  const allowed = Array.isArray(expected) ? expected : [expected]
  try {
    r = await actor.call(method, path, init)
  } catch (err) {
    results.push({ name, method, path, expected: allowed.join('/'), got: 'network error', ok: false, note: (err as Error).message })
    return { status: 0, headers: new Headers(), text: '', data: null }
  }
  const verdict = allowed.includes(r.status) ? (extra ? extra(r) : true) : `${r.data?.error?.code ?? ''} ${r.data?.error?.message ?? r.text.slice(0, 120)}`.trim()
  results.push({ name, method, path: path.replace(/[A-Za-z0-9_-]{30,}/g, '<token>'), expected: allowed.join('/'), got: String(r.status), ok: verdict === true, note: verdict === true ? undefined : verdict })
  return r
}

const code = (c: string) => (r: Response_) => (r.data?.error?.code === c ? true : `expected error code ${c}, got ${r.data?.error?.code}`)

const RECIPE = {
  schemaVersion: 1,
  input: { format: 'csv', columns: { status: 'string', region: 'string', sales_rep: 'string', amount: 'integer_inr' } },
  parameters: { top_n: { type: 'integer', default: 2, min: 1, max: 20 } },
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value: { literal: 'paid' } },
    { id: 's2', type: 'aggregate', groupBy: ['sales_rep'], measures: [{ op: 'sum', column: 'amount', as: 'revenue' }, { op: 'count', as: 'orders' }] },
    { id: 's3', type: 'sort', by: [{ column: 'revenue', direction: 'desc' }] },
    { id: 's4', type: 'limit', rows: { parameter: 'top_n' } },
    { id: 's5', type: 'select', columns: [{ column: 'sales_rep', as: 'Sales rep' }, { column: 'revenue', as: 'Paid revenue' }, { column: 'orders' }] },
  ],
  output: { format: 'table' },
}
const CSV = 'order_id,region,sales_rep,status,amount\nO-1,North,Asha,paid,60000\nO-2,North,Asha,paid,50000\nO-3,South,Vikram,paid,40000\nO-4,South,Vikram,refunded,90000\n'

function upload(versionId: string, content: BlobPart, parameters?: Record<string, unknown>) {
  const form = new FormData()
  form.set('versionId', versionId)
  form.set('file', new Blob([content], { type: 'text/csv' }), 'smoke.csv')
  if (parameters) form.set('parameters', JSON.stringify(parameters))
  return form
}

async function main() {
  console.log(`FlowPilot smoke test → ${BASE}\n`)
  const anon = new Actor('anonymous')
  const sam = new Actor('sam')
  const bot = new Actor('bot') // a script: bearer token, no cookie, no Origin
  const ria = new Actor('ria')
  const samEmail = `smoke-sam-${STAMP}@example.com`
  const riaEmail = `smoke-ria-${STAMP}@example.com`

  // ----- the server and the HTTP layer
  await check('health', anon, 'GET', '/api/health', 200, {}, (r) => (r.data?.status === 'ok' ? true : 'status is not ok'))
  await check('security headers', anon, 'GET', '/api/health', 200, {}, (r) =>
    r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(r.headers.get('cache-control') ?? '')
      ? true
      : 'missing X-Frame-Options / nosniff / no-store',
  )
  await check('HEAD like GET', anon, 'HEAD', '/api/health', 200)
  await check('request id on every response', anon, 'GET', '/api/does-not-exist', 404, {}, (r) =>
    r.headers.get('x-request-id') && r.data?.error?.requestId === r.headers.get('x-request-id') ? true : 'no X-Request-Id, or the error body lacks it',
  )
  await check('metrics need the scrape token (404 when off)', anon, 'GET', '/api/metrics', [401, 404])
  const metricsToken = option('metrics-token') ?? process.env.METRICS_TOKEN
  if (metricsToken) {
    await check('metrics with the scrape token', anon, 'GET', '/api/metrics', 200, { headers: { authorization: `Bearer ${metricsToken}` } }, (r) =>
      /^flowpilot_build_info\{/m.test(r.text) && /text\/plain; version=0\.0\.4/.test(r.headers.get('content-type') ?? '') ? true : 'not a Prometheus scrape',
    )
  }
  await check('OPTIONS lists methods', anon, 'OPTIONS', '/api/workflows', 204, {}, (r) => (/GET/.test(r.headers.get('allow') ?? '') ? true : 'no Allow header'))
  await check('other methods → 405', anon, 'PUT', '/api/workflows', 405, {}, code('METHOD_NOT_ALLOWED'))
  await check('unknown endpoint → 404', anon, 'GET', '/api/does-not-exist', 404, {}, code('NOT_FOUND'))
  await check('signed out → 401', anon, 'GET', '/api/me', 401, {}, code('UNAUTHENTICATED'))
  await check('cross-site write → 403', anon, 'POST', '/api/auth/login', 403, { json: { email: 'x@example.com', password: 'x' }, origin: 'https://evil.example' }, code('BAD_ORIGIN'))
  await check('wrong password → 401', anon, 'POST', '/api/auth/login', 401, { json: { email: samEmail, password: 'not the password' } }, code('INVALID_CREDENTIALS'))
  await check('login needs JSON → 415', anon, 'POST', '/api/auth/login', 415, { headers: { 'content-type': 'text/plain' } })

  // ----- accounts
  const signup = await check('sign up (new workspace)', sam, 'POST', '/api/auth/register', 201, {
    json: { name: 'Smoke Sam', email: samEmail, password: PASSWORD, workspaceName: `Smoke ${STAMP}` },
  })
  if (signup.status === 403) {
    console.log('\nSign-ups are closed or invite-only on this server; set REGISTRATION=open to run the smoke test.')
    process.exit(2)
  }
  await check('email taken → 409', anon, 'POST', '/api/auth/register', 409, { json: { name: 'Dup', email: samEmail, password: PASSWORD, workspaceName: 'Dup Co' } }, code('EMAIL_TAKEN'))
  await check('weak password → 422', anon, 'POST', '/api/auth/register', 422, { json: { name: 'Weak', email: `weak-${STAMP}@example.com`, password: 'password123', workspaceName: 'Weak Co' } })
  await check('sign in', sam, 'POST', '/api/auth/login', 200, { json: { email: samEmail, password: PASSWORD } })
  await check('me', sam, 'GET', '/api/me', 200, {}, (r) => (r.data?.workspace?.role === 'admin' ? true : 'not admin of the new workspace'))
  await check('rename me', sam, 'PATCH', '/api/me', 200, { json: { name: 'Smoke Sam Patel' } })
  await check('my sessions', sam, 'GET', '/api/me/sessions', 200, {}, (r) => (r.data?.sessions?.some((s: { current: boolean }) => s.current) ? true : 'no current session'))
  const minted = await check('create an API token', sam, 'POST', '/api/me/tokens', 201, { json: { name: 'smoke script', expiresInDays: 30 } }, (r) =>
    typeof r.data?.secret === 'string' && r.data.secret.startsWith('fp_') ? true : 'no fp_ secret',
  )
  const bearer = { authorization: `Bearer ${minted.data?.secret ?? 'none'}` }
  await check('token: me (no cookie, no Origin)', bot, 'GET', '/api/me', 200, { headers: bearer, origin: null })
  await check('token: list recipes', bot, 'GET', '/api/workflows?scope=mine', 200, { headers: bearer, origin: null })
  await check('token can’t manage tokens → 403', bot, 'POST', '/api/me/tokens', 403, { headers: bearer, origin: null, json: { name: 'x' } }, code('SESSION_REQUIRED'))
  await check('list tokens (prefix only)', sam, 'GET', '/api/me/tokens', 200, {}, (r) => (r.data?.tokens?.length === 1 && !('secret' in r.data.tokens[0]) ? true : 'expected one token without its secret'))
  await check('revoke the token', sam, 'DELETE', `/api/me/tokens/${minted.data?.token?.id ?? 'none'}`, 200)
  await check('revoked token → 401', bot, 'GET', '/api/me', 401, { headers: bearer, origin: null })
  // two-step sign-in: on with the password and a first code, then a code at every sign-in
  await check('two-step status', sam, 'GET', '/api/me/two-factor', 200, {}, (r) => (r.data?.enabled === false && r.data?.available === true ? true : 'expected off and available'))
  const setup = await check('two-step setup (QR secret)', sam, 'POST', '/api/me/two-factor/setup', 200, {}, (r) => (/^otpauth:\/\/totp\//.test(r.data?.uri ?? '') ? true : 'no otpauth uri'))
  const secret = base32Decode(String(setup.data?.secret ?? ''))
  await check('two-step on needs a correct code → 422', sam, 'POST', '/api/me/two-factor/enable', 422, { json: { password: PASSWORD, code: '000000' } }, code('INVALID_CODE'))
  const enabled = await check('two-step on (password + first code)', sam, 'POST', '/api/me/two-factor/enable', 200, { json: { password: PASSWORD, code: totp(secret) } }, (r) =>
    r.data?.recoveryCodes?.length === 10 ? true : 'expected ten recovery codes',
  )
  const recovery = (enabled.data?.recoveryCodes ?? []) as string[]
  const phone = new Actor('phone')
  const pending = await check('password alone → challenge, no session', phone, 'POST', '/api/auth/login', 200, { json: { email: samEmail, password: PASSWORD } }, (r) =>
    r.data?.twoFactor?.challenge && !r.headers.get('set-cookie') ? true : 'expected a challenge and no cookie',
  )
  const challenge = String(pending.data?.twoFactor?.challenge ?? '')
  await check('wrong code → 401', phone, 'POST', '/api/auth/two-factor', 401, { json: { challenge, code: '000000' } }, code('INVALID_CODE'))
  await check('recovery code signs in', phone, 'POST', '/api/auth/two-factor', 200, { json: { challenge, code: recovery[0] ?? '' } }, (r) =>
    r.data?.recoveryCodesLeft === 9 ? true : `expected 9 codes left, got ${r.data?.recoveryCodesLeft}`,
  )
  await check('spent challenge → 401', phone, 'POST', '/api/auth/two-factor', 401, { json: { challenge, code: recovery[1] ?? '' } }, code('CHALLENGE_EXPIRED'))
  await check('two-step off (password + a code)', sam, 'POST', '/api/me/two-factor/disable', 200, { json: { password: PASSWORD, code: recovery[1] ?? '' } })
  await check('password change needs the current one', sam, 'POST', '/api/me/password', 422, { json: { currentPassword: 'wrong wrong wrong', newPassword: 'another long passphrase' } })
  await check('forgot password (same answer for anyone)', anon, 'POST', '/api/auth/forgot', 200, { json: { email: `nobody-${STAMP}@example.com` } })
  await check('dead reset link → 404', anon, 'GET', '/api/auth/reset/not-a-real-token', 404, {}, code('RESET_INVALID'))
  await check('reset with a dead link → 404', anon, 'POST', '/api/auth/reset', 404, { json: { token: 'not-a-real-token', password: 'another long passphrase' } })

  // ----- workspace, invitations, a second person
  await check('workspace', sam, 'GET', '/api/workspace', 200)
  await check('rename workspace', sam, 'PATCH', '/api/workspace', 200, { json: { name: `Smoke team ${STAMP}` } })
  await check('workspace time zone', sam, 'PATCH', '/api/workspace', 200, { json: { timeZone: 'Asia/Kolkata' } }, (r) =>
    r.data?.workspace?.timeZone === 'Asia/Kolkata' ? true : `got ${r.data?.workspace?.timeZone}`,
  )
  await check('unknown time zone → 422', sam, 'PATCH', '/api/workspace', 422, { json: { timeZone: 'Mars/Olympus' } })
  const invite = await check('create invite link', sam, 'POST', '/api/workspace/invites', 201, { json: { role: 'member' } })
  const token = String(invite.data?.link ?? '').split('/invite/')[1] ?? 'missing'
  await check('list invites', sam, 'GET', '/api/workspace/invites', 200)
  await check('invite landing (public)', anon, 'GET', `/api/invites/${token}`, 200, {}, (r) => (r.data?.role === 'member' ? true : 'wrong role'))
  const joined = await check('sign up through the invite', ria, 'POST', '/api/auth/register', 201, { json: { name: 'Smoke Ria', email: riaEmail, password: PASSWORD, inviteToken: token } })
  const riaId = joined.data?.user?.id as string
  const revokeMe = await check('second invite', sam, 'POST', '/api/workspace/invites', 201, { json: { role: 'viewer' } })
  await check('revoke invite', sam, 'DELETE', `/api/workspace/invites/${revokeMe.data?.invite?.id}`, 200)
  await check('revoked link → 404', anon, 'GET', `/api/invites/${String(revokeMe.data?.link ?? '').split('/invite/')[1]}`, 404, {}, code('INVITE_INVALID'))
  await check('member can’t invite → 403', ria, 'POST', '/api/workspace/invites', 403, { json: { role: 'viewer' } })
  await check('change a role', sam, 'PATCH', `/api/workspace/members/${riaId}`, 200, { json: { role: 'viewer' } })
  await check('change it back', sam, 'PATCH', `/api/workspace/members/${riaId}`, 200, { json: { role: 'member' } })
  const second = await check('create a second workspace', sam, 'POST', '/api/workspaces', 201, { json: { name: `Smoke side ${STAMP}` } })
  const side = second.data?.workspace?.workspaceId as string
  const sideInvite = await check('invite into it', sam, 'POST', '/api/workspace/invites', 201, { json: { role: 'viewer' } })
  await check('accept as an existing account', ria, 'POST', `/api/invites/${String(sideInvite.data?.link ?? '').split('/invite/')[1]}/accept`, 200)
  await check('leave it again', ria, 'POST', '/api/workspace/leave', 200)
  const first = second.data?.memberships?.find((m: { workspaceId: string }) => m.workspaceId !== side)?.workspaceId
  await check('switch workspace', sam, 'POST', '/api/me/workspace', 200, { json: { workspaceId: first } })

  // ----- recipes
  await check('invalid recipe → 422', sam, 'POST', '/api/workflows', 422, { json: { title: 'Broken', definition: { ...RECIPE, steps: [{ id: 's1', type: 'sql' }] } } })
  const created = await check('create recipe', sam, 'POST', '/api/workflows', 201, { json: { title: `Smoke top reps ${STAMP}`, definition: RECIPE } })
  const wf = created.data?.workflow?.id as string
  let versionId = created.data?.version?.id as string
  await check('list recipes', sam, 'GET', '/api/workflows?scope=mine&limit=5', 200, {}, (r) => (r.data?.total >= 1 ? true : 'empty list'))
  await check('recipe detail', sam, 'GET', `/api/workflows/${wf}`, 200)
  await check('share with the team', sam, 'PATCH', `/api/workflows/${wf}`, 200, { json: { visibility: 'team' } })
  const v2 = await check('save version 2', sam, 'POST', `/api/workflows/${wf}/versions`, 201, { json: { definition: RECIPE } })
  versionId = (v2.data?.version?.id as string) ?? versionId
  await check('who has access', sam, 'GET', `/api/workflows/${wf}/access`, 200)
  await check('teammate makes a copy', ria, 'POST', `/api/workflows/${wf}/fork`, 201, { json: { versionId, title: 'Ria copy' } })
  await check('hand it over', sam, 'POST', `/api/workflows/${wf}/transfer`, 200, { json: { userId: riaId } })
  await check('and back', ria, 'POST', `/api/workflows/${wf}/transfer`, 200, { json: { userId: signup.data?.user?.id } })
  await check('archive', sam, 'PATCH', `/api/workflows/${wf}`, 200, { json: { archived: true } })
  await check('archived can’t run → 409', ria, 'POST', '/api/runs', 409, { form: upload(versionId, CSV) }, code('RECIPE_ARCHIVED'))
  await check('restore', sam, 'PATCH', `/api/workflows/${wf}`, 200, { json: { archived: false } })
  await check('missing recipe → 404', sam, 'GET', '/api/workflows/wf_0000000000000000', 404)

  // ----- runs
  const run = await check('run on a file', sam, 'POST', '/api/runs', 201, { form: upload(versionId, CSV, { top_n: 1 }) }, (r) =>
    JSON.stringify(r.data?.rows) === JSON.stringify([{ 'Sales rep': 'Asha', 'Paid revenue': 110000, orders: 2 }]) ? true : `unexpected rows ${JSON.stringify(r.data?.rows)}`,
  )
  const latin1 = new Uint8Array([...new TextEncoder().encode('order_id,region,sales_rep,status,amount\nO-1,Montr'), 0xe9, ...new TextEncoder().encode('al,Asha,paid,1\n')])
  await check('non-UTF-8 file → 422', sam, 'POST', '/api/runs', 422, { form: upload(versionId, latin1) }, code('INVALID_FILE'))
  await check('bad parameter → 422', sam, 'POST', '/api/runs', 422, { form: upload(versionId, CSV, { top_n: 0 }) }, code('PARAMETERS_INVALID'))
  await check('over 1 MiB → 413', sam, 'POST', '/api/runs', 413, { form: upload(versionId, 'x'.repeat(1024 * 1024 + 10)) })
  await check('my runs by status', sam, 'GET', '/api/runs?status=succeeded', 200, {}, (r) => (r.data?.counts?.succeeded >= 1 ? true : 'no succeeded count'))
  await check('run detail', sam, 'GET', `/api/runs/${run.data?.id}`, 200)
  await check('someone else’s run → 404', ria, 'GET', `/api/runs/${run.data?.id}`, 404)
  await check('download CSV', sam, 'GET', `/api/runs/${run.data?.id}/csv`, 200, {}, (r) => (r.text.startsWith('Sales rep,Paid revenue,orders') ? true : 'unexpected CSV header'))
  await check('delete my results', sam, 'DELETE', '/api/runs', 200)

  // ----- the rest
  await check('dashboard', sam, 'GET', '/api/dashboard', 200)
  await check('system design data', sam, 'GET', '/api/system', 200)
  await check('audit log (admin)', sam, 'GET', '/api/workspace/audit?limit=20', 200, {}, (r) => (r.data?.entries?.length ? true : 'empty audit log'))
  await check('audit CSV (admin)', sam, 'GET', '/api/workspace/audit.csv', 200, {}, (r) => (r.text.startsWith('time_utc,actor') ? true : 'unexpected CSV'))
  await check('audit log is admin-only → 403', ria, 'GET', '/api/workspace/audit', 403)
  const status = (await sam.call('GET', '/api/me')).data?.model
  if (!status?.available) {
    await check('AI draft without a model → 503', sam, 'POST', '/api/generate', 503, { json: { request: 'Total paid amount by region.', columns: RECIPE.input.columns } }, code('MODEL_UNAVAILABLE'))
  } else if (flag('ai')) {
    await check('AI draft', sam, 'POST', '/api/generate', 200, { json: { request: 'Top 2 sales reps by paid revenue.', columns: RECIPE.input.columns } }, (r) =>
      r.data?.kind === 'workflow' ? true : `got ${r.data?.kind}`,
    )
  } else {
    await check('AI draft request is validated → 422', sam, 'POST', '/api/generate', 422, { json: { request: '', columns: RECIPE.input.columns } })
  }
  await check('remove a member', sam, 'DELETE', `/api/workspace/members/${riaId}`, 200)
  await check('sign out other devices', sam, 'DELETE', '/api/me/sessions', 200)
  await check('sign out', sam, 'POST', '/api/auth/logout', 200)
  await check('signed out afterwards → 401', sam, 'GET', '/api/me', 401)

  // ----- report
  const width = Math.max(...results.map((r) => r.name.length))
  for (const r of results) {
    const line = `${r.ok ? '✓' : '✗'} ${r.name.padEnd(width)}  ${r.method.padEnd(7)} ${r.path.padEnd(44)} ${r.expected} → ${r.got}`
    console.log(r.ok ? line : `${line}   ${r.note ?? ''}`)
  }
  const failed = results.filter((r) => !r.ok).length
  const endpoints = new Set(results.map((r) => `${r.method} ${r.path.replace(/\/(wf|run|inv|usr|ws|tok)_[0-9a-f]{16}/g, '/:id').replace(/\?.*$/, '')}`)).size
  console.log(`\n${results.length - failed}/${results.length} checks passed across ${endpoints} method + path combinations${failed ? ` · ${failed} FAILED` : ''}`)
  process.exit(failed ? 1 : 0)
}

await main()

export {}
