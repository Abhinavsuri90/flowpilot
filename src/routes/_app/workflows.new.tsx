import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { canCreateInWorkspace } from '~/lib/policy'
import { definitionToDraft, emptyDraft, mergeColumns, type Draft, type DraftColumn } from '~/lib/workflow/draft'
import { TEMPLATES, type Template } from '~/lib/workflow/templates'
import { fetchSample } from '~/lib/samples'
import { inferColumns } from '~/lib/csv'
import { PageHeader, buttonClass } from '~/components/ui'
import { RecipeEditor } from '~/components/editor'
import { TemplateGallery } from '~/components/templates'
import { ForbiddenState } from '~/components/states'
import { useToast } from '~/components/toast'

export const Route = createFileRoute('/_app/workflows/new')({
  // ?template=<key> opens the editor with that template loaded (links from the library and the landing page).
  validateSearch: z.object({ template: z.string().max(64).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: 'New recipe · FlowPilot' }] }),
  component: NewRecipe,
})

/** The template as an editor draft; sample values come from its sample file when it can be read. */
async function templateDraft(template: Template): Promise<Draft> {
  const loaded = definitionToDraft(template.definition)
  let columns: DraftColumn[] = loaded.columns
  try {
    const sample = await fetchSample(template.sample)
    const inferred = inferColumns(new Uint8Array(await sample.arrayBuffer())).columns
    const fromSample: DraftColumn[] = inferred.map((c) => ({ name: c.name, type: c.type, include: true, samples: c.samples, blanks: c.blanks, values: c.values }))
    columns = mergeColumns(fromSample, loaded.columns)
  } catch {
    // The template still loads without sample values.
  }
  return { ...emptyDraft(), ...loaded, columns, title: template.title, description: template.description, request: template.request, origin: 'blank' }
}

function NewRecipe() {
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const toast = useToast()
  const [initial, setInitial] = React.useState<Draft>(emptyDraft)
  const [picked, setPicked] = React.useState<Template | null>(null)
  // Remounts the editor with the new starting draft (its unsaved-changes guard compares against `initial`).
  const [editorKey, setEditorKey] = React.useState(0)

  const pick = React.useCallback(
    async (template: Template) => {
      const draft = await templateDraft(template)
      setInitial(draft)
      setPicked(template)
      setEditorKey((k) => k + 1)
      toast.show({ tone: 'ok', title: `Loaded “${template.title}”`, description: 'Adjust anything you like, then save it as your own recipe.' })
    },
    [toast],
  )

  // A ?template= link picks its template once (the ref keeps a re-run effect from loading it twice).
  const requested = search.template
  const handled = React.useRef<string | null>(null)
  React.useEffect(() => {
    const template = requested ? TEMPLATES.find((t) => t.key === requested) : undefined
    if (!template || handled.current === template.key) return
    handled.current = template.key
    void pick(template)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the link changes
  }, [requested])

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
        description="Start from a template or from scratch: declare the columns your files have, describe the report, then check each step. You can run it on any compatible file once it's saved."
      />
      <TemplateGallery onPick={(t) => void pick(t)} picked={picked} />
      <RecipeEditor key={editorKey} mode="create" initial={initial} me={me} />
    </>
  )
}
