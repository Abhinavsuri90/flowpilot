import { z } from 'zod'
import { modelConfig, type ModelConfig } from './config'
import { ApiError } from '../http'
import { validateDefinition } from '../../lib/workflow/validate'
import { COLUMN_TYPE_LABEL, LIMITS, OPERATORS, type ColumnType, type WorkflowDefinition } from '../../lib/workflow/schema'
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
        required: ['name', 'type', 'integer_default', 'string_default', 'min', 'max'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['integer', 'string'] },
          integer_default: nullable('integer'),
          string_default: nullable('string'),
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
            required: ['id', 'type', 'column', 'operator', 'value_kind', 'literal_string', 'literal_integer', 'parameter'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['filter'] },
              column: { type: 'string' },
              operator: { type: 'string', enum: [...OPERATORS] },
              value_kind: { type: 'string', enum: ['literal', 'parameter'] },
              literal_string: nullable('string'),
              literal_integer: nullable('integer'),
              parameter: nullable('string'),
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
        type: z.enum(['integer', 'string']),
        integer_default: z.number().nullish(),
        string_default: z.string().nullish(),
        min: z.number().nullish(),
        max: z.number().nullish(),
      }),
    )
    .nullish(),
  steps: z
    .array(
      z.union([
        z.object({
          id: z.string(),
          type: z.literal('filter'),
          column: z.string(),
          operator: z.string(),
          value_kind: z.enum(['literal', 'parameter']),
          literal_string: z.string().nullish(),
          literal_integer: z.number().nullish(),
          parameter: z.string().nullish(),
        }),
        z.object({ id: z.string(), type: z.literal('group_sum'), group_by: z.string(), value_column: z.string(), as: z.string() }),
      ]),
    )
    .nullish(),
})
type ModelOutput = z.infer<typeof ModelOutput>

export const SYSTEM_PROMPT = `You turn one sentence from a business user into a FlowPilot recipe: a short, linear list of steps over the rows of a CSV file. You only draft. A person reviews the draft, and a fixed engine runs it later without you.

The only operations:
- filter: keep rows where <column> <operator> <value>. Operators: eq and neq work on text or amount columns; lt, lte, gt and gte work on amount columns only. Text matching is exact and case-sensitive.
- group_sum: group rows by one text column (group_by) and sum one amount column (value_column) into a new amount column named by "as". After a group_sum ONLY the group_by column and the "as" column exist; later steps can use only those two.

Rules:
- Use only the declared columns, plus columns created by earlier group_sum steps. Never invent column names.
- Amounts are whole Indian rupees. Put amount values in literal_integer and text values in literal_string.
- Text matching is case-sensitive and you cannot see the data, so write text values the way they are usually stored: lowercase for status-like words (paid, refunded, live). Never copy a capital letter that only comes from starting a sentence ("Paid orders…" means "paid"). Keep the user's exact casing only when they quote a value, e.g. "Enterprise".
- A condition about a total per group ("regions with revenue below X", "reps whose paid total is at least X") filters the group_sum's new column in a step AFTER the group_sum, never the raw amount before it.
- If the user calls a value configurable, adjustable, a threshold or a limit, or gives "default N", make it a parameter: type "integer" for amounts (integer_default N, min 0, max 1000000000) or "string" for text (string_default). Reference it with value_kind "parameter".
- Step ids are s1, s2, s3 in order. Parameter names and "as" names use lowercase letters, digits and underscores, starting with a letter.
- Use as few steps as the request needs, and never more than 10.
- Answer kind "unsupported", with a one-sentence reason, for anything these two operations cannot do: sending email, Gmail, Slack or Sheets; calling APIs or URLs; scheduling or recurring runs; joining files; charts; averages, counts, minimums or maximums; writing code or SQL.
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
        : { type: 'string', default: p.string_default ?? '' }
  }
  // Track column types so a number written as text (or vice versa) lands in the right slot.
  let types = new Map(Object.entries(columns))
  const steps = (out.steps ?? []).map((s) => {
    if (s.type === 'group_sum') {
      types = new Map<string, ColumnType>([
        [s.group_by, 'string'],
        [s.as, 'integer_inr'],
      ])
      return { id: s.id, type: 'group_sum', groupBy: s.group_by, valueColumn: s.value_column, as: s.as }
    }
    let literal: string | number = s.literal_string ?? (s.literal_integer ?? '')
    if (types.get(s.column) === 'integer_inr') {
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
  })
  return { schemaVersion: 1, input: { format: 'csv', columns }, parameters, steps, output: { format: 'table' } }
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
          return { kind: 'unsupported', reason: out.reason?.trim() || 'Recipes can only filter rows and total amounts.' }
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
