import { loadEnv } from './env'

// Deployment settings read from the environment (names documented in .env.example).

export type RegistrationMode = 'open' | 'invite-only' | 'closed'

/**
 * Which header carries the visitor's address. Each mode believes exactly one
 * header that the proxy in front of the app writes itself:
 * - `off`: nothing forwarded is believed; the socket address is used
 * - `forwarded`: the last X-Forwarded-For entry, i.e. the address the nearest
 *   proxy saw (Caddy, nginx, a load balancer); earlier entries are the client's own claim
 * - `fly`: Fly-Client-IP, which Fly.io's edge sets on every request
 */
export type ProxyTrust = 'off' | 'forwarded' | 'fly'

/** One line per API request: JSON for log collectors, short text for a terminal, or none. */
export type LogFormat = 'json' | 'pretty' | 'off'

export type AppConfig = {
  /** Shows the one-click demo accounts and seeds them into an empty database. */
  demoMode: boolean
  /** Who may create an account: anyone, only people with an invite link, or nobody. */
  registration: RegistrationMode
  /** Public base URL for links in emails, e.g. https://flowpilot.example.com (else the request's origin). */
  appUrl: string | null
  /** Where rate limits read the visitor's address (only trust a proxy you control). */
  trustProxy: ProxyTrust
  /** Email delivery (Resend). Without it, emails are written to the server log instead. */
  mail: { apiKey: string; from: string } | null
  /** Request logs: JSON in production, short text in development, none under the test runner. */
  logFormat: LogFormat
  /** Bearer token a Prometheus scraper sends to GET /api/metrics; without it the endpoint doesn't exist. */
  metricsToken: string | null
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

function proxyTrust(raw: string | undefined): ProxyTrust {
  if (raw?.trim().toLowerCase() === 'fly') return 'fly'
  return flag(raw, false) ? 'forwarded' : 'off'
}

function logFormat(raw: string | undefined, production: boolean): LogFormat {
  const value = raw?.trim().toLowerCase()
  if (value === 'json' || value === 'pretty' || value === 'off') return value
  if (process.env.VITEST) return 'off'
  return production ? 'json' : 'pretty'
}

export function appConfig(): AppConfig {
  loadEnv()
  const production = process.env.NODE_ENV === 'production'
  const registration = process.env.REGISTRATION?.trim().toLowerCase()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.MAIL_FROM?.trim()
  return {
    demoMode: flag(process.env.DEMO_MODE, !production),
    registration: registration === 'invite-only' || registration === 'closed' ? registration : 'open',
    appUrl: process.env.APP_URL?.trim().replace(/\/+$/, '') || null,
    trustProxy: proxyTrust(process.env.TRUST_PROXY),
    mail: apiKey && from ? { apiKey, from } : null,
    logFormat: logFormat(process.env.LOG_FORMAT, production),
    metricsToken: process.env.METRICS_TOKEN?.trim() || null,
  }
}

/** Absolute URL for a path, for links that leave the app (emails). */
export function absoluteUrl(request: Request, path: string): string {
  const base = appConfig().appUrl ?? new URL(request.url).origin
  return `${base}${path}`
}

/**
 * The caller's address for rate limits. Forwarded headers are only believed
 * when TRUST_PROXY says which proxy writes them, since anyone can send them:
 * a proxy passes headers it doesn't own straight through, and appends to
 * X-Forwarded-For rather than replacing what the client claimed.
 */
export function clientIp(request: Request): string {
  const trust = appConfig().trustProxy
  if (trust === 'fly') {
    const fly = request.headers.get('fly-client-ip')?.trim()
    if (fly) return fly
  } else if (trust === 'forwarded') {
    const hops = request.headers.get('x-forwarded-for')?.split(',')
    const nearest = hops?.[hops.length - 1]?.trim()
    if (nearest) return nearest
  }
  // srvx (Nitro's server layer) exposes the socket address as request.ip.
  const direct = (request as Request & { ip?: unknown }).ip
  return typeof direct === 'string' && direct ? direct : 'unknown'
}
