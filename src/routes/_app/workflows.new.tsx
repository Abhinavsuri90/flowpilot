import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { canCreateInWorkspace } from '~/lib/policy'
import { emptyDraft } from '~/lib/workflow/draft'
import { PageHeader, buttonClass } from '~/components/ui'
import { RecipeEditor } from '~/components/editor'
import { ForbiddenState } from '~/components/states'

export const Route = createFileRoute('/_app/workflows/new')({
  head: () => ({ meta: [{ title: 'New recipe · FlowPilot' }] }),
  component: NewRecipe,
})

function NewRecipe() {
  const { me } = Route.useRouteContext()
  const [initial] = React.useState(emptyDraft)

  if (!canCreateInWorkspace(me.workspace?.role ?? null)) {
    return (
      <ForbiddenState
        title="Viewers can run recipes but can't create them"
        description="Open the team library to run a recipe on your own file. An admin can change your role if you need to create recipes."
        action={
          <Link to="/library" search={{ tab: 'team' }} className={buttonClass('secondary')}>
            Open the team library
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={`New recipe · ${me.workspace?.workspaceName ?? ''}`}
        title="Describe it, review it, save it"
        description="Declare the columns your files have, describe the report, then check each step. You can run it on any compatible file once it's saved."
      />
      <RecipeEditor mode="create" initial={initial} me={me} />
    </>
  )
}
