import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/ui'

export const Route = createFileRoute('/_app/')({
  head: () => ({ meta: [{ title: 'Dashboard · FlowPilot' }] }),
  component: Dashboard,
})

function Dashboard() {
  const { me } = Route.useRouteContext()
  return (
    <PageHeader
      eyebrow={me.workspace?.workspaceName ?? 'No workspace'}
      title={`Welcome back, ${me.user.name.split(' ')[0]}`}
      description="Your recipes, runs and team activity will appear here."
    />
  )
}
