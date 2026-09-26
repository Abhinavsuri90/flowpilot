import * as React from 'react'
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Download, ScrollText, ShieldAlert } from 'lucide-react'
import { api, qs } from '~/lib/api'
import { formatDateTime, timeAgo } from '~/lib/format'
import type { AuditCategory, AuditPage, WorkspaceInfo } from '~/lib/types'
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Segmented, Select, Skeleton, buttonClass, type Tone } from '~/components/ui'
import { ErrorState } from '~/components/states'

const CATEGORIES = ['all', 'recipes', 'sharing', 'people', 'invites', 'workspace'] as const
const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  all: 'Everything',
  recipes: 'Recipes',
  sharing: 'Sharing',
  people: 'People',
  invites: 'Invites',
  workspace: 'Workspace',
}
const CATEGORY_TONE: Record<AuditCategory, Tone> = { recipes: 'brand', sharing: 'flow', people: 'ai', invites: 'warn', workspace: 'neutral' }

const Search_ = z.object({
  category: z.enum(CATEGORIES).default('all').catch('all'),
  actor: z.string().max(64).default('').catch(''),
})

export const Route = createFileRoute('/_app/audit')({
  validateSearch: Search_,
  search: { middlewares: [stripSearchParams({ category: 'all', actor: '' })] },
  head: () => ({ meta: [{ title: 'Audit log · FlowPilot' }] }),
  component: AuditPageView,
})

function AuditPageView() {
  const { me } = Route.useRouteContext()
  const { category, actor } = Route.useSearch()
  const navigate = useNavigate({ from: '/audit' })
  const isAdmin = me.workspace?.role === 'admin'
  const workspace = me.workspace?.workspaceName ?? 'this workspace'

  const members = useQuery({ queryKey: ['workspace'], queryFn: () => api.get<WorkspaceInfo>('/api/workspace'), enabled: isAdmin })
  const filters = { category: category === 'all' ? undefined : category, actor: actor || undefined }
  const log = useInfiniteQuery({
    queryKey: ['audit', category, actor],
    queryFn: ({ pageParam }) => api.get<AuditPage>(`/api/workspace/audit${qs({ ...filters, before: pageParam ?? undefined })}`),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  })
  const entries = React.useMemo(() => log.data?.pages.flatMap((p) => p.entries) ?? [], [log.data])

  if (!isAdmin) {
    return (
      <>
        <PageHeader eyebrow="Governance" title="Audit log" />
        <EmptyState
          icon={<ShieldAlert />}
          title="Only admins can read the audit log"
          description={`Ask an admin of ${workspace} if you need to know who changed what.`}
          action={
            <Link to="/access" className={buttonClass('secondary')}>
              See who the admins are
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description={`Every change in ${workspace}: recipes, sharing, people and invites, newest first. Runs aren't listed; they stay private to whoever ran them. Private recipes you can't see are named only as "a private recipe".`}
        actions={
          <a href={`/api/workspace/audit.csv${qs(filters)}`} download className={buttonClass('secondary')}>
            <Download className="size-4" /> Export CSV
          </a>
        }
      />
      <div className="animate-rise mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          label="What kind of change"
          value={category}
          onChange={(value) => navigate({ search: (prev) => ({ ...prev, category: value }) })}
          items={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
        <Select
          aria-label="Who made the change"
          value={actor}
          wrapperClassName="w-full lg:w-60"
          onChange={(e) => navigate({ search: (prev) => ({ ...prev, actor: e.target.value }) })}
        >
          <option value="">Anyone</option>
          {members.data?.members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.name}
            </option>
          ))}
        </Select>
      </div>

      {log.isPending ? (
        <Card className="space-y-3 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </Card>
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={() => log.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="Nothing here yet" description="Changes appear here as people work in the workspace." />
      ) : (
        <Card className="animate-rise overflow-hidden">
          <ol className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={e.actor.name} hue={e.actor.hue} size={28} />
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-ink">
                      {e.text}
                      {e.recipe && (
                        <>
                          {' · '}
                          <Link to="/w/$workflowId" params={{ workflowId: e.recipe.id }} className="font-medium text-brand-ink hover:underline">
                            Open
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint" title={formatDateTime(e.at)}>
                      {timeAgo(e.at)} · <span className="font-mono">{e.action}</span>
                    </p>
                  </div>
                </div>
                <Badge tone={CATEGORY_TONE[e.category]} className="self-start sm:self-center">
                  {CATEGORY_LABEL[e.category]}
                </Badge>
              </li>
            ))}
          </ol>
          {log.hasNextPage && (
            <div className="border-t border-line px-5 py-3 text-center">
              <Button variant="secondary" size="sm" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                Load older
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
