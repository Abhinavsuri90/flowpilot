import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '~/lib/session'
import { AppShell } from '~/components/shell'

// Route UX guard: signed-out visitors go to /login. Every API endpoint still
// authorizes each request on its own; this is not the security boundary.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const me = await getSessionFn()
    if (!me) {
      // The front door shows what FlowPilot is; deeper links go to sign-in and come back.
      if (location.pathname === '/') throw redirect({ to: '/welcome' })
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { me }
  },
  component: AppLayout,
})

function AppLayout() {
  const { me } = Route.useRouteContext()
  return (
    <AppShell me={me}>
      <Outlet />
    </AppShell>
  )
}
