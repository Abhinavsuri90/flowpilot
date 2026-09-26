import { createFileRoute } from '@tanstack/react-router'
import { handleApi } from '~/server/api/router'

// Every /api/* request goes through one dispatcher: route match, origin check,
// session, handler, error mapping. ANY sends every other method (HEAD, OPTIONS,
// PUT…) there too, so the API answers 204/405 instead of the app's HTML page.
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: ({ request }) => handleApi(request),
    },
  },
})
