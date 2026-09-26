import * as React from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  EyeOff,
  Fingerprint,
  KeyRound,
  Link2,
  Lock,
  MailPlus,
  Pencil,
  ShieldCheck,
  ShieldHalf,
  UserCog,
  UserMinus,
  Users,
  UsersRound,
} from 'lucide-react'
import { api, ApiError, qk, qs } from '~/lib/api'
import { MATRIX_COLUMNS, permissionMatrix, type MatrixCell } from '~/lib/policy'
import { emailProblem, normalizeEmail, workspaceNameProblem } from '~/lib/account'
import { formatDateTime } from '~/lib/format'
import type { InviteInfo, Role, Visibility, WorkflowList, WorkflowSummary, WorkspaceInfo, WorkspaceMember } from '~/lib/types'
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Dialog,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tip,
  cn,
} from '~/components/ui'
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
          {me.workspace?.role === 'admin' && !me.user.isDemo && <InvitesCard workspaceName={me.workspace.workspaceName} />}
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
  const { me } = Route.useRouteContext()
  const ws = useQuery({ queryKey: qk.workspace, queryFn: () => api.get<WorkspaceInfo>('/api/workspace') })
  const queryClient = useQueryClient()
  const toast = useToast()
  const [removing, setRemoving] = React.useState<WorkspaceMember | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.workspace }),
      queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      queryClient.invalidateQueries({ queryKey: ['access'] }),
      queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
    ])
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/api/workspace/members/${userId}`, { role }),
    onSuccess: async (_res, vars) => {
      await refreshAll()
      const name = ws.data?.members.find((m) => m.user.id === vars.userId)?.user.name ?? 'Member'
      toast.show({ tone: 'ok', title: `${name} is now ${vars.role === 'admin' ? 'an' : 'a'} ${vars.role}`, description: 'It applies on their next request; no re-login needed.' })
    },
    onError: (err) => toast.show({ tone: 'bad', title: 'Role not changed', description: err instanceof ApiError ? err.message : String(err) }),
  })
  const remove = useMutation({
    mutationFn: (member: WorkspaceMember) => api.delete<{ transferred: number }>(`/api/workspace/members/${member.user.id}`),
    onSuccess: async (res, member) => {
      setRemoving(null)
      await refreshAll()
      toast.show({
        tone: 'ok',
        title: `${member.user.name} was removed`,
        description: res.transferred ? `Their ${res.transferred} recipe${res.transferred === 1 ? ' is' : 's are'} yours now, so the team keeps them.` : 'They can no longer see this workspace.',
      })
    },
  })

  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<UserCog />}
        title={ws.data ? `Members of ${ws.data.workspace.name}` : 'Members'}
        description={
          ws.data?.canManageRoles
            ? 'As an admin you manage people, not their work: you can’t edit other people’s recipes or see their runs.'
            : 'Only admins change roles or invite people.'
        }
        actions={
          ws.data?.canManageMembers && !me.user.isDemo ? (
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setRenaming(true)}>
              Rename
            </Button>
          ) : undefined
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
              const canRemove = ws.data.canManageMembers && !m.isYou && !m.isDemo
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
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => setRemoving(m)}
                      aria-label={`Remove ${m.user.name} from ${ws.data.workspace.name}`}
                      title="Remove from workspace"
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-bad-soft hover:text-bad-ink"
                    >
                      <UserMinus className="size-4" />
                    </button>
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

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        icon={<UserMinus />}
        title={removing ? `Remove ${removing.user.name}?` : ''}
        description="They lose access to this workspace immediately. Their own runs stay private to them."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              Remove
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-[13.5px] text-ink-2">
            {removing.recipeCount
              ? `Their ${removing.recipeCount} recipe${removing.recipeCount === 1 ? '' : 's'} here will move to you, so the team keeps ${removing.recipeCount === 1 ? 'it' : 'them'} (private ones stay private, now to you).`
              : 'They don’t own any recipes here.'}
          </p>
        )}
        {remove.error && (
          <Callout tone="bad" className="mt-3">
            {remove.error.message}
          </Callout>
        )}
      </Dialog>
      {ws.data && <RenameWorkspaceDialog open={renaming} onClose={() => setRenaming(false)} current={ws.data.workspace.name} />}
    </Card>
  )
}

function RenameWorkspaceDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: string }) {
  const [name, setName] = React.useState(current)
  const [seen, setSeen] = React.useState(open)
  if (open !== seen) {
    setSeen(open)
    if (open) setName(current)
  }
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToast()
  const rename = useMutation({
    mutationFn: () => api.patch('/api/workspace', { name: name.trim() }),
    onSuccess: async () => {
      onClose()
      await Promise.all([queryClient.invalidateQueries(), router.invalidate()])
      toast.show({ tone: 'ok', title: `Renamed to ${name.trim()}` })
    },
  })
  const problem = workspaceNameProblem(name)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon={<Pencil />}
      title="Rename workspace"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" loading={rename.isPending} disabled={!!problem || name.trim() === current} onClick={() => rename.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Workspace name" htmlFor="rename-workspace" error={problem ?? undefined}>
        <Input id="rename-workspace" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      {rename.error && (
        <Callout tone="bad" className="mt-3">
          {rename.error.message}
        </Callout>
      )}
    </Dialog>
  )
}

// ----- Invitations (admins) -------------------------------------------------------------

function InvitesCard({ workspaceName }: { workspaceName: string }) {
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get<{ invites: InviteInfo[] }>('/api/workspace/invites') })
  const queryClient = useQueryClient()
  const toast = useToast()
  const [role, setRole] = React.useState<Role>('member')
  const [email, setEmail] = React.useState('')
  const [created, setCreated] = React.useState<{ link: string; invite: InviteInfo; emailed: boolean } | null>(null)
  const emailIssue = email.trim() ? emailProblem(normalizeEmail(email)) : null
  const create = useMutation({
    mutationFn: () =>
      api.post<{ link: string; invite: InviteInfo; emailed: boolean }>('/api/workspace/invites', {
        role,
        ...(email.trim() ? { email: normalizeEmail(email) } : {}),
      }),
    onSuccess: async (res) => {
      setCreated(res)
      setEmail('')
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/workspace/invites/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
      toast.show({ tone: 'ok', title: 'Invite link revoked', description: 'It stops working immediately.' })
    },
  })
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<MailPlus />}
        title="Invite people"
        description={`Create a link to join ${workspaceName}. With an email, it works once for that address; without one, anyone with it can join (up to 25 people, for 7 days).`}
      />
      <div className="space-y-4 px-5 pb-5">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (!emailIssue) create.mutate()
          }}
        >
          <Field label="Email (optional)" htmlFor="invite-email" error={emailIssue ?? undefined}>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
          <Button type="submit" variant="brand" loading={create.isPending} disabled={!!emailIssue} icon={<Link2 className="size-4" />}>
            Create link
          </Button>
        </form>
        {create.error && <Callout tone="bad">{create.error.message}</Callout>}
        {created && (
          <Callout tone="ok" title="Invite link ready">
            <p className="mb-2">
              {created.invite.email
                ? created.emailed
                  ? `We emailed it to ${created.invite.email}. You can also copy it now; it isn't shown again.`
                  : `For ${created.invite.email} only. Copy it now and send it to them; it isn't shown again.`
                : 'Copy it now and share it with your team; it isn’t shown again.'}
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink-2">{created.link}</code>
              <CopyLinkButton href={created.link} label="Copy" />
            </div>
          </Callout>
        )}
        <div>
          <div className="mb-2 text-[12px] font-medium tracking-wide text-faint uppercase">Pending invites</div>
          {invites.isPending ? (
            <Skeleton className="h-12" />
          ) : invites.isError ? (
            <Callout tone="bad">{invites.error.message}</Callout>
          ) : invites.data.invites.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-4 text-center text-[13px] text-muted">No pending invites.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {invites.data.invites.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] text-ink">
                      <span className="truncate font-medium">{invite.email ?? 'Anyone with the link'}</span>
                      <RoleBadge role={invite.role} />
                    </div>
                    <div className="text-[12px] text-muted">
                      {invite.email ? 'Single use' : `${invite.uses} of ${invite.maxUses} used`} · expires {formatDateTime(invite.expiresAt)} · by {invite.createdBy.name}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === invite.id} onClick={() => revoke.mutate(invite.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
    title: 'Admins manage people, not recipes',
    body: 'Admins can’t edit others’ recipes or read their runs, can’t change their own role, and the last admin can’t be demoted. Changes apply on the next request.',
  },
  {
    icon: <UsersRound />,
    title: 'People leave; recipes stay',
    body: 'When someone leaves or is removed, the recipes they own move to an admin (a database trigger allows handing over only to an admin or member), so the team never loses its work.',
  },
]

function PrinciplesCard() {
  return (
    <Card className="animate-rise">
      <CardHeader icon={<ShieldCheck />} title="Seven principles" description="What the policy guarantees, whatever the client sends." />
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
