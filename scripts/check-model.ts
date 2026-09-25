// Reports whether the model is configured and reachable, and prints the steps it
// drafts for the demo sentence. Keys are never printed.
//   npm run check:model
import { loadEnv } from '../src/server/env'
import { modelStatus } from '../src/server/ai/config'
import { generateRecipe } from '../src/server/ai/generate'
import { ApiError } from '../src/server/http'
import { REGIONAL_REVENUE_EXCEPTIONS, REGIONAL_REVENUE_REQUEST } from '../src/lib/workflow/examples'
import { describeRecipe } from '../src/lib/workflow/describe'

loadEnv()
const status = modelStatus()
if (!status.available) {
  console.log('Model: not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (optionally MODEL_PROVIDER and MODEL_NAME).')
  console.log('The app still works: manual step editing and every saved recipe run without a model.')
  process.exit(1)
}
console.log(`Model: ${status.provider} · ${status.model}`)
console.log(`Request: ${REGIONAL_REVENUE_REQUEST}`)
const started = Date.now()
try {
  const result = await generateRecipe({ request: REGIONAL_REVENUE_REQUEST, columns: REGIONAL_REVENUE_EXCEPTIONS.input.columns })
  console.log(`Answered in ${((Date.now() - started) / 1000).toFixed(1)} s: ${result.kind}`)
  if (result.kind === 'workflow') {
    describeRecipe(result.definition).forEach((line, i) => console.log(`  ${i + 1}. ${line}`))
    console.log(`  parameters: ${JSON.stringify(result.definition.parameters)}${result.repaired ? ' (after one repair)' : ''}`)
  } else if (result.kind === 'unsupported') console.log(`  reason: ${result.reason}`)
  else console.log(`  question: ${result.question}`)
} catch (err) {
  if (err instanceof ApiError) {
    console.log(`Not reachable: ${err.code}: ${err.message}`)
    process.exit(2)
  }
  throw err
}
