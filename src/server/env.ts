import { existsSync } from 'node:fs'

let loaded = false

/**
 * Loads `.env` from the working directory once, for `npm start` and scripts.
 * Variables already set in the environment win over the file.
 */
export function loadEnv(): void {
  if (loaded) return
  loaded = true
  // Tests stay hermetic: a developer's real keys are never loaded into them.
  if (process.env.VITEST) return
  if (!existsSync('.env')) return
  try {
    process.loadEnvFile('.env')
  } catch (err) {
    console.warn('[flowpilot] could not read .env:', (err as Error).message)
  }
}
