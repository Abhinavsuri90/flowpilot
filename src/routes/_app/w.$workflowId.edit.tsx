import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { api, qk } from '~/lib/api'
import { definitionToDraft, emptyDraft, type Draft } from '~/lib/workflow/draft'
import type { Me, WorkflowDetail } from '~/lib/types'
import { PageHeader, buttonClass } from '~/components/ui'
import { RecipeEditor } from '~/components/editor'
import { ErrorState, ForbiddenState, PageSkeleton } from '~/components/states'

export const Route = createFileRoute('/_app/w/$workflowId/edit')({
  head: () => ({ meta: [{ title: 'Edit recipe · FlowPilot' }] }),
  component: EditRecipe,
})

function EditRecipe() {
  const { workflowId } = Route.useParams()
  const { me } = Route.useRouteContext()
  const detail = useQuery({
    queryKey: qk.workflow(workflowId),
    queryFn: () => api.get<WorkflowDetail>(`/api/workflows/${workflowId}`),
  })

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
  if (!detail.data.permissions.edit.allowed) {
    return (
      <ForbiddenState
        title="Only the owner can edit this recipe"
        description={`${detail.data.permissions.edit.reason} Your copy would be private to you and independent of the original.`}
        action={
          <Link to="/w/$workflowId" params={{ workflowId }} className={buttonClass('secondary')}>
            Back to the recipe
          </Link>
        }
      />
    )
  }
  return <EditLoaded detail={detail.data} me={me} />
}

function EditLoaded({ detail, me }: { detail: WorkflowDetail; me: Me }) {
  const wf = detail.workflow
  const initial = React.useMemo<Draft>(
    () => ({ ...emptyDraft(), title: wf.title, description: wf.description, ...definitionToDraft(detail.version.definition), origin: 'saved' }),
    // Rebuild only when a different version is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail.version.id],
  )
  return (
    <>
      <Link to="/w/$workflowId" params={{ workflowId: wf.id }} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Back to {wf.title}
      </Link>
      <PageHeader
        eyebrow={`Editing · version ${detail.latestVersionNumber}`}
        title={wf.title}
        description={`Saving creates version ${detail.latestVersionNumber + 1}. Version ${detail.latestVersionNumber} and every run made with it stay exactly as they are.`}
      />
      <RecipeEditor
        key={detail.version.id}
        mode="edit"
        initial={initial}
        me={me}
        workflowId={wf.id}
        currentVersion={detail.latestVersionNumber}
        savedTitle={wf.title}
        savedDescription={wf.description}
      />
    </>
  )
}
