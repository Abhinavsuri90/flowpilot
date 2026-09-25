import { z } from 'zod'

// ---------------------------------------------------------------------------
// The recipe contract: a declared input, typed parameters and a linear list of
// at most 10 steps. Each step consumes the previous step's rows. Only two
// operations exist, and values are literals or declared parameters, so no
// user- or model-supplied code or expression is ever evaluated.
// ---------------------------------------------------------------------------

/** Prototype design limits (not measured guarantees). */
export const LIMITS = {
  fileBytes: 1024 * 1024,
  rows: 5000,
  columns: 50,
  steps: 10,
  parameters: 10,
  /** Largest amount in one CSV cell: ₹1,00,00,000 (one crore). */
  amountMax: 10_000_000,
  integerParameterMax: 1_000_000_000,
  textMax: 200,
  columnNameMax: 64,
  deadlineMs: 30_000,
  staleRunMs: 60_000,
  modelTimeoutMs: 20_000,
  requestMin: 3,
  requestMax: 2000,
  titleMax: 120,
  descriptionMax: 1000,
  issuesMax: 20,
} as const

/** Step ids, aliases and parameter names. */
export const NAME_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/
/** Names that would collide with JavaScript object internals. */
export const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

export const COLUMN_TYPES = ['string', 'integer_inr'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]

export const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const
export type Operator = (typeof OPERATORS)[number]
/** Ordering comparisons only make sense for amounts. */
export const AMOUNT_ONLY_OPERATORS: ReadonlySet<Operator> = new Set(['lt', 'lte', 'gt', 'gte'])

export const STEP_TYPES = ['filter', 'group_sum'] as const
export type StepType = (typeof STEP_TYPES)[number]

// ----- TypeScript shapes (validated by the Zod schema below) ---------------

export type StepValue = { literal: string | number } | { parameter: string }

export type FilterStep = {
  id: string
  type: 'filter'
  column: string
  operator: Operator
  value: StepValue
}

export type GroupSumStep = {
  id: string
  type: 'group_sum'
  groupBy: string
  valueColumn: string
  as: string
}

export type Step = FilterStep | GroupSumStep

export type IntegerParameter = { type: 'integer'; default: number; min: number; max: number }
export type StringParameter = { type: 'string'; default: string }
export type Parameter = IntegerParameter | StringParameter

export type WorkflowDefinition = {
  schemaVersion: 1
  input: { format: 'csv'; columns: Record<string, ColumnType> }
  parameters: Record<string, Parameter>
  steps: Step[]
  output: { format: 'table' }
}

export type Column = { name: string; type: ColumnType }
export type Row = Record<string, string | number>
export type ParameterValues = Record<string, string | number>

export type StepLogEntry = { stepId: string; type: StepType; rowsIn: number; rowsOut: number; ms: number }

// ----- Strict Zod schema: unknown keys are rejected everywhere --------------

const nameField = (what: string) =>
  z
    .string({ error: `${what} must be text` })
    .regex(NAME_PATTERN, {
      error: `${what} must be 1–64 lowercase letters, digits or _, starting with a letter or _`,
    })

const columnRef = (what: string) =>
  z.string({ error: `${what} must be a column name` }).min(1, { error: `Choose a column for ${what}` }).max(LIMITS.columnNameMax)

const literal = z.union(
  [
    z.string().max(LIMITS.textMax, { error: `Text values can be at most ${LIMITS.textMax} characters` }),
    z
      .number()
      .int({ error: 'Amounts must be whole rupees' })
      .min(0, { error: 'Amounts cannot be negative' })
      .max(Number.MAX_SAFE_INTEGER),
  ],
  { error: 'A literal value must be text or a whole number' },
)

const ValueSchema = z
  .strictObject({ literal: literal.optional(), parameter: nameField('Parameter name').optional() })
  .refine((v) => (v.literal !== undefined) !== (v.parameter !== undefined), {
    error: 'A value is exactly one of {"literal": …} or {"parameter": "<name>"}',
  })

const FilterSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('filter'),
  column: columnRef('the filter'),
  operator: z.enum(OPERATORS, { error: 'Operator must be one of eq, neq, lt, lte, gt, gte' }),
  value: ValueSchema,
})

const GroupSumSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('group_sum'),
  groupBy: columnRef('group by'),
  valueColumn: columnRef('the sum'),
  as: nameField('The new column name'),
})

export const StepSchema = z.discriminatedUnion('type', [FilterSchema, GroupSumSchema])

const IntegerParameterSchema = z.strictObject({
  type: z.literal('integer'),
  default: z.number({ error: 'The default must be a number' }).int({ error: 'The default must be a whole number' }),
  min: z.number({ error: 'min must be a number' }).int({ error: 'min must be a whole number' }),
  max: z.number({ error: 'max must be a number' }).int({ error: 'max must be a whole number' }),
})

const StringParameterSchema = z.strictObject({
  type: z.literal('string'),
  default: z
    .string({ error: 'The default must be text' })
    .max(LIMITS.textMax, { error: `Text defaults can be at most ${LIMITS.textMax} characters` }),
})

export const ParameterSchema = z.discriminatedUnion('type', [IntegerParameterSchema, StringParameterSchema], {
  error: 'A parameter type must be "integer" or "string"',
})

export const WorkflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1, { error: 'schemaVersion must be 1' }),
  input: z.strictObject({
    format: z.literal('csv', { error: 'input.format must be "csv"' }),
    columns: z.record(z.string(), z.enum(COLUMN_TYPES, { error: 'Column types are "string" or "integer_inr"' })),
  }),
  parameters: z.record(z.string(), ParameterSchema),
  steps: z
    .array(StepSchema)
    .min(1, { error: 'A recipe needs at least one step' })
    .max(LIMITS.steps, { error: `A recipe can have at most ${LIMITS.steps} steps` }),
  output: z.strictObject({ format: z.literal('table', { error: 'output.format must be "table"' }) }),
})

/** Human labels for column types. */
export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  string: 'text',
  integer_inr: 'amount (whole INR)',
}
