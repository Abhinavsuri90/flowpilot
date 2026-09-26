import * as React from 'react'
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { FolderOpen, Plus, Search, Users, X } from 'lucide-react'
import { api, qk, qs } from '~/lib/api'
import type { WorkflowList, WorkflowSummary } from '~/lib/types'
import { canCreateInWorkspace } from '~/lib/policy'
import { Button, EmptyState, PageHeader, Segmented, Skeleton, buttonClass } from '~/components/ui'
import { RecipeCard } from '~/components/workflow-bits'
import { ForkDialog } from '~/components/fork-dialog'
import { ErrorState } from '~/components/states'

const Search_ = z.object({
  tab: z.enum(['mine', 'team']).default('mine').catch('mine'),
  q: z.string().max(100).default('').catch(''),
})

export const Route = createFileRoute('/_app/library')({
  validateSearch: Search_,
  // Default values stay out of the URL (no redirect to ?tab=mine&q=).
  search: { middlewares: [stripSearchParams({ tab: 'mine', q: '' })] },
  head: () => ({ meta: [{ title: 'Recipe library · FlowPilot' }] }),
  component: Library,
})

function Library() {
  const { tab, q } = Route.useSearch()
  const { me } = Route.useRouteContext()
  const navigate = useNavigate({ from: '/library' })
  const [text, setText] = React.useState(q)
  const [forkTarget, setForkTarget] = React.useState<WorkflowSummary | null>(null)

  // Debounced search, kept in the URL so it survives reloads and can be shared.
  // `pushed` is the last value this box sent to the URL: when that lands, the box
  // keeps whatever was typed since; any other change to ?q= (Back, a link) is shown.
  const [pushed, setPushed] = React.useState(q)
  const [seenQ, setSeenQ] = React.useState(q)
  if (q !== seenQ) {
    setSeenQ(q)
    if (q !== pushed) {
      setPushed(q)
      setText(q)
    }
  }
  React.useEffect(() => {
    if (text === q) return
    const t = window.setTimeout(() => {
      setPushed(text)
      void navigate({ search: (prev) => ({ ...prev, q: text }), replace: true })
    }, 250)
    return () => window.clearTimeout(t)
  }, [text, q, navigate])

  // One page of recipes at a time ("Show more" loads the next).
  const list = useInfiniteQuery({
    queryKey: qk.library(tab, q),
    queryFn: ({ pageParam }) => api.get<WorkflowList>(`/api/workflows${qs({ scope: tab, q, offset: pageParam || undefined })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  })
  const firstPage = list.data?.pages[0]
  const items = React.useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const remaining = firstPage ? firstPage.total - items.length : 0
  const canCreate = canCreateInWorkspace(me.workspace?.role ?? null)
  const workspace = me.workspace?.workspaceName ?? 'your workspace'

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Recipe library"
        description={`Recipes you own, and recipes shared with ${workspace}. Open one to run it on your own file.`}
      />

      <div className="animate-rise mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Which recipes"
          value={tab}
          onChange={(value) => navigate({ search: (prev) => ({ ...prev, tab: value }) })}
          items={[
            { value: 'mine', label: 'My workflows', count: firstPage?.counts.mine, icon: <FolderOpen /> },
            { value: 'team', label: 'Team library', count: firstPage?.counts.team, icon: <Users /> },
          ]}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by title or description"
            aria-label="Search recipes"
            className="h-9.5 w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-sm text-ink shadow-soft placeholder:text-faint hover:border-line-strong focus:border-brand focus:outline-none"
          />
          {text && (
            <button
              type="button"
              onClick={() => setText('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-sunken hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {list.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
              <Skeleton className="mt-6 h-7 w-1/2" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        q ? (
          <EmptyState icon={<Search />} title={`No recipes match “${q}”`} description="Try a different word, or clear the search." />
        ) : tab === 'mine' ? (
          <EmptyState
            icon={<FolderOpen />}
            title="You don't own any recipes yet"
            description={
              canCreate
                ? 'Describe a repetitive CSV report and turn it into a recipe, or make a copy of one from the team library.'
                : 'As a viewer you can run recipes shared with your team from the Team library tab.'
            }
            action={
              canCreate ? (
                <Link to="/workflows/new" className={buttonClass('brand')}>
                  <Plus className="size-4" /> New recipe
                </Link>
              ) : (
                <Link to="/library" search={{ tab: 'team' }} className={buttonClass('secondary')}>
                  Open the team library
                </Link>
              )
            }
          />
        ) : (
          <EmptyState icon={<Users />} title="Nothing shared yet" description={`When someone in ${workspace} shares a recipe, it appears here.`} />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((recipe, i) => (
              <div key={recipe.id} className="animate-rise" style={{ animationDelay: `${Math.min(i % 60, 8) * 40}ms` }}>
                <RecipeCard recipe={recipe} onFork={setForkTarget} />
              </div>
            ))}
          </div>
          {list.hasNextPage && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-[13px] text-muted">
                Showing {items.length} of {firstPage!.total} recipes
              </p>
              <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Show {Math.min(remaining, 60)} more
              </Button>
            </div>
          )}
        </>
      )}

      <ForkDialog
        target={
          forkTarget && {
            id: forkTarget.id,
            title: forkTarget.title,
            versionId: forkTarget.currentVersion.id,
            versions: [forkTarget.currentVersion],
          }
        }
        onClose={() => setForkTarget(null)}
      />
    </>
  )
}
