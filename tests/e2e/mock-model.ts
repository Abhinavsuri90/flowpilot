// A stand-in for the Anthropic Messages API, used only by the browser tests so
// "Generate steps" can be exercised without a real key. It answers the demo
// sentence with the demo recipe, "top N" requests with a summary + sort +
// keep-first recipe, email/Gmail requests with "unsupported", and anything else
// with a clarification question. Point the app at it with
// ANTHROPIC_BASE_URL=http://localhost:4010 and a dummy ANTHROPIC_API_KEY.
import { createServer } from 'node:http'

const port = Number(process.env.MOCK_MODEL_PORT ?? 4010)

const DEMO = {
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

// Always invalid: filters on a column the group_sum already removed.
const BROKEN = {
  ...DEMO,
  steps: [DEMO.steps[0], DEMO.steps[1], { ...DEMO.steps[2], column: 'sales_rep' }],
}

// "Top 2 sales reps by paid revenue": the v2 steps, in the flat shape the real model uses.
const TOP_REPS = {
  kind: 'workflow',
  reason: null,
  question: null,
  parameters: [],
  steps: [
    { id: 's1', type: 'filter', column: 'status', operator: 'eq', value_kind: 'literal', literal_string: 'paid', literal_integer: null, parameter: null, list: null },
    {
      id: 's2',
      type: 'aggregate',
      group_by: ['sales_rep'],
      measures: [
        { op: 'sum', column: 'amount', as: 'revenue' },
        { op: 'count', column: null, as: 'orders' },
      ],
    },
    { id: 's3', type: 'sort', by: [{ column: 'revenue', direction: 'desc' }] },
    { id: 's4', type: 'limit', rows_kind: 'literal', rows_integer: 2, parameter: null },
  ],
}

function answer(prompt: string) {
  if (/broken draft/i.test(prompt)) return BROKEN
  if (/\btop\b/i.test(prompt)) return TOP_REPS
  if (/gmail|e-?mail|slack|schedule|every monday/i.test(prompt)) {
    return {
      kind: 'unsupported',
      reason: 'Recipes cannot send email or run on a schedule; they only filter and total the rows of a file you upload.',
      question: null,
      parameters: [],
      steps: [],
    }
  }
  if (/paid/i.test(prompt) && /region/i.test(prompt)) return DEMO
  return { kind: 'clarification', reason: null, question: 'Which column should the totals be grouped by?', parameters: [], steps: [] }
}

createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url?.endsWith('/v1/messages')) {
      res.writeHead(404).end()
      return
    }
    const payload = JSON.parse(body || '{}') as { model?: string; messages?: Array<{ content: unknown }> }
    const first = payload.messages?.[0]?.content
    const input = answer(typeof first === 'string' ? first : '')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: payload.model,
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_mock', name: 'submit_recipe', input }],
      }),
    )
  })
}).listen(port, () => console.log(`[mock-model] listening on http://localhost:${port}`))
