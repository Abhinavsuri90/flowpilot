import { z } from 'zod'
import { isIsoDate } from '../dates'

// ---------------------------------------------------------------------------
// The recipe contract: a declared input, typed parameters and a linear list of
// at most 10 steps. Each step consumes the previous step's rows. Operations
// come from a fixed allowlist, and values are literals or declared parameters,
// so no user- or model-supplied code or expression is ever evaluated.
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
  /** Largest whole number (a count or quantity) in one CSV cell. */
  integerMax: 1_000_000_000,
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
  /** Group-by columns in one summary step. */
  groupColumns: 3,
  /** Figures (count, sum, …) in one summary step. */
  measures: 5,
  sortKeys: 3,
  /** Values in one "is one of" filter. */
  listValues: 50,
  /** Largest "keep the first N rows". */
  limitRowsMax: 100_000,
  /** How far a relative date may reach, in units (days, weeks, months, quarters or years). */
  dateOffsetMax: 3660,
} as const

/** Step ids, aliases and parameter names. */
export const NAME_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/
/** Names that would collide with JavaScript object internals. */
export const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

/** Text, an amount in whole rupees, a whole number (a count or quantity), or a calendar date. */
export const COLUMN_TYPES = ['string', 'integer_inr', 'integer', 'date'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]
export const isNumericType = (type: ColumnType | undefined): boolean => type === 'integer_inr' || type === 'integer'
export const isDateType = (type: ColumnType | undefined): boolean => type === 'date'

export const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'in'] as const
export type Operator = (typeof OPERATORS)[number]
/** Ordering comparisons only make sense for numbers (amounts and whole numbers) and dates. */
export const NUMERIC_ONLY_OPERATORS: ReadonlySet<Operator> = new Set(['lt', 'lte', 'gt', 'gte'])
/** @deprecated kept for older imports; the same set as NUMERIC_ONLY_OPERATORS. */
export const AMOUNT_ONLY_OPERATORS = NUMERIC_ONLY_OPERATORS
/** "contains" (ignoring capitals) and "is one of" work on text. */
export const TEXT_ONLY_OPERATORS: ReadonlySet<Operator> = new Set(['contains', 'in'])

export const STEP_TYPES = ['filter', 'group_sum', 'aggregate', 'sort', 'limit', 'select', 'date_part'] as const
export type StepType = (typeof STEP_TYPES)[number]

export const DATE_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type DateUnit = (typeof DATE_UNITS)[number]
/**
 * A date fixed by the day the recipe runs: { unit: 'month', offset: -1, edge:
 * 'start' } is the first day of last month; { unit: 'day', offset: -30, edge:
 * 'start' } is 30 days ago. Weeks start on Monday.
 */
export type RelativeDate = { unit: DateUnit; offset: number; edge: 'start' | 'end' }

export const DATE_PARTS = ['year', 'quarter', 'month', 'week'] as const
export type DatePart = (typeof DATE_PARTS)[number]

export const AGGREGATE_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const
export type AggregateOp = (typeof AGGREGATE_OPS)[number]

// ----- TypeScript shapes (validated by the Zod schema below) ---------------

/** A fixed value, a declared parameter, (for "is one of") a list of text values, or (for dates) a date relative to the run day. */
export type StepValue = { literal: string | number } | { parameter: string } | { list: string[] } | { relative: RelativeDate }

export type FilterStep = {
  id: string
  type: 'filter'
  column: string
  operator: Operator
  value: StepValue
}

/** Group by one text column and total one amount column (the original grouping step). */
export type GroupSumStep = {
  id: string
  type: 'group_sum'
  groupBy: string
  valueColumn: string
  as: string
}

export type Measure = { op: 'count'; as: string } | { op: Exclude<AggregateOp, 'count'>; column: string; as: string }

/**
 * Group by up to three text or whole-number columns (none = one summary row)
 * and compute up to five figures per group. Averages are rounded to the
 * nearest whole number, halves up.
 */
export type AggregateStep = {
  id: string
  type: 'aggregate'
  groupBy: string[]
  measures: Measure[]
}

export type SortKey = { column: string; direction: 'asc' | 'desc' }
export type SortStep = { id: string; type: 'sort'; by: SortKey[] }

/** Keep the first N rows (after a sort: the top N). */
export type LimitStep = { id: string; type: 'limit'; rows: { literal: number } | { parameter: string } }

/** Keep only these columns, in this order, optionally renamed for the output. */
export type SelectStep = { id: string; type: 'select'; columns: Array<{ column: string; as?: string }> }

/** Adds a text column with the period a date falls in ("2026", "2026-Q3", "2026-09", "2026-W39"), to group by. */
export type DatePartStep = { id: string; type: 'date_part'; column: string; part: DatePart; as: string }

export type Step = FilterStep | GroupSumStep | AggregateStep | SortStep | LimitStep | SelectStep | DatePartStep

export type IntegerParameter = { type: 'integer'; default: number; min: number; max: number }
export type StringParameter = { type: 'string'; default: string }
/** A calendar date (YYYY-MM-DD) chosen per run, e.g. the first day of the reporting period. */
export type DateParameter = { type: 'date'; default: string }
export type Parameter = IntegerParameter | StringParameter | DateParameter

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

const listValues = z
  .array(z.string().min(1, { error: 'List values cannot be empty' }).max(LIMITS.textMax, { error: `List values can be at most ${LIMITS.textMax} characters` }))
  .min(1, { error: 'Add at least one value to the list' })
  .max(LIMITS.listValues, { error: `A list can have at most ${LIMITS.listValues} values` })

const RelativeSchema = z.strictObject({
  unit: z.enum(DATE_UNITS, { error: 'A relative date counts in day, week, month, quarter or year' }),
  offset: z
    .number({ error: 'The offset must be a whole number (0 = this, -1 = last, 1 = next)' })
    .int({ error: 'The offset must be a whole number (0 = this, -1 = last, 1 = next)' })
    .min(-LIMITS.dateOffsetMax, { error: `A relative date can reach at most ${LIMITS.dateOffsetMax} units back` })
    .max(LIMITS.dateOffsetMax, { error: `A relative date can reach at most ${LIMITS.dateOffsetMax} units ahead` }),
  edge: z.enum(['start', 'end'], { error: 'edge is "start" or "end" (of the day, week, month, quarter or year)' }),
})

const ValueSchema = z
  .strictObject({
    literal: literal.optional(),
    parameter: nameField('Parameter name').optional(),
    list: listValues.optional(),
    relative: RelativeSchema.optional(),
  })
  .refine((v) => [v.literal, v.parameter, v.list, v.relative].filter((x) => x !== undefined).length === 1, {
    error: 'A value is exactly one of {"literal": …}, {"parameter": "<name>"}, {"list": […]} or {"relative": {…}}',
  })

const FilterSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('filter'),
  column: columnRef('the filter'),
  operator: z.enum(OPERATORS, { error: 'Operator must be one of eq, neq, lt, lte, gt, gte, contains, in' }),
  value: ValueSchema,
})

const GroupSumSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('group_sum'),
  groupBy: columnRef('group by'),
  valueColumn: columnRef('the sum'),
  as: nameField('The new column name'),
})

const AggregateSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('aggregate'),
  groupBy: z
    .array(columnRef('group by'))
    .max(LIMITS.groupColumns, { error: `Group by at most ${LIMITS.groupColumns} columns` }),
  measures: z
    .array(
      z.strictObject({
        op: z.enum(AGGREGATE_OPS, { error: 'A figure is one of count, sum, avg, min, max' }),
        column: columnRef('the figure').optional(),
        as: nameField('The new column name'),
      }),
    )
    .min(1, { error: 'Add at least one figure (count, sum, average, minimum or maximum)' })
    .max(LIMITS.measures, { error: `A summary can have at most ${LIMITS.measures} figures` }),
})

const SortSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('sort'),
  by: z
    .array(z.strictObject({ column: columnRef('sorting'), direction: z.enum(['asc', 'desc'], { error: 'Direction is asc or desc' }) }))
    .min(1, { error: 'Choose a column to sort by' })
    .max(LIMITS.sortKeys, { error: `Sort by at most ${LIMITS.sortKeys} columns` }),
})

const LimitSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('limit'),
  rows: z.union(
    [
      z.strictObject({
        literal: z
          .number({ error: 'The number of rows must be a whole number' })
          .int({ error: 'The number of rows must be a whole number' })
          .min(1, { error: 'Keep at least 1 row' })
          .max(LIMITS.limitRowsMax, { error: `Keep at most ${LIMITS.limitRowsMax} rows` }),
      }),
      z.strictObject({ parameter: nameField('Parameter name') }),
    ],
    { error: 'rows is {"literal": N} or {"parameter": "<name>"}' },
  ),
})

const SelectSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('select'),
  columns: z
    .array(z.strictObject({ column: columnRef('the output'), as: z.string().optional() }))
    .min(1, { error: 'Choose at least one column to keep' })
    .max(LIMITS.columns, { error: `Keep at most ${LIMITS.columns} columns` }),
})

const DatePartSchema = z.strictObject({
  id: nameField('Step id'),
  type: z.literal('date_part'),
  column: columnRef('the date'),
  part: z.enum(DATE_PARTS, { error: 'A period is one of year, quarter, month or week' }),
  as: nameField('The new column name'),
})

export const StepSchema = z.discriminatedUnion('type', [FilterSchema, GroupSumSchema, AggregateSchema, SortSchema, LimitSchema, SelectSchema, DatePartSchema])

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

const DateParameterSchema = z.strictObject({
  type: z.literal('date'),
  default: z.string({ error: 'The default must be a date like 2026-04-03' }).refine(isIsoDate, { error: 'The default must be a date like 2026-04-03' }),
})

export const ParameterSchema = z.discriminatedUnion('type', [IntegerParameterSchema, StringParameterSchema, DateParameterSchema], {
  error: 'A parameter type must be "integer", "string" or "date"',
})

export const WorkflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1, { error: 'schemaVersion must be 1' }),
  input: z.strictObject({
    format: z.literal('csv', { error: 'input.format must be "csv"' }),
    columns: z.record(z.string(), z.enum(COLUMN_TYPES, { error: 'Column types are "string", "integer_inr", "integer" or "date"' })),
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
  integer: 'whole number (count or quantity)',
  date: 'date (YYYY-MM-DD)',
}
