import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  Circle,
  CopyPlus,
  FolderOpen,
  History,
  Network,
  Play,
  Plus,
  Share2,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react'
import { api, qk } from '~/lib/api'
import { canCreateInWorkspace } from '~/lib/policy'
import { timeAgo } from '~/lib/format'
import type { Dashboard as DashboardData, Me } from '~/lib/types'
import { Avatar, Card, CardHeader, Skeleton, buttonClass, cn } from '~/components/ui'
import { RunStatusBadge } from '~/components/workflow-bits'
import { RunChart } from '~/components/charts'
import { ErrorState } from '~/components/states'

export const Route = createFileRoute('/_app/')({
  head: () => ({ meta: [{ title: 'Dashboard · FlowPilot' }] }),
  component: Dashboard,
})

function Dashboard() {
  const { me } = Route.useRouteContext()
  const dash = useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<DashboardData>('/api/dashboard') })

  return (
    <div className="space-y-6">
      <Hero me={me} data={dash.data} />
      {dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      ) : (
        <>
          <Stats me={me} data={dash.data} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="animate-rise">
              <CardHeader icon={<Activity />} title="My runs, last 14 days" description="Succeeded and failed runs per day (UTC). Only your own runs." />
              <div className="px-5 pb-5">{dash.data ? <RunChart data={dash.data.runsByDay} /> : <Skeleton className="h-56" />}</div>
            </Card>
            <RecentRuns data={dash.data} />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ActivityFeed data={dash.data} />
            <SystemTeaser />
          </div>
        </>
      )}
    </div>
  )
}

// ----- Hero + reuse-loop checklist -----------------------------------------------------

function Hero({ me, data }: { me: Me; data?: DashboardData }) {
  const canCreate = canCreateInWorkspace(me.workspace?.role ?? null)
  const ws = me.workspace?.workspaceName ?? 'your workspace'
  // Viewers can't create or copy, so their loop is the part they can do.
  const steps = canCreate
    ? [
        { done: data?.checklist.created, icon: <Sparkles />, label: 'Describe and save a recipe', hint: 'AI drafts, you review' },
        { done: data?.checklist.ran, icon: <Play />, label: 'Run it on a file', hint: 'No AI on reruns' },
        { done: data?.checklist.shared, icon: <Share2 />, label: `Share it with ${ws}`, hint: 'A link is a pointer, not a grant' },
        { done: data?.checklist.copied, icon: <CopyPlus />, label: 'A teammate makes a copy', hint: 'Their copy never changes yours' },
      ]
    : [
        { done: (data?.stats.teamRecipes ?? 0) > 0, icon: <Users />, label: `Find a recipe shared in ${ws}`, hint: 'In the Team library' },
        { done: data?.checklist.ran, icon: <Play />, label: 'Run it on your own file', hint: 'Results stay private to you' },
      ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <section className="animate-rise relative overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="bg-dots absolute inset-0 opacity-70" aria-hidden />
      <div className="absolute -top-24 -right-16 size-80 rounded-full bg-[var(--glow-brand)] blur-3xl" aria-hidden />
      <div className="absolute -bottom-28 left-1/3 size-72 rounded-full bg-[var(--glow-flow)] blur-3xl" aria-hidden />
      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <div className="text-[12px] font-semibold tracking-wide text-brand-ink uppercase">
            {ws} · {me.workspace?.role ?? 'no role'}
          </div>
          <h1 className="mt-2 text-balance text-[28px] font-semibold tracking-tight text-ink sm:text-[34px]">
            Welcome back, {me.user.name.split(' ')[0]}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            Build a report recipe once. Anyone in {ws} can run it on their own file, or make an independent copy, and the
            original never changes.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {canCreate && (
              <Link to="/workflows/new" className={buttonClass('brand', 'lg')}>
                <Plus className="size-4" /> New recipe
              </Link>
            )}
            <Link to="/library" search={{ tab: 'team' }} className={buttonClass('secondary', 'lg')}>
              <Users className="size-4" /> Team library
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface/90 p-5 shadow-soft backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">The reuse loop</h2>
            <span className="text-[12px] text-muted">
              {data ? `${doneCount} of ${steps.length}` : '…'}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--flow))] transition-[width] duration-700"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          {!canCreate && (
            <p className="mt-3 text-[12px] text-muted">As a viewer you can run any recipe shared with {ws}. An admin can make you a member so you can create and copy recipes too.</p>
          )}
          <ol className="mt-4 space-y-2.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                {s.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-ok" aria-label="Done" />
                ) : (
                  <Circle className="size-5 shrink-0 text-line-strong" aria-label="Not yet" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13.5px] font-medium', s.done ? 'text-ink' : 'text-ink-2')}>{s.label}</span>
                  <span className="block text-[12px] text-faint">{s.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

// ----- Stat tiles ----------------------------------------------------------------------

function Stats({ me, data }: { me: Me; data?: DashboardData }) {
  const ws = me.workspace?.workspaceName ?? 'your workspace'
  const tiles = data
    ? [
        { icon: <FolderOpen />, label: 'My recipes', value: data.stats.myRecipes, sub: `${data.stats.sharedByMe} shared with ${ws}`, tone: 'brand' },
        { icon: <BookMarked />, label: 'Team library', value: data.stats.teamRecipes, sub: `recipes shared in ${ws}`, tone: 'brand' },
        { icon: <History />, label: 'My runs · 7 days', value: data.stats.myRuns7d, sub: `${data.stats.succeeded7d} succeeded`, tone: 'flow' },
        { icon: <CopyPlus />, label: 'Copies of my recipes', value: data.stats.copiesOfMine, sub: 'private copies teammates made', tone: 'ai' },
      ]
    : null
  const toneClass = { brand: 'bg-brand-soft text-brand-ink', flow: 'bg-flow-soft text-flow-ink', ai: 'bg-ai-soft text-ai-ink' } as const
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles
        ? tiles.map((t, i) => (
            <Card key={t.label} className="animate-rise p-5" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted">{t.label}</span>
                <span className={cn('grid size-8 place-items-center rounded-lg [&_svg]:size-4', toneClass[t.tone as keyof typeof toneClass])}>{t.icon}</span>
              </div>
              <div className="mt-3 text-[30px] leading-none font-semibold tracking-tight text-ink">{t.value}</div>
              <div className="mt-2 truncate text-[12.5px] text-muted">{t.sub}</div>
            </Card>
          ))
        : Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-4 h-8 w-12" />
              <Skeleton className="mt-3 h-3 w-36" />
            </Card>
          ))}
    </div>
  )
}

// ----- Recent runs ---------------------------------------------------------------------

function RecentRuns({ data }: { data?: DashboardData }) {
  return (
    <Card className="animate-rise flex flex-col">
      <CardHeader
        icon={<History />}
        tone="flow"
        title="Recent runs"
        description="Your latest results"
        actions={
          <Link to="/runs" className="text-[12.5px] font-medium text-brand-ink hover:underline">
            All runs
          </Link>
        }
      />
      <div className="flex-1 px-5 pb-5">
        {!data ? (
          <div className="space-y-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : data.recentRuns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-muted">
            No runs yet. Open a recipe and run it on your own file.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recentRuns.map((r) => (
              <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    {r.recipeAvailable ? (
                      <Link
                        to="/w/$workflowId"
                        params={{ workflowId: r.workflowId }}
                        search={{ run: r.id, v: r.versionId }}
                        className="block truncate text-[13.5px] font-medium text-ink hover:text-brand-ink"
                      >
                        {r.workflowTitle}
                      </Link>
                    ) : (
                      <span className="block truncate text-[13.5px] text-muted italic">Recipe no longer available</span>
                    )}
                    <span className="block truncate text-[12px] text-muted">
                      v{r.versionNumber} · {r.inputName ?? 'file'}
                      {r.rowCount !== null ? ` · ${r.rowCount} row${r.rowCount === 1 ? '' : 's'}` : ''} · {timeAgo(r.createdAt)}
                    </span>
                  </div>
                  <RunStatusBadge status={r.status} errorCode={r.errorCode} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

// ----- Activity ------------------------------------------------------------------------

function ActivityFeed({ data }: { data?: DashboardData }) {
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<Activity />}
        title="Activity"
        description="Filtered by the same rules as everything else: others’ runs and private copies stay hidden."
      />
      <div className="px-5 pb-5">
        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : data.activity.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-muted">Nothing here yet.</p>
        ) : (
          <ol className="relative space-y-3.5 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-line">
            {data.activity.map((item) => {
              const body = (
                <>
                  <span className="text-ink-2">{item.text}</span>
                  <span className="ml-1.5 text-[12px] text-faint">{timeAgo(item.createdAt)}</span>
                </>
              )
              return (
                <li key={item.id} className="relative flex items-start gap-3">
                  <Avatar name={item.actor.name} hue={item.actor.hue} size={27} ring />
                  <p className="min-w-0 flex-1 pt-1 text-[13.5px] leading-snug">
                    {item.workflowId ? (
                      <Link
                        to="/w/$workflowId"
                        params={{ workflowId: item.workflowId }}
                        search={item.runId ? { run: item.runId } : {}}
                        className="hover:underline"
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Card>
  )
}

// ----- System design teaser ------------------------------------------------------------

function SystemTeaser() {
  return (
    <Link
      to="/system-design"
      className="group animate-rise relative flex flex-col overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar p-6 text-sidebar-ink shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="bg-grid absolute inset-0 opacity-50 [--dot:rgb(255_255_255/0.05)]" aria-hidden />
      <div className="absolute -right-10 -bottom-16 size-56 rounded-full bg-[var(--brand)] opacity-25 blur-3xl" aria-hidden />
      <div className="relative flex items-center gap-2 text-[12px] font-semibold tracking-wide text-[#9aa6ff] uppercase">
        <Network className="size-4" /> System design
      </div>
      <h2 className="relative mt-2 text-[19px] font-semibold tracking-tight text-white">How FlowPilot keeps AI out of the run path</h2>
      <p className="relative mt-2 text-[13.5px] leading-relaxed text-sidebar-muted">
        Two paths share only the dispatcher, the access policy and the validator. See the live schema, triggers and limits of
        this running system.
      </p>
      <div className="relative mt-5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12px]">
        <span className="h-0.5 w-6 rounded-full bg-[#a78bfa]" aria-hidden />
        <span className="text-sidebar-ink">Authoring: AI drafts, you save</span>
        <span className="h-0.5 w-6 rounded-full bg-[#26c2bb]" aria-hidden />
        <span className="text-sidebar-ink">Execution: no AI, deterministic engine</span>
      </div>
      <span className="relative mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
        <Workflow className="size-4" /> Explore the design <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
