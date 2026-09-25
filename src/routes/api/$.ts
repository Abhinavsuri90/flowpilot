import { createFileRoute } from '@tanstack/react-router'
import { handleApi } from '~/server/api/router'

// Every /api/* request goes through one dispatcher: route match, origin check,
// session, handler, error mapping.
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApi(request),
      POST: ({ request }) => handleApi(request),
      PATCH: ({ request }) => handleApi(request),
      DELETE: ({ request }) => handleApi(request),
    },
  },
})
