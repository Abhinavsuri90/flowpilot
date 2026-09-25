import { z } from 'zod'
import { invalid, json, readJson } from '../http'
import { generateRecipe } from '../ai/generate'
import { columnNameProblem } from '../../lib/workflow/validate'
import { COLUMN_TYPES, LIMITS } from '../../lib/workflow/schema'
import type { AuthedContext } from './context'

const Body = z.object({
  request: z
    .string({ error: 'Describe the report in a sentence' })
    .trim()
    .min(LIMITS.requestMin, { error: `Describe the report in at least ${LIMITS.requestMin} characters` })
    .max(LIMITS.requestMax, { error: `Keep the description under ${LIMITS.requestMax} characters` }),
  columns: z.record(z.string(), z.enum(COLUMN_TYPES, { error: 'Column types are "string" or "integer_inr"' })),
})

/**
 * POST /api/generate: {request, columns} → a draft workflow, "unsupported" or a
 * clarification question. Only column names and types reach the model, never
 * rows. It never writes to the database and never runs anything.
 */
export async function create({ request }: AuthedContext): Promise<Response> {
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { columns } = parsed.data
  const names = Object.keys(columns)
  if (names.length === 0) throw invalid('Declare at least one input column before generating steps')
  if (names.length > LIMITS.columns) throw invalid(`A recipe can declare at most ${LIMITS.columns} columns`)
  for (const name of names) {
    const problem = columnNameProblem(name)
    if (problem) throw invalid(`Column "${name}": ${problem}`)
  }
  return json(await generateRecipe(parsed.data))
}
