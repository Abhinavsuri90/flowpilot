import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleApi } from '../src/server/api/router'
import { metrics, resetMetrics, setLogSink, type LogLevel } from '../src/server/observability'
import { BASE, Client, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Request ids, structured logs and Prometheus metrics: every response can be tied
// to a log line, and the scrape counts requests by route pattern, never raw paths.

const METRICS_TOKEN = 'metrics-scraper-secret-0042'
let app: Awaited<ReturnType<typeof freshApp>>
let lines: Array<{ level: LogLevel; line: string }> = []

beforeEach(async () => {
  app = await freshApp()
  resetMetrics()
  lines = []
  setLogSink((line, level) => lines.push({ level, line }))
})

afterEach(() => {
  setLogSink(null)
  delete process.env.METRICS_TOKEN
  delete process.env.LOG_FORMAT
})

const REQUEST_ID = /^req_[0-9a-f]{16}$/

async function scrape(token: string | null = METRICS_TOKEN) {
  return new Client().call('GET', '/api/metrics', { headers: token ? { authorization: `Bearer ${token}` } : {} })
}

/** The value of one exact series line in a scrape, e.g. `flowpilot_users 4`. */
function sample(text: string, series: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `))
  return line === undefined ? undefined : Number(line.slice(series.length + 1))
}

describe('request ids', () => {
  it('stamps every response, including errors, OPTIONS and HEAD, and echoes the id in error bodies', async () => {
    const anon = new Client()
    const ok = await anon.get('/api/health')
    expect(ok.headers.get('x-request-id')).toMatch(REQUEST_ID)

    const missing = await anon.get('/api/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.body.error.requestId).toBe(missing.headers.get('x-request-id'))

    const wrongMethod = await anon.call('PUT', '/api/workflows')
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.body.error.requestId).toMatch(REQUEST_ID)

    expect((await anon.call('OPTIONS', '/api/workflows')).headers.get('x-request-id')).toMatch(REQUEST_ID)
    expect((await anon.call('HEAD', '/api/health')).headers.get('x-request-id')).toMatch(REQUEST_ID)
    // Two requests never share an id.
    expect((await anon.get('/api/health')).headers.get('x-request-id')).not.toBe(ok.headers.get('x-request-id'))
  })

  it('keeps an id a proxy already assigned when it is safe to log, and replaces anything else', async () => {
    const anon = new Client()
    const kept = await anon.call('GET', '/api/health', { headers: { 'x-request-id': 'edge-7f3a9c21.b' } })
    expect(kept.headers.get('x-request-id')).toBe('edge-7f3a9c21.b')
    for (const unsafe of ['short', 'has spaces in it', 'line\\nbreak-injection', 'x'.repeat(200), '"quoted-value"']) {
      const res = await anon.call('GET', '/api/health', { headers: { 'x-request-id': unsafe } })
      expect(res.headers.get('x-request-id')).toMatch(REQUEST_ID)
    }
  })
})

describe('metrics endpoint', () => {
  it('does not exist without METRICS_TOKEN, and needs that exact bearer token when set', async () => {
    const off = await scrape()
    expect(off.status).toBe(404)
    expect(off.body.error.code).toBe('NOT_FOUND')

    process.env.METRICS_TOKEN = METRICS_TOKEN
    const none = await scrape(null)
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe('Bearer realm="metrics"')
    expect((await scrape('metrics-scraper-secret-0043')).status).toBe(401)
    expect((await scrape(`${METRICS_TOKEN}x`)).status).toBe(401)

    const ok = await scrape()
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(ok.text).toMatch(/^# HELP flowpilot_http_requests_total /m)
    // A session doesn't open it: the scrape token is the only key.
    const asha = await signIn('asha')
    expect((await asha.get('/api/metrics')).status).toBe(401)
  })

  it('counts requests by method, route pattern and status, never by raw path', async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN
    const asha = await signIn('asha')
    const id = app.seed.examples.paid_by_rep
    expect((await asha.get(`/api/workflows/${id}`)).status).toBe(200)
    expect((await asha.get(`/api/workflows/${id}`)).status).toBe(200)
    expect((await asha.get('/api/workflows/wf_0000000000000000')).status).toBe(404)
    expect((await new Client().get('/api/invites/some-secret-invite-token-value')).status).toBe(404)
    // Arbitrary method names can't create new label values.
    expect((await handleApi(new Request(`${BASE}/api/health`, { method: 'BREW' }))).status).toBe(405)

    const text = (await scrape()).text
    expect(sample(text, 'flowpilot_http_requests_total{method="GET",route="/api/workflows/:id",status="200"}')).toBe(2)
    expect(sample(text, 'flowpilot_http_requests_total{method="GET",route="/api/workflows/:id",status="404"}')).toBe(1)
    expect(sample(text, 'flowpilot_http_requests_total{method="GET",route="/api/invites/:token",status="404"}')).toBe(1)
    expect(sample(text, 'flowpilot_http_requests_total{method="OTHER",route="/api/health",status="405"}')).toBe(1)
    expect(text).not.toContain(id)
    expect(text).not.toContain('some-secret-invite-token-value')

    // Histogram buckets are cumulative and end at +Inf = _count.
    const series = 'flowpilot_http_request_duration_seconds'
    const labels = 'method="GET",route="/api/workflows/:id"'
    const buckets = text
      .split('\n')
      .filter((l) => l.startsWith(`${series}_bucket{le=`) && l.includes('route="/api/workflows/:id"'))
      .map((l) => Number(l.split(' ').pop()))
    expect(buckets.length).toBe(12)
    expect(buckets).toEqual([...buckets].sort((a, b) => a - b))
    expect(buckets.at(-1)).toBe(3)
    expect(sample(text, `${series}_count{${labels}}`)).toBe(3)
    expect(sample(text, `${series}_sum{${labels}}`)).toBeGreaterThan(0)
  })

  it('counts sign-ins and runs, and reads current totals from the database', async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN
    const wrong = await new Client().post('/api/auth/login', { email: 'asha@demo.local', password: 'not her password' })
    expect(wrong.status).toBe(401)
    const asha = await signIn('asha')
    const created = await asha.post('/api/workflows', { title: 'Counted', definition: ORIGINAL })
    expect(created.status, created.text).toBe(201)
    expect((await asha.run(created.body.version.id, fixture('sales_A.csv'))).status).toBe(201)

    expect(metrics.signIns.value({ outcome: 'invalid' })).toBe(1)
    expect(metrics.signIns.value({ outcome: 'success' })).toBe(1)
    const text = (await scrape()).text
    expect(sample(text, 'flowpilot_recipe_runs_total{status="succeeded"}')).toBe(1)
    expect(sample(text, 'flowpilot_recipe_run_duration_seconds_count')).toBe(1)
    const users = app.db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number
    expect(sample(text, 'flowpilot_users')).toBe(users)
    const active = app.db.prepare('SELECT COUNT(*) FROM workflows WHERE archived_at IS NULL').pluck().get() as number
    expect(sample(text, 'flowpilot_recipes{state="active"}')).toBe(active)
    expect(sample(text, 'flowpilot_runs_stored{status="succeeded"}')).toBe(1)
    expect(sample(text, 'flowpilot_sessions_active')).toBeGreaterThanOrEqual(1)
    expect(text).toMatch(/^flowpilot_build_info\{node="v\d+\.\d+\.\d+",version="\d+\.\d+\.\d+"\} 1$/m)
    // Counts only: no names, emails or recipe titles.
    expect(text).not.toMatch(/asha|demo\.local|Counted/i)
  })
})

describe('structured logs', () => {
  it('writes one JSON line per request with the route pattern, status, timing, caller and request id', async () => {
    process.env.LOG_FORMAT = 'json'
    const asha = await signIn('asha')
    lines = []
    const res = await asha.get(`/api/workflows/${app.seed.examples.paid_by_rep}`)
    await new Client().get('/api/invites/another-secret-invite-token')

    const entries = lines.map((l) => JSON.parse(l.line) as Record<string, unknown>)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      level: 'info',
      msg: 'request',
      method: 'GET',
      route: '/api/workflows/:id',
      status: 200,
      requestId: res.headers.get('x-request-id'),
      userId: app.seed.users.asha,
      via: 'session',
    })
    expect(entries[0]!.durationMs).toEqual(expect.any(Number))
    expect(new Date(entries[0]!.time as string).toString()).not.toBe('Invalid Date')
    expect(entries[1]).toMatchObject({ route: '/api/invites/:token', status: 404, via: 'anonymous' })
    expect(lines.map((l) => l.line).join('\n')).not.toContain('another-secret-invite-token')
  })

  it('answers an unexpected failure with 500 and a reference, and logs the error under the same request id', async () => {
    const asha = await signIn('asha')
    lines = []
    app.db.exec('DROP TABLE api_tokens')
    const res = await asha.get('/api/me/tokens')
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    const requestId = res.headers.get('x-request-id')!
    expect(res.body.error.requestId).toBe(requestId)
    expect(res.body.error.message).toContain(requestId)
    // The cause is logged for the operator, never sent to the client.
    expect(res.text).not.toContain('api_tokens')
    const logged = lines.find((l) => l.level === 'error')
    expect(logged?.line).toContain(requestId)
    expect(logged?.line).toContain('no such table: api_tokens')
  })
})
