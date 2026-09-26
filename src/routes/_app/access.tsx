import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  EyeOff,
  Fingerprint,
  KeyRound,
  Link2,
  Lock,
  ShieldCheck,
  ShieldHalf,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react'
import { api, ApiError, qk, qs } from '~/lib/api'
import { MATRIX_COLUMNS, permissionMatrix, type MatrixCell } from '~/lib/policy'
import type { Role, Visibility, WorkflowList, WorkflowSummary, WorkspaceInfo } from '~/lib/types'
import { Avatar, Badge, Card, CardHeader, PageHeader, Segmented, Select, Skeleton, Switch, Tip, cn } from '~/components/ui'
import { RoleBadge, VisibilityBadge } from '~/components/workflow-bits'
import { CopyLinkButton, shareLink } from '~/components/share-dialog'
import { ErrorState } from '~/components/states'
import { useToast } from '~/components/toast'

export const Route = createFileRoute('/_app/access')({
  head: () => ({ meta: [{ title: 'Access and sharing · FlowPilot' }] }),
  component: AccessPage,
})

function AccessPage() {
  const { me } = Route.useRouteContext()
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Access and sharing"
        description="One set of policy functions decides every permission. The server enforces them on every request, and this page renders its matrix from the very same functions."
      />
      <div className="space-y-6">
        <MatrixCard myRole={me.workspace?.role ?? null} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <MembersCard />
          <MyRecipesCard />
        </div>
        <PrinciplesCard />
      </div>
    </>
  )
}

// ----- Permission matrix ----------------------------------------------------------

function Cell({ cell }: { cell: MatrixCell }) {
  const tone = cell.allowed
    ? 'bg-ok-soft text-ok-ink'
    : cell.status === 404
      ? 'bg-sunken text-muted'
      : cell.status === 403
        ? 'bg-warn-soft text-warn-ink'
        : 'bg-transparent text-faint'
  return (
    <Tip content={cell.reason}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium whitespace-nowrap', tone)}>
        {cell.allowed ? <Check className="size-3.5" aria-hidden /> : cell.status === 404 ? <EyeOff className="size-3.5" aria-hidden /> : null}
        {cell.label}
      </span>
    </Tip>
  )
}

function MatrixCard({ myRole }: { myRole: Role | null }) {
  const [visibility, setVisibility] = React.useState<Visibility>('team')
  const rows = permissionMatrix(visibility)
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<ShieldCheck />}
        title="Permission matrix"
        description={
          visibility === 'team'
            ? 'For a recipe shared with its workspace. Hover a cell for the reason.'
            : 'For a private recipe: everyone but the owner gets 404, as if it did not exist.'
        }
        actions={
          <Segmented
            label="Recipe visibility"
            value={visibility}
            onChange={setVisibility}
            items={[
              { value: 'team', label: 'Team', icon: <Users /> },
              { value: 'private', label: 'Private', icon: <Lock /> },
            ]}
          />
        }
      />
      <div className="scrollbar-thin relative overflow-x-auto px-5 pb-5">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="pb-2.5 text-left text-[11.5px] font-medium text-faint">
                Action
              </th>
              {MATRIX_COLUMNS.map((col) => {
                const mine = col.key === myRole
                return (
                  <th key={col.key} scope="col" className="pb-2.5 text-center text-[12px] font-semibold text-ink-2">
                    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5', mine && 'bg-brand-soft text-brand-ink')}>
                      {col.label}
                      {mine && <span className="text-[10.5px] font-normal">(you)</span>}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={i} className="py-2 text-center">
                    <Cell cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-ok-soft ring-1 ring-ok/30" /> Allowed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-warn-soft ring-1 ring-warn/30" /> 403: visible, but not yours to change
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-sunken ring-1 ring-line-strong" /> 404: hidden, as if it didn&rsquo;t exist
          </span>
        </div>
      </div>
    </Card>
  )
}

// ----- Members and roles ----------------------------------------------------------

function MembersCard() {
  const ws = useQuery({ queryKey: qk.workspace, queryFn: () => api.get<WorkspaceInfo>('/api/workspace') })
  const queryClient = useQueryClient()
  const toast = useToast()
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/api/workspace/members/${userId}`, { role }),
    onSuccess: async (_res, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workspace }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
        queryClient.invalidateQueries({ queryKey: ['access'] }),
      ])
      const name = ws.data?.members.find((m) => m.user.id === vars.userId)?.user.name ?? 'Member'
      toast.show({ tone: 'ok', title: `${name} is now ${vars.role === 'admin' ? 'an' : 'a'} ${vars.role}`, description: 'It applies on their next request; no re-login needed.' })
    },
    onError: (err) => toast.show({ tone: 'bad', title: 'Role not changed', description: err instanceof ApiError ? err.message : String(err) }),
  })

  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<UserCog />}
        title={ws.data ? `Members of ${ws.data.workspace.name}` : 'Members'}
        description={
          ws.data?.canManageRoles
            ? 'As an admin you manage roles only: you can’t edit other people’s recipes or see their runs.'
            : 'Only admins change roles.'
        }
      />
      <div className="px-5 pb-5">
        {ws.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : ws.isError ? (
          <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {ws.data.members.map((m) => {
              const lastAdmin = m.role === 'admin' && ws.data.adminCount <= 1
              const reason = m.isYou ? "You can't change your own role" : lastAdmin ? "The last admin can't be demoted" : null
              return (
                <li key={m.user.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={m.user.name} hue={m.user.hue} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">
                      {m.user.name} {m.isYou && <span className="text-[12px] font-normal text-faint">(you)</span>}
                    </div>
                    <div className="truncate text-[12px] text-muted">{m.user.email}</div>
                  </div>
                  {ws.data.canManageRoles && !reason ? (
                    <Select
                      aria-label={`Role of ${m.user.name}`}
                      value={m.role}
                      disabled={setRole.isPending}
                      wrapperClassName="w-32"
                      className="!h-8 !rounded-lg text-[13px]"
                      onChange={(e) => setRole.mutate({ userId: m.user.id, role: e.target.value as Role })}
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </Select>
                  ) : ws.data.canManageRoles && reason ? (
                    <Tip content={reason}>
                      <span tabIndex={0}>
                        <RoleBadge role={m.role} />
                      </span>
                    </Tip>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-muted">
          Roles are read on every request. People outside {ws.data?.workspace.name ?? 'this workspace'} never appear here and can’t see its recipes.
        </p>
      </div>
    </Card>
  )
}

// ----- One-click share / unshare ----------------------------------------------------

/** Recipes listed for one-click sharing, most recently updated first. */
const MY_RECIPES_SHOWN = 100

function MyRecipesCard() {
  const mine = useQuery({
    queryKey: qk.workflows('mine', '', MY_RECIPES_SHOWN),
    queryFn: () => api.get<WorkflowList>(`/api/workflows${qs({ scope: 'mine', limit: MY_RECIPES_SHOWN })}`),
  })
  const queryClient = useQueryClient()
  const toast = useToast()
  const share = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) =>
      api.patch<{ workflow: WorkflowSummary }>(`/api/workflows/${id}`, { visibility }),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
        queryClient.invalidateQueries({ queryKey: qk.workflowAll(res.workflow.id) }),
        queryClient.invalidateQueries({ queryKey: qk.access(res.workflow.id) }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      toast.show({
        tone: 'ok',
        title: res.workflow.visibility === 'team' ? `Shared with ${res.workflow.workspace.name}` : `${res.workflow.title} is private`,
        description:
          res.workflow.visibility === 'team' ? 'Teammates can find it in the Team library now.' : 'New access is blocked immediately. Copies already made keep working.',
      })
    },
    onError: (err) => toast.show({ tone: 'bad', title: 'Sharing not changed', description: err instanceof Error ? err.message : String(err) }),
  })

  const items = mine.data?.items ?? []
  return (
    <Card className="animate-rise">
      <CardHeader icon={<UsersRound />} title="Your recipes" description="Share with your workspace, or make private again, in one click." />
      <div className="px-5 pb-5">
        {mine.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
            You don’t own any recipes yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link to="/w/$workflowId" params={{ workflowId: r.id }} className="block truncate text-[13.5px] font-medium text-ink hover:text-brand-ink">
                    {r.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <VisibilityBadge visibility={r.visibility} workspace={r.workspace.name} />
                    <span className="text-[12px] text-faint">v{r.currentVersion.number}</span>
                  </div>
                </div>
                {r.visibility === 'team' && <CopyLinkButton href={shareLink(r.id, r.currentVersion.id)} label="Link" />}
                <Switch
                  label={r.visibility === 'team' ? `Make ${r.title} private` : `Share ${r.title} with ${r.workspace.name}`}
                  checked={r.visibility === 'team'}
                  disabled={share.isPending}
                  onChange={(on) => share.mutate({ id: r.id, visibility: on ? 'team' : 'private' })}
                />
              </li>
            ))}
          </ul>
        )}
        {mine.data && mine.data.total > items.length && (
          <p className="mt-3 text-[12.5px] text-muted">
            Showing your {items.length} most recently updated recipes of {mine.data.total}.{' '}
            <Link to="/library" className="font-medium text-brand-ink hover:underline">
              Find the others in the library
            </Link>{' '}
            and share them from their page.
          </p>
        )}
      </div>
    </Card>
  )
}

// ----- Principles -------------------------------------------------------------------

const PRINCIPLES = [
  {
    icon: <EyeOff />,
    title: '404 hides existence',
    body: 'If you can’t see a recipe, version or run, the API answers exactly as if it didn’t exist. 403 only means “you can see it, but it isn’t yours to change”.',
  },
  {
    icon: <Fingerprint />,
    title: 'Identity comes from the session',
    body: 'Owner, workspace and runner are set on the server. An owner_id sent by a browser is ignored on create and rejected on update.',
  },
  {
    icon: <KeyRound />,
    title: 'Runs are private to the runner',
    body: 'Uploaded files are never stored, and results are visible only to whoever ran them: not the recipe’s owner, not admins.',
  },
  {
    icon: <Link2 />,
    title: 'A share link is a pointer, not a grant',
    body: 'Links pin a version, and access is checked again on every request. A version id from another recipe answers 404.',
  },
  {
    icon: <Lock />,
    title: 'Unsharing is immediate',
    body: 'Making a recipe private blocks new access at once. Copies people already made keep working, with the source hidden.',
  },
  {
    icon: <ShieldHalf />,
    title: 'Admins manage roles, not recipes',
    body: 'Admins can’t edit others’ recipes or read their runs, can’t change their own role, and the last admin can’t be demoted. Changes apply on the next request.',
  },
]

function PrinciplesCard() {
  return (
    <Card className="animate-rise">
      <CardHeader icon={<ShieldCheck />} title="Six principles" description="What the policy guarantees, whatever the client sends." />
      <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <li key={p.title} className="rounded-xl border border-line bg-surface-2 p-3.5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-brand-ink [&_svg]:size-3.5">{p.icon}</span>
              {p.title}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{p.body}</p>
          </li>
        ))}
      </ul>
      <div className="px-5 pb-5">
        <Badge tone="outline">Enforced by src/lib/policy.ts + database triggers</Badge>
      </div>
    </Card>
  )
}
