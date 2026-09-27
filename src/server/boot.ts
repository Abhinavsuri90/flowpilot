import { getDb } from './db'
import { appConfig } from './config'
import { isSeeded, seedDatabase } from './seed'
import { startRuntimeMonitors } from './observability'
import { checkSecretKey } from './secrets'

let ready: Promise<void> | null = null

/**
 * First-request setup for a deployed server: open the database (which applies
 * migrations) and, in DEMO_MODE, seed the demo accounts into an empty database.
 * Development seeds with `npm run seed` instead (predev).
 */
export function ensureReady(): Promise<void> {
  ready ??= (async () => {
    const db = getDb()
    checkSecretKey()
    startRuntimeMonitors()
    if (appConfig().demoMode && process.env.NODE_ENV === 'production' && !isSeeded(db)) {
      const result = await seedDatabase(db, { password: process.env.SEED_PASSWORD })
      console.info(`[flowpilot] DEMO_MODE: seeded ${Object.keys(result.users).length} demo accounts`)
    }
  })().catch((err) => {
    ready = null // try again on the next request
    throw err
  })
  return ready
}
