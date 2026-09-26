import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

/** Baseline security headers on every page, API and server-function response. */
const securityHeaders = createMiddleware().server(({ next }) => {
  setResponseHeader('X-Content-Type-Options', 'nosniff')
  // One-click actions (sharing, role changes) must never run inside another site's frame.
  setResponseHeader('X-Frame-Options', 'DENY')
  setResponseHeader('Referrer-Policy', 'same-origin')
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeaders,
    // Defining src/start.ts replaces Start's default, so keep its CSRF check for server functions.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
  ],
}))
