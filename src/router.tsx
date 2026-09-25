import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { ApiError } from './lib/api'
import { ErrorState, NotFoundState } from './components/states'

/** A 401 from any query or mutation means the session ended: go sign in again. */
function onApiError(error: unknown) {
  if (typeof window === 'undefined') return
  if (error instanceof ApiError && error.status === 401 && !window.location.pathname.startsWith('/login')) {
    const back = window.location.pathname + window.location.search
    window.location.assign(`/login?redirect=${encodeURIComponent(back)}`)
  }
}

export function getRouter() {
  // One QueryClient per router: Start creates a router per SSR request, so one
  // person's cached data can never end up in another person's HTML.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onApiError }),
    mutationCache: new MutationCache({ onError: onApiError }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 1,
      },
    },
  })

  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultErrorComponent: ({ error, reset }) => (
      <div className="p-6">
        <ErrorState error={error} onRetry={reset} />
      </div>
    ),
    defaultNotFoundComponent: () => (
      <div className="p-6">
        <NotFoundState />
      </div>
    ),
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
