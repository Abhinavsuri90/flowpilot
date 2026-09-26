import { loadEnv } from './env'

// Deployment settings read from the environment (names documented in .env.example).

export type RegistrationMode = 'open' | 'invite-only' | 'closed'

export type AppConfig = {
  /** Shows the one-click demo accounts and seeds them into an empty database. */
  demoMode: boolean
  /** Who may create an account: anyone, only people with an invite link, or nobody. */
  registration: RegistrationMode
  /** Public base URL for links in emails, e.g. https://flowpilot.example.com (else the request's origin). */
  appUrl: string | null
  /** Trust X-Forwarded-For / Fly-Client-IP for rate limits (only behind a proxy you control). */
  trustProxy: boolean
  /** Email delivery (Resend). Without it, emails are written to the server log instead. */
  mail: { apiKey: string; from: string } | null
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw.trim())
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
    trustProxy: flag(process.env.TRUST_PROXY, false),
    mail: apiKey && from ? { apiKey, from } : null,
  }
}

/** Absolute URL for a path, for links that leave the app (emails). */
export function absoluteUrl(request: Request, path: string): string {
  const base = appConfig().appUrl ?? new URL(request.url).origin
  return `${base}${path}`
}

/**
 * The caller's address for rate limits. Forwarded headers are only believed
 * when TRUST_PROXY is set, since anyone can send them.
 */
export function clientIp(request: Request): string {
  if (appConfig().trustProxy) {
    const fly = request.headers.get('fly-client-ip')?.trim()
    if (fly) return fly
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  // srvx (Nitro's server layer) exposes the socket address as request.ip.
  const direct = (request as Request & { ip?: unknown }).ip
  return typeof direct === 'string' && direct ? direct : 'unknown'
}
