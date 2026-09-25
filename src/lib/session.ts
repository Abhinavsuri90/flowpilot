import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { userFromRequest } from '../server/auth'
import { loadEnv } from '../server/env'
import { toMe } from '../server/api/auth'
import { DEFAULT_SEED_PASSWORD } from '../server/seed'
import type { Me } from './types'

/**
 * Reads the session cookie on the server. Used by the `_app` layout's
 * beforeLoad for route UX; every API endpoint still checks the session itself.
 */
export const getSessionFn = createServerFn({ method: 'GET' }).handler((): Me | null => {
  loadEnv()
  setResponseHeader('Cache-Control', 'private, no-store')
  const user = userFromRequest(getDb(), getRequest())
  return user ? toMe(user) : null
})

/**
 * The login page's one-click demo accounts fill the password only when it is the
 * documented demo password. A custom SEED_PASSWORD is never sent to the browser.
 */
export const getLoginInfoFn = createServerFn({ method: 'GET' }).handler(() => {
  loadEnv()
  const configured = process.env.SEED_PASSWORD
  const demoPassword = !configured || configured === DEFAULT_SEED_PASSWORD ? DEFAULT_SEED_PASSWORD : null
  return { demoPassword }
})
