import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseForContract } from '../../src/lib/csv'
import { execute } from '../../src/lib/workflow/execute'
import { resolveParameters, validateDefinition } from '../../src/lib/workflow/validate'
import type { WorkflowDefinition } from '../../src/lib/workflow/schema'

export function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', name), 'utf8')
}

/** Validate → resolve parameters → parse the file → execute, exactly like POST /api/runs. */
export function runFixture(def: WorkflowDefinition, file: string, params: Record<string, unknown> = {}) {
  const valid = validateDefinition(def)
  if (!valid.ok) throw new Error(`invalid definition: ${JSON.stringify(valid.issues)}`)
  const resolved = resolveParameters(valid.definition, params)
  if (!resolved.ok) throw new Error(`invalid parameters: ${JSON.stringify(resolved.issues)}`)
  const parsed = parseForContract(fixture(file), valid.definition.input.columns)
  return { ...execute(valid.definition, parsed.rows, resolved.values), params: resolved.values, parsed }
}
