import { z } from 'zod'
import { modelConfig, type ModelConfig } from './config'
import { ApiError } from '../http'
import { validateDefinition } from '../../lib/workflow/validate'
import { AGGREGATE_OPS, COLUMN_TYPE_LABEL, DATE_PARTS, DATE_UNITS, LIMITS, OPERATORS, type Column, type ColumnType, type Step, type WorkflowDefinition } from '../../lib/workflow/schema'
import { columnsAfter } from '../../lib/workflow/columns'
import type { ApiIssue, GenerateResult } from '../../lib/types'

// One server-side model call drafts parameters and steps for columns the author
// already declared. The server builds the definition with the author's input
// contract, validates it independently, allows one repair, and never saves or
// runs anything. Nothing on the run path imports this module.

// ----- Output schema: flat, with nullable fields, so both providers' strict modes accept it.

const nullable = (type: string) => ({ type: [type, 'null'] })

export const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'reason', 'question', 'parameters', 'steps'],
  properties: {
    kind: { type: 'string', enum: ['workflow', 'unsupported', 'clarification'] },
    reason: { ...nullable('string'), description: 'For kind "unsupported": one sentence saying why.' },
    question: { ...nullable('string'), description: 'For kind "clarification": one short question.' },
    parameters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'integer_default', 'string_default', 'date_default', 'min', 'max'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['integer', 'string', 'date'] },
          integer_default: nullable('integer'),
          string_default: nullable('string'),
          date_default: { ...nullable('string'), description: 'For type "date": the default day as YYYY-MM-DD.' },
          min: nullable('integer'),
          max: nullable('integer'),
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'column', 'operator', 'value_kind', 'literal_string', 'literal_integer', 'parameter', 'list', 'relative_unit', 'relative_offset', 'relative_edge'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['filter'] },
              column: { type: 'string' },
              operator: { type: 'string', enum: [...OPERATORS] },
              value_kind: { type: 'string', enum: ['literal', 'parameter', 'list', 'relative'] },
              literal_string: { ...nullable('string'), description: 'Text values, and fixed dates as YYYY-MM-DD.' },
              literal_integer: nullable('integer'),
              parameter: nullable('string'),
              list: { type: ['array', 'null'], items: { type: 'string' }, description: 'For operator "in" (value_kind "list"): the values to keep.' },
              relative_unit: { ...nullable('string'), description: `For value_kind "relative" on a date column: one of ${DATE_UNITS.join(', ')}.` },
              relative_offset: { ...nullable('integer'), description: 'For value_kind "relative": 0 = this, -1 = last, 1 = next, -30 = 30 units ago.' },
              relative_edge: { ...nullable('string'), description: 'For value_kind "relative": "start" or "end" of that day, week, month, quarter or year.' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'group_by', 'value_column', 'as'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['group_sum'] },
              group_by: { type: 'string' },
              value_column: { type: 'string' },
              as: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'group_by', 'measures'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['aggregate'] },
              group_by: { type: 'array', items: { type: 'string' }, description: 'Zero to three text or whole-number columns; empty for one summary row.' },
              measures: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['op', 'column', 'as'],
                  properties: {
                    op: { type: 'string', enum: [...AGGREGATE_OPS] },
                    column: { ...nullable('string'), description: 'null for count; an amount or whole-number column otherwise.' },
                    as: { type: 'string' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'by'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['sort'] },
              by: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['column', 'direction'],
                  properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'rows_kind', 'rows_integer', 'parameter'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['limit'] },
              rows_kind: { type: 'string', enum: ['literal', 'parameter'] },
              rows_integer: nullable('integer'),
              parameter: nullable('string'),
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'column', 'part', 'as'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['date_part'] },
              column: { type: 'string', description: 'A date column.' },
              part: { type: 'string', enum: [...DATE_PARTS] },
              as: { type: 'string', description: 'The new text column, e.g. "month".' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'columns'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['select'] },
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['column', 'as'],
                  properties: { column: { type: 'string' }, as: { ...nullable('string'), description: 'A new header, or null to keep the name.' } },
                },
              },
            },
          },
        ],
      },
    },
  },
} as const

// Lenient parse of the reply (missing nulls tolerated); the definition built from
// it goes through the full strict validator.
const ModelOutput = z.object({
  kind: z.enum(['workflow', 'unsupported', 'clarification']),
  reason: z.string().nullish(),
  question: z.string().nullish(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['integer', 'string', 'date']),
        integer_default: z.number().nullish(),
        string_default: z.string().nullish(),
        date_default: z.string().nullish(),
        min: z.number().nullish(),
        max: z.number().nullish(),
      }),
    )
    .nullish(),
  steps: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          id: z.string(),
          type: z.literal('filter'),
          column: z.string(),
          operator: z.string(),
          value_kind: z.enum(['literal', 'parameter', 'list', 'relative']),
          literal_string: z.string().nullish(),
          literal_integer: z.number().nullish(),
          parameter: z.string().nullish(),
          list: z.array(z.string()).nullish(),
          relative_unit: z.string().nullish(),
          relative_offset: z.number().nullish(),
          relative_edge: z.string().nullish(),
        }),
        z.object({ id: z.string(), type: z.literal('date_part'), column: z.string(), part: z.string(), as: z.string() }),
        z.object({ id: z.string(), type: z.literal('group_sum'), group_by: z.string(), value_column: z.string(), as: z.string() }),
        z.object({
          id: z.string(),
          type: z.literal('aggregate'),
          group_by: z.array(z.string()).nullish(),
          measures: z.array(z.object({ op: z.string(), column: z.string().nullish(), as: z.string() })),
        }),
        z.object({ id: z.string(), type: z.literal('sort'), by: z.array(z.object({ column: z.string(), direction: z.string() })) }),
        z.object({
          id: z.string(),
          type: z.literal('limit'),
          rows_kind: z.enum(['literal', 'parameter']),
          rows_integer: z.number().nullish(),
          parameter: z.string().nullish(),
        }),
        z.object({ id: z.string(), type: z.literal('select'), columns: z.array(z.object({ column: z.string(), as: z.string().nullish() })) }),
      ]),
    )
    .nullish(),
})
type ModelOutput = z.infer<typeof ModelOutput>

export const SYSTEM_PROMPT = `You turn one sentence from a business user into a FlowPilot recipe: a short, linear list of steps over the rows of a CSV file. You only draft. A person reviews the draft, and a fixed engine runs it later without you.

Column types: text, amount (whole Indian rupees), whole number (a count or quantity) and date (a calendar day). Amounts and whole numbers are both "number columns".

The only operations:
- filter: keep rows where <column> <operator> <value>. eq and neq work on any column; lt, lte, gt and gte on number and date columns; contains (ignores capitals, value_kind "literal") and in (is one of a list, value_kind "list", values in "list") on text columns. eq, neq and in match text exactly and case-sensitively.
  Date values: a fixed day is value_kind "literal" with literal_string "YYYY-MM-DD". A day that depends on when the recipe runs is value_kind "relative" with relative_unit (day, week, month, quarter or year), relative_offset (0 = this, -1 = last, 1 = next, -30 = 30 units ago) and relative_edge ("start" or "end" of that unit). Examples: "last 30 days" = ordered_on gte relative day -30 start. "this month" = gte relative month 0 start AND lte relative month 0 end (two filters). "last month" = gte month -1 start AND lte month -1 end. "year to date" = gte relative year 0 start. "last quarter" = quarter -1 start and end. "since 1 April 2026" = gte literal_string "2026-04-01". Never use contains, in or a text value on a date column.
- date_part: add a text column named "as" holding the period a date column falls in: part "month" gives 2026-09, "quarter" gives 2026-Q3, "year" gives 2026, "week" gives 2026-W39. Every existing column stays. For "by month", "monthly", "per quarter", "each week" or "year on year": add date_part, then group by the new column (aggregate or group_sum), then sort by it asc.
- group_sum: group rows by one text column (group_by) and total one amount column (value_column) into a new amount column named by "as". After it ONLY the group_by column and the "as" column exist.
- aggregate: group rows by zero to three text or whole-number columns (group_by) and compute one to five figures (measures): count (number of rows, column null), sum, avg, min or max of a number column, each named by "as". An empty group_by gives one summary row over all rows. After it ONLY the group_by columns and the figures exist; a count is a whole number, the other figures keep their column's type, and averages are rounded to whole numbers.
- sort: order rows by one to three columns, direction "desc" (highest first, or Z to A) or "asc".
- limit: keep the first N rows: rows_kind "literal" with rows_integer N, or rows_kind "parameter".
- select: keep only the listed columns in that order, optionally renaming each ("as") for the output.

Rules:
- Use only the declared columns, plus columns created by earlier steps. Never invent column names.
- Put amount and whole-number values in literal_integer and text values in literal_string.
- Text matching is case-sensitive and you cannot see the data, so write text values the way they are usually stored: lowercase for status-like words (paid, refunded, live). Never copy a capital letter that only comes from starting a sentence ("Paid orders…" means "paid"). Keep the user's exact casing only when they quote a value, e.g. "Enterprise", or name something proper like a region or a person.
- A condition about a figure per group ("regions with revenue below X", "reps with more than 5 orders") filters the new column in a step AFTER the grouping, never the raw rows before it.
- Use group_sum when the only figure asked for is one total per group. Use aggregate for counts, averages, smallest or largest values, several figures, or totals over all rows.
- "Top N" or "the N largest": group if needed, then sort desc by the figure, then limit N. "Bottom N" or "lowest": sort asc, then limit.
- Only add a select step when the user asks for particular columns, an order of columns, or names for them.
- If the user calls a value configurable, adjustable, a threshold or a limit, or gives "default N", make it a parameter: type "integer" for numbers (integer_default N, min 0, max 1000000000; min 1 when it is how many rows to keep), "string" for text (string_default) or "date" for a day chosen per run (date_default "YYYY-MM-DD"). Reference it with value_kind "parameter" (or rows_kind "parameter" in a limit).
- Step ids are s1, s2, s3 in order. Parameter names and "as" names in group_sum and aggregate use lowercase letters, digits and underscores, starting with a letter.
- Use as few steps as the request needs, and never more than 10.
- Answer kind "unsupported", with a one-sentence reason, for anything these operations cannot do: sending email, Gmail, Slack or Sheets; calling APIs or URLs; scheduling or recurring runs; joining files; charts; percentages, ratios or shares of a total; comparing one period with another in the same row; writing code or SQL. Anything about dates on a column that is not a date type is unsupported too: say the column must be declared as a date.
- Answer kind "clarification", with one short question, when a column reference is ambiguous (for example when two declared columns could match a word in the request).
- Otherwise answer kind "workflow". Set fields that don't apply to null, and empty lists to [].`

export function userPrompt(request: string, columns: Record<string, ColumnType>): string {
  const lines = Object.entries(columns).map(([name, type]) => `- ${name}: ${COLUMN_TYPE_LABEL[type]}`)
  return `Declared input columns (name: type):\n${lines.join('\n')}\n\nRequest: ${request}`
}

// ----- Provider adapters ----------------------------------------------------------

class ModelUnavailable extends Error {}

type Reply = { data: unknown; raw: unknown }

interface Conversation {
  ask(prompt: string): Promise<Reply>
  repair(problems: string): Promise<Reply>
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIMITS.modelTimeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? 'the model provider rejected the API key'
          : res.status === 402
            ? 'the model provider account is out of credits'
            : res.status === 429
              ? 'the model provider is rate limiting requests'
              : 'the model provider answered with an error'
      throw new ModelUnavailable(`${hint}, HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    if (err instanceof ModelUnavailable) throw err
    if (controller.signal.aborted) throw new ModelUnavailable(`the model did not answer within ${LIMITS.modelTimeoutMs / 1000} seconds`)
    throw new ModelUnavailable('the model provider could not be reached')
  } finally {
    clearTimeout(timer)
  }
}

function anthropicConversation(config: ModelConfig): Conversation {
  const messages: unknown[] = []
  let lastToolUseId: string | null = null
  const call = async (): Promise<Reply> => {
    const body = (await post(
      `${config.baseUrl}/v1/messages`,
      { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: config.model,
        max_tokens: 2048,
        system: `${SYSTEM_PROMPT}\nAlways answer by calling the submit_recipe tool exactly once.`,
        tools: [
          {
            name: 'submit_recipe',
            description: 'Submit the drafted recipe, or an "unsupported" or "clarification" answer.',
            input_schema: OUTPUT_JSON_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'submit_recipe' },
        messages,
      },
    )) as { content?: Array<{ type: string; id?: string; name?: string; input?: unknown }> }
    const content = body.content ?? []
    const toolUse = content.find((b) => b.type === 'tool_use' && b.name === 'submit_recipe')
    messages.push({ role: 'assistant', content })
    lastToolUseId = toolUse?.id ?? null
    return { data: toolUse?.input ?? null, raw: body }
  }
  return {
    ask: async (prompt) => {
      messages.push({ role: 'user', content: prompt })
      return call()
    },
    repair: async (problems) => {
      messages.push({
        role: 'user',
        content: lastToolUseId
          ? [{ type: 'tool_result', tool_use_id: lastToolUseId, is_error: true, content: problems }]
          : problems,
      })
      return call()
    },
  }
}

/** OpenAI Chat Completions, also used for OpenRouter's OpenAI-compatible API. */
function openaiConversation(config: ModelConfig): Conversation {
  const openrouter = config.provider === 'openrouter'
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: `${SYSTEM_PROMPT}\nAnswer with JSON that matches the submit_recipe schema.` },
  ]
  const headers: Record<string, string> = { authorization: `Bearer ${config.apiKey}` }
  if (openrouter) headers['X-Title'] = 'FlowPilot'
  const call = async (): Promise<Reply> => {
    const body = (await post(`${config.baseUrl}/chat/completions`, headers, {
      model: config.model,
      messages,
      response_format: { type: 'json_schema', json_schema: { name: 'submit_recipe', strict: true, schema: OUTPUT_JSON_SCHEMA } },
      // OpenRouter: only route to upstream providers that honour strict response_format.
      ...(openrouter ? { provider: { require_parameters: true }, max_tokens: 4096 } : {}),
    })) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> }
    const message = body.choices?.[0]?.message
    if (message?.refusal) return { data: { kind: 'unsupported', reason: message.refusal, question: null, parameters: [], steps: [] }, raw: body }
    const content = message?.content ?? ''
    messages.push({ role: 'assistant', content })
    try {
      return { data: JSON.parse(content), raw: body }
    } catch {
      return { data: null, raw: body }
    }
  }
  return {
    ask: async (prompt) => {
      messages.push({ role: 'user', content: prompt })
      return call()
    },
    repair: async (problems) => {
      messages.push({ role: 'user', content: problems })
      return call()
    },
  }
}

// ----- Building and checking the draft ---------------------------------------------------

/** Wraps the model's steps and parameters with the author's own input contract. */
export function toDefinition(out: ModelOutput, columns: Record<string, ColumnType>): unknown {
  const parameters: Record<string, unknown> = {}
  for (const p of out.parameters ?? []) {
    parameters[p.name] =
      p.type === 'integer'
        ? { type: 'integer', default: p.integer_default ?? 0, min: p.min ?? 0, max: p.max ?? LIMITS.integerParameterMax }
        : p.type === 'date'
          ? { type: 'date', default: p.date_default ?? p.string_default ?? '' }
          : { type: 'string', default: p.string_default ?? '' }
  }
  // Track the columns step by step (the same rule as the engine) so a number
  // written as text, or vice versa, lands in the right slot.
  let current: Column[] = Object.entries(columns).map(([name, type]) => ({ name, type }))
  const steps = (out.steps ?? []).map((s) => {
    const step = toStep(s, current)
    current = columnsAfter(step as Step, current)
    return step
  })
  return { schemaVersion: 1, input: { format: 'csv', columns }, parameters, steps, output: { format: 'table' } }
}

type ModelStep = NonNullable<ModelOutput['steps']>[number]

function toStep(s: ModelStep, available: Column[]): unknown {
  switch (s.type) {
    case 'group_sum':
      return { id: s.id, type: 'group_sum', groupBy: s.group_by, valueColumn: s.value_column, as: s.as }
    case 'aggregate':
      return {
        id: s.id,
        type: 'aggregate',
        groupBy: s.group_by ?? [],
        measures: s.measures.map((m) => (m.op === 'count' ? { op: 'count', as: m.as } : { op: m.op, column: m.column ?? '', as: m.as })),
      }
    case 'sort':
      return { id: s.id, type: 'sort', by: s.by.map((k) => ({ column: k.column, direction: k.direction })) }
    case 'limit':
      return { id: s.id, type: 'limit', rows: s.rows_kind === 'parameter' ? { parameter: s.parameter ?? '' } : { literal: s.rows_integer ?? 0 } }
    case 'select':
      return { id: s.id, type: 'select', columns: s.columns.map((c) => (c.as ? { column: c.column, as: c.as } : { column: c.column })) }
    case 'date_part':
      return { id: s.id, type: 'date_part', column: s.column, part: s.part, as: s.as }
    case 'filter': {
      if (s.operator === 'in' || s.value_kind === 'list') {
        return { id: s.id, type: 'filter', column: s.column, operator: s.operator, value: { list: s.list ?? [] } }
      }
      if (s.value_kind === 'relative') {
        const relative = { unit: s.relative_unit ?? 'day', offset: s.relative_offset ?? 0, edge: s.relative_edge ?? 'start' }
        return { id: s.id, type: 'filter', column: s.column, operator: s.operator, value: { relative } }
      }
      const type = available.find((c) => c.name === s.column)?.type
      let literal: string | number = s.literal_string ?? (s.literal_integer ?? '')
      if (type === 'integer_inr' || type === 'integer') {
        if (typeof s.literal_integer === 'number') literal = s.literal_integer
        else if (typeof s.literal_string === 'string' && /^\d+$/.test(s.literal_string.trim())) literal = Number(s.literal_string.trim())
      } else if (typeof s.literal_string === 'string') {
        literal = s.literal_string
      }
      return {
        id: s.id,
        type: 'filter',
        column: s.column,
        operator: s.operator,
        value: s.value_kind === 'parameter' ? { parameter: s.parameter ?? '' } : { literal },
      }
    }
  }
}

function describeProblems(issues: ApiIssue[]): string {
  const lines = issues.slice(0, 20).map((i) => `- ${i.stepId ? `Step ${i.stepId}` : i.path || 'recipe'}: ${i.message}`)
  return `The recipe you submitted is not valid:\n${lines.join('\n')}\nFix these problems and submit the complete corrected recipe again.`
}

const unavailable = (why: string) =>
  new ApiError(
    503,
    'MODEL_UNAVAILABLE',
    `AI generation is unavailable (${why}). Saved recipes still run, and you can add steps by hand.`,
  )

/** Drafts a recipe. Throws 503 MODEL_UNAVAILABLE or 422 DRAFT_INVALID (with the draft). Never writes. */
export async function generateRecipe(input: { request: string; columns: Record<string, ColumnType> }): Promise<GenerateResult> {
  const config = modelConfig()
  if (!config) throw unavailable('no model key is configured on this server')
  const conversation = config.provider === 'anthropic' ? anthropicConversation(config) : openaiConversation(config)

  try {
    let reply = await conversation.ask(userPrompt(input.request, input.columns))
    for (let attempt = 0; ; attempt++) {
      let issues: ApiIssue[]
      let draft: unknown = null
      const parsed = ModelOutput.safeParse(reply.data)
      if (parsed.success) {
        const out = parsed.data
        if (out.kind === 'unsupported') {
          return { kind: 'unsupported', reason: out.reason?.trim() || 'Recipes can only filter, group, summarize, sort and trim rows.' }
        }
        if (out.kind === 'clarification') {
          return { kind: 'clarification', question: out.question?.trim() || 'Which column do you mean?' }
        }
        draft = toDefinition(out, input.columns)
        const validation = validateDefinition(draft)
        if (validation.ok) {
          return { kind: 'workflow', definition: validation.definition as WorkflowDefinition, provider: config.provider, model: config.model, repaired: attempt > 0 }
        }
        issues = validation.issues
      } else {
        issues = parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))
      }

      if (attempt >= 1) {
        throw new ApiError(
          422,
          'DRAFT_INVALID',
          'The model’s draft still had problems after one automatic repair.',
          { issues, draft: draft ?? undefined },
        )
      }
      reply = await conversation.repair(describeProblems(issues))
    }
  } catch (err) {
    if (err instanceof ModelUnavailable) throw unavailable(err.message)
    throw err
  }
}
