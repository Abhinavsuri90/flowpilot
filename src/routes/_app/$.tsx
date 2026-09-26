import { createFileRoute, notFound } from '@tanstack/react-router'
import { NotFoundState } from '~/components/states'

// Any other address, for a signed-in person: a 404 rendered inside the app, so the
// sidebar and search stay available (signed-out visitors go to /login first).
// The not-found boundary is this route itself, which sits in the shell's Outlet.
export const Route = createFileRoute('/_app/$')({
  loader: () => {
    throw notFound()
  },
  notFoundComponent: () => <NotFoundState />,
  head: () => ({ meta: [{ title: 'Not found · FlowPilot' }] }),
})
