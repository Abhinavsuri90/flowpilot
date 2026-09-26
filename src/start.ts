import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

const HSTS = 'max-age=31536000; includeSubDomains'

/** HTTPS directly, or behind a proxy that says so (X-Forwarded-Proto). */
function isSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  return forwarded ? forwarded.split(',')[0]!.trim() === 'https' : new URL(request.url).protocol === 'https:'
}

/** Baseline security headers on every page, API and server-function response. */
const securityHeaders = createMiddleware().server(({ next, request }) => {
  setResponseHeader('X-Content-Type-Options', 'nosniff')
  // One-click actions (sharing, role changes) must never run inside another site's frame.
  setResponseHeader('X-Frame-Options', 'DENY')
  setResponseHeader('Referrer-Policy', 'same-origin')
  // Over HTTPS, browsers remember to never downgrade to plain HTTP.
  if (isSecure(request)) setResponseHeader('Strict-Transport-Security', HSTS)
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeaders,
    // Defining src/start.ts replaces Start's default, so keep its CSRF check for server functions.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
  ],
}))
