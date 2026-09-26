import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { userFromRequest } from '../server/auth'
import { loadEnv } from '../server/env'
import { toMe } from '../server/api/auth'
import { DEFAULT_SEED_PASSWORD } from '../server/seed'
import { appConfig } from '../server/config'
import { ensureReady } from '../server/boot'
import type { AuthOptions, Me } from './types'

/**
 * Reads the session cookie on the server. Used by the `_app` layout's
 * beforeLoad for route UX; every API endpoint still checks the session itself.
 */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async (): Promise<Me | null> => {
  loadEnv()
  await ensureReady()
  setResponseHeader('Cache-Control', 'private, no-store')
  const user = userFromRequest(getDb(), getRequest())
  return user ? toMe(user) : null
})

/**
 * What the sign-in and sign-up pages show: demo accounts only in DEMO_MODE (and
 * their password only when it is the documented one; a custom SEED_PASSWORD is
 * never sent to the browser), whether sign-up is open, and whether email works.
 */
export const getLoginInfoFn = createServerFn({ method: 'GET' }).handler(async (): Promise<AuthOptions> => {
  await ensureReady()
  const config = appConfig()
  const configured = process.env.SEED_PASSWORD
  const documented = !configured || configured === DEFAULT_SEED_PASSWORD
  return {
    demoMode: config.demoMode,
    demoPassword: config.demoMode && documented ? DEFAULT_SEED_PASSWORD : null,
    registration: config.registration,
    mail: config.mail !== null,
  }
})
