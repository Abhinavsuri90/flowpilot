import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshApp, signIn, type Client } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL, REGIONAL_REVENUE_REQUEST } from '../src/lib/workflow/examples'
import { OUTPUT_JSON_SCHEMA } from '../src/server/ai/generate'
import { GENERATE_LIMITS, resetGenerateLimits } from '../src/server/ratelimit'

// The model is always stubbed: these tests prove the loop around it (schema,
// validation, one repair, outage handling), not the model's judgement.

const COLUMNS = ORIGINAL.input.columns

const GOOD = {
  kind: 'workflow',
  reason: null,
  question: null,
  parameters: [{ name: 'threshold', type: 'integer', integer_default: 100000, string_default: null, min: 0, max: 1000000000 }],
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value_kind: 'literal', literal_string: 'paid', literal_integer: null, parameter: null },
    { id: 's2', type: 'group_sum', group_by: 'region', value_column: 'amount', as: 'total' },
    { id: 's3', type: 'filter', column: 'total', operator: 'lt', value_kind: 'parameter', literal_string: null, literal_integer: null, parameter: 'threshold' },
  ],
}
// Filters on a column the group_sum already removed.
const BAD = { ...GOOD, steps: [GOOD.steps[0], GOOD.steps[1], { ...GOOD.steps[2], column: 'sales_rep' }] }

type Call = { url: string; body: any; headers: Record<string, string> }
let calls: Call[]
let app: Awaited<ReturnType<typeof freshApp>>
let asha: Client

function stubFetch(...responses: Array<(call: Call, init: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const call: Call = { url: String(url), body: JSON.parse(String(init.body ?? '{}')), headers: init.headers as Record<string, string> }
    calls.push(call)
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return next(call, init)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const anthropic = (input: unknown) => () =>
  Response.json({ id: 'msg_1', type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_${calls.length}`, name: 'submit_recipe', input }] })
const openai = (content: unknown) => () => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content), refusal: null } }] })

const generate = (request = REGIONAL_REVENUE_REQUEST) => asha.post('/api/generate', { request, columns: COLUMNS })

function counts() {
  const one = (sql: string) => app.db.prepare(sql).pluck().get() as number
  return {
    workflows: one('SELECT COUNT(*) FROM workflows'),
    versions: one('SELECT COUNT(*) FROM workflow_versions'),
    runs: one('SELECT COUNT(*) FROM runs'),
    events: one('SELECT COUNT(*) FROM events'),
  }
}

beforeEach(async () => {
  calls = []
  resetGenerateLimits()
  app = await freshApp()
  asha = await signIn('asha')
  // Hermetic: a developer's .env can never leak a real key into these tests.
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('OPENROUTER_API_KEY', '')
  vi.stubEnv('MODEL_PROVIDER', '')
  vi.stubEnv('MODEL_NAME', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AI authoring', () => {
  it('turns a valid forced tool call into the demo recipe, sending columns but never rows', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    stubFetch(anthropic(GOOD))
    const before = counts()
    const res = await generate()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kind: 'workflow', definition: ORIGINAL, provider: 'anthropic', model: 'claude-sonnet-5', repaired: false })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call!.headers['x-api-key']).toBe('test-key')
    expect(call!.body.tool_choice).toEqual({ type: 'tool', name: 'submit_recipe' })
    expect(call!.body.tools[0].input_schema).toEqual(OUTPUT_JSON_SCHEMA)
    expect(call!.body.messages[0].content).toBe(
      `Declared input columns (name: type):\n- status: text\n- region: text\n- sales_rep: text\n- amount: amount (whole INR)\n\nRequest: ${REGIONAL_REVENUE_REQUEST}`,
    )
    expect(JSON.stringify(call!.body)).not.toMatch(/O-101|60000|North/)
    expect(counts()).toEqual(before) // generation never writes
  })

  it('repairs exactly once, then returns 422 DRAFT_INVALID with the draft for the editor', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const fetchFn = stubFetch(anthropic(BAD), anthropic(BAD), anthropic(GOOD))
    const res = await generate()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('DRAFT_INVALID')
    expect(res.body.error.draft.steps[2]).toMatchObject({ id: 's3', column: 'sales_rep' })
    expect(res.body.error.issues[0]).toMatchObject({ stepId: 's3', path: 'steps[2].column' })

    const repair = calls[1]!.body.messages
    expect(repair).toHaveLength(3)
    expect(repair[1].role).toBe('assistant')
    expect(repair[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true })
    expect(repair[2].content[0].content).toContain('Column "sales_rep" is no longer available')
  })

  it('accepts a draft that the one repair fixed', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    stubFetch(anthropic(BAD), anthropic(GOOD))
    const res = await generate()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ kind: 'workflow', repaired: true })
    expect(res.body.definition).toEqual(ORIGINAL)
  })

  it('answers "unsupported" for Gmail and scheduling, and writes nothing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    stubFetch(anthropic({ kind: 'unsupported', reason: 'Recipes cannot send email or run on a schedule.', question: null, parameters: [], steps: [] }))
    const before = counts()
    const res = await generate('Email this report to my manager via Gmail every Monday.')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kind: 'unsupported', reason: 'Recipes cannot send email or run on a schedule.' })
    expect(counts()).toEqual(before)
    expect(calls[0]!.body.system).toMatch(/Gmail/)
  })

  it('uses strict json_schema for OpenAI and for OpenRouter', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
    vi.stubEnv('MODEL_NAME', 'gpt-test')
    stubFetch(openai(GOOD))
    const res = await generate()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ kind: 'workflow', provider: 'openai', model: 'gpt-test' })

    const body = calls[0]!.body
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0]!.headers.authorization).toBe('Bearer test-openai-key')
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'submit_recipe', strict: true } })
    // Strict mode: every object lists all its properties as required and allows nothing else.
    const walk = (node: any) => {
      if (node && typeof node === 'object') {
        if (node.type === 'object') {
          expect(node.additionalProperties).toBe(false)
          expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort())
        }
        Object.values(node).forEach(walk)
      }
    }
    walk(body.response_format.json_schema.schema)

    // OpenRouter: same OpenAI-compatible call, routed only to providers that honour strict output.
    calls = []
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('MODEL_NAME', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key')
    stubFetch(openai(GOOD))
    const routed = await generate()
    expect(routed.body).toMatchObject({ kind: 'workflow', provider: 'openrouter', model: 'openai/gpt-6-luna', definition: ORIGINAL })
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer test-openrouter-key', 'X-Title': 'FlowPilot' })
    expect(calls[0]!.body.provider).toEqual({ require_parameters: true })
    expect(calls[0]!.body.response_format.json_schema.strict).toBe(true)
  })

  it('reports a provider error or a 20-second timeout as 503 MODEL_UNAVAILABLE', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    stubFetch(() => new Response('overloaded', { status: 529 }))
    const failed = await generate()
    expect(failed.status).toBe(503)
    expect(failed.body.error.code).toBe('MODEL_UNAVAILABLE')
    expect(failed.body.error.message).toMatch(/HTTP 529.*Saved recipes still run/)

    vi.useFakeTimers()
    stubFetch(
      (_call, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = generate()
    await vi.advanceTimersByTimeAsync(20_001)
    const timedOut = await pending
    expect(timedOut.status).toBe(503)
    expect(timedOut.body.error.message).toMatch(/did not answer within 20 seconds/)
  })

  it('returns 503 without a key, calls no provider and writes nothing', async () => {
    const fetchFn = stubFetch(anthropic(GOOD))
    const before = counts()
    const res = await generate()
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('MODEL_UNAVAILABLE')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(counts()).toEqual(before)
    expect((await asha.get('/api/me')).body.model).toEqual({ available: false, provider: null, model: null })
  })

  it('limits drafts per person (they cost money) and tells them when to retry', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const fetchFn = stubFetch(anthropic(GOOD))
    for (let i = 0; i < GENERATE_LIMITS.perMinute; i++) expect((await generate()).status).toBe(200)
    const limited = await generate()
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(fetchFn).toHaveBeenCalledTimes(GENERATE_LIMITS.perMinute) // the limited call never reached the model
    const vikram = await signIn('vikram')
    expect((await vikram.post('/api/generate', { request: REGIONAL_REVENUE_REQUEST, columns: COLUMNS })).status).toBe(200)
  })

  it('runs saved recipes with no model at all, because the run path never imports the model client', async () => {
    const fetchFn = stubFetch(() => {
      throw new Error('no network')
    })
    const created = await asha.post('/api/workflows', { title: 'Regional revenue exceptions', definition: ORIGINAL })
    const run = await asha.run(created.body.version.id, fixture('sales_A.csv'))
    expect(run.status).toBe(201)
    expect(run.body.rows).toEqual([
      { region: 'South', total: 40000 },
      { region: 'West', total: 70000 },
    ])
    expect(fetchFn).not.toHaveBeenCalled()

    for (const file of ['src/server/api/runs.ts', 'src/lib/workflow/execute.ts', 'src/lib/csv.ts', 'src/lib/workflow/validate.ts', 'src/server/repo.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*\/ai\//)
    }
  })
})
