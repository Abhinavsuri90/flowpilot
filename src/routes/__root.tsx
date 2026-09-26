/// <reference types="vite/client" />
import * as React from 'react'
import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import appCss from '~/styles/app.css?url'
import { ToastProvider } from '~/components/toast'
import { THEME_SCRIPT } from '~/components/theme'
import { ErrorState, NotFoundState } from '~/components/states'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'FlowPilot' },
      {
        name: 'description',
        content: 'Turn a repetitive CSV report into a saved, versioned recipe your whole team can run on their own files.',
      },
      { name: 'color-scheme', content: 'light dark' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl p-10">
      <NotFoundState />
    </div>
  ),
  // A render error anywhere shows a plain page with a retry instead of a blank screen.
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-xl p-10">
      <ErrorState error={error} onRetry={reset} />
    </div>
  ),
})

/** Marks the document once React has hydrated (used by browser tests before interacting). */
function HydrationFlag() {
  React.useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])
  return null
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint (our own constant script, no user content). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <HydrationFlag />
        <Scripts />
      </body>
    </html>
  )
}
