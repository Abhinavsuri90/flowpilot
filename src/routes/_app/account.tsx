import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Copy, KeyRound, LogOut, MonitorSmartphone, Plus, TerminalSquare, UserRound } from 'lucide-react'
import { api, ApiError } from '~/lib/api'
import { nameProblem, passwordProblem } from '~/lib/account'
import { timeAgo } from '~/lib/format'
import type { ApiTokenInfo, Me, SessionInfo } from '~/lib/types'
import { formatDate } from '~/lib/dates'
import { PasswordInput } from '~/components/auth-layout'
import { CreateWorkspaceDialog } from '~/components/shell'
import { Badge, Button, Callout, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Skeleton } from '~/components/ui'
import { RoleBadge } from '~/components/workflow-bits'
import { useToast } from '~/components/toast'

export const Route = createFileRoute('/_app/account')({
  head: () => ({ meta: [{ title: 'Account settings · FlowPilot' }] }),
  component: AccountPage,
})

function AccountPage() {
  const { me } = Route.useRouteContext()
  return (
    <>
      <PageHeader eyebrow="You" title="Account settings" description="Your profile, password, signed-in devices and workspaces." />
      {me.user.isDemo && (
        <Callout tone="info" className="animate-rise mb-6" title="This is a shared demo account">
          Its name, password and memberships are fixed so everyone can use it. Create your own account to change them.
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ProfileCard me={me} />
        <PasswordCard me={me} />
        <DevicesCard />
        <TokensCard me={me} />
        <WorkspacesCard me={me} />
      </div>
    </>
  )
}

/** Re-read the session after a change so the shell shows it. */
function useRefreshMe() {
  const router = useRouter()
  return () => router.invalidate()
}

function ProfileCard({ me }: { me: Me }) {
  const [name, setName] = React.useState(me.user.name)
  const refresh = useRefreshMe()
  const toast = useToast()
  const save = useMutation({
    mutationFn: () => api.patch<Me>('/api/me', { name: name.trim() }),
    onSuccess: async () => {
      await refresh()
      toast.show({ tone: 'ok', title: 'Name saved' })
    },
  })
  const problem = nameProblem(name)
  const changed = name.trim() !== me.user.name
  return (
    <Card className="animate-rise">
      <CardHeader icon={<UserRound />} title="Profile" description="Your name is shown to your teammates on recipes and activity." />
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!problem && changed) save.mutate()
        }}
      >
        <Field label="Name" htmlFor="profile-name" error={changed ? problem ?? undefined : undefined}>
          <Input id="profile-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={me.user.isDemo} />
        </Field>
        <Field label="Email" htmlFor="profile-email" hint="Your sign-in address.">
          <Input id="profile-email" value={me.user.email} readOnly disabled />
        </Field>
        {save.error && <Callout tone="bad">{save.error.message}</Callout>}
        <div className="flex justify-end">
          <Button type="submit" variant="brand" loading={save.isPending} disabled={me.user.isDemo || !changed || !!problem}>
            Save name
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordCard({ me }: { me: Me }) {
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const queryClient = useQueryClient()
  const toast = useToast()
  const change = useMutation({
    mutationFn: () => api.post<{ ok: true; signedOutOtherDevices: number }>('/api/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: async (res) => {
      setCurrent('')
      setNext('')
      setConfirm('')
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast.show({
        tone: 'ok',
        title: 'Password changed',
        description: res.signedOutOtherDevices
          ? `Signed out ${res.signedOutOtherDevices} other device${res.signedOutOtherDevices === 1 ? '' : 's'}.`
          : 'You stay signed in here.',
      })
    },
  })
  const problem = next ? passwordProblem(next, { email: me.user.email, name: me.user.name }) : null
  const mismatch = confirm && confirm !== next ? 'The two new passwords don’t match' : null
  const fieldError = (path: string) => (change.error instanceof ApiError ? change.error.issues.find((i) => i.path === path)?.message : undefined)
  return (
    <Card className="animate-rise">
      <CardHeader icon={<KeyRound />} title="Password" description="Changing it signs you out on every other device." />
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (current && next && !problem && !mismatch) change.mutate()
        }}
      >
        <Field label="Current password" htmlFor="current-password" error={fieldError('currentPassword')}>
          <PasswordInput id="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={me.user.isDemo} />
        </Field>
        <Field label="New password" htmlFor="new-password" error={problem ?? fieldError('newPassword')} hint="At least 10 characters.">
          <PasswordInput id="new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} meter disabled={me.user.isDemo} />
        </Field>
        <Field label="Repeat the new password" htmlFor="confirm-new-password" error={mismatch ?? undefined}>
          <PasswordInput id="confirm-new-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={me.user.isDemo} />
        </Field>
        {change.error && !(change.error instanceof ApiError && change.error.issues.length) && <Callout tone="bad">{change.error.message}</Callout>}
        <div className="flex justify-end">
          <Button type="submit" variant="brand" loading={change.isPending} disabled={me.user.isDemo || !current || !next || !!problem || !!mismatch || confirm !== next}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}

function DevicesCard() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: SessionInfo[] }>('/api/me/sessions') })
  const toast = useToast()
  const signOutOthers = useMutation({
    mutationFn: () => api.delete<{ signedOut: number }>('/api/me/sessions'),
    onSuccess: async (res) => {
      await sessions.refetch()
      toast.show({ tone: 'ok', title: res.signedOut ? `Signed out ${res.signedOut} other device${res.signedOut === 1 ? '' : 's'}` : 'No other devices were signed in' })
    },
  })
  const others = (sessions.data?.sessions ?? []).filter((s) => !s.current).length
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Signed-in devices"
        description="Sessions last 7 days. Sign out anywhere you no longer use."
        actions={
          <Button size="sm" variant="secondary" icon={<LogOut className="size-3.5" />} loading={signOutOthers.isPending} disabled={!others} onClick={() => signOutOthers.mutate()}>
            Sign out everywhere else
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {sessions.isPending ? (
          <Skeleton className="h-24" />
        ) : sessions.isError ? (
          <Callout tone="bad">{sessions.error.message}</Callout>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {sessions.data.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <MonitorSmartphone className="size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-ink">{s.device}</div>
                  <div className="text-[12px] text-muted">
                    Signed in {timeAgo(s.createdAt)}
                    {s.lastSeenAt ? ` · active ${timeAgo(s.lastSeenAt)}` : ''}
                  </div>
                </div>
                {s.current && <Badge tone="ok">This device</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/** Personal API tokens for scripts: minted here, shown once, revocable. */
function TokensCard({ me }: { me: Me }) {
  const toast = useToast()
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: () => api.get<{ tokens: ApiTokenInfo[] }>('/api/me/tokens') })
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [days, setDays] = React.useState<30 | 90 | 365>(90)
  const [secret, setSecret] = React.useState<string | null>(null)
  const [confirmId, setConfirmId] = React.useState<string | null>(null)
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const create = useMutation({
    mutationFn: () => api.post<{ token: ApiTokenInfo; secret: string }>('/api/me/tokens', { name: name.trim(), expiresInDays: days }),
    onSuccess: async (res) => {
      setSecret(res.secret)
      await tokens.refetch()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<{ revoked: true }>(`/api/me/tokens/${id}`),
    onSuccess: async () => {
      setConfirmId(null)
      await tokens.refetch()
      toast.show({ tone: 'ok', title: 'Token revoked', description: 'Scripts that used it are signed out from now on.' })
    },
  })
  const close = () => {
    setOpen(false)
    setSecret(null)
    setName('')
    create.reset()
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ tone: 'ok', title: 'Copied' })
    } catch {
      toast.show({ tone: 'bad', title: 'Could not copy', description: 'Select the text and copy it by hand.' })
    }
  }
  const curl = secret ? `curl -H "Authorization: Bearer ${secret}" ${origin}/api/me` : ''

  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<TerminalSquare />}
        title="API tokens"
        description="For scripts and schedulers: run recipes and read results with your permissions, without a browser."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} disabled={me.user.isDemo} onClick={() => setOpen(true)}>
            New token
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {me.user.isDemo ? (
          <p className="text-[13px] text-muted">Demo accounts can’t create tokens. Create your own account to script FlowPilot.</p>
        ) : tokens.isPending ? (
          <Skeleton className="h-16" />
        ) : tokens.isError ? (
          <Callout tone="bad">{tokens.error.message}</Callout>
        ) : tokens.data.tokens.length === 0 ? (
          <p className="text-[13px] text-muted">
            No tokens yet. A token acts as you: whatever you can see and run, it can too. It can’t change your account, password or memberships.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {tokens.data.tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <KeyRound className="size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
                    {t.name}
                    <code className="font-mono text-[11.5px] text-muted">{t.prefix}</code>
                    {t.expired && <Badge tone="warn">Expired</Badge>}
                  </div>
                  <div className="text-[12px] text-muted">
                    Created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used'} · {t.expired ? 'expired' : 'expires'}{' '}
                    {formatDate(t.expiresAt.slice(0, 10))}
                  </div>
                </div>
                {confirmId === t.id ? (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="secondary" loading={revoke.isPending} onClick={() => revoke.mutate(t.id)}>
                      Yes, revoke
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(t.id)} aria-label={`Revoke ${t.name}`}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={open}
        onClose={close}
        icon={<TerminalSquare />}
        title={secret ? 'Your new token' : 'New API token'}
        description={secret ? 'Copy it now: it is shown only this once. Only a hash is stored.' : 'Name it after the script that will use it. It acts with your permissions and expires on its own.'}
        footer={
          secret ? (
            <Button variant="brand" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="brand" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
                Create token
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className="space-y-3">
            <Field label="Token" htmlFor="new-token-secret">
              <div className="flex gap-2">
                <Input id="new-token-secret" readOnly value={secret} className="font-mono text-[12.5px]" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copy(secret)} aria-label="Copy token">
                  Copy
                </Button>
              </div>
            </Field>
            <Field label="Try it" htmlFor="new-token-curl" hint="Every endpoint in the API reference accepts the same header. Add X-Workspace-Id to work in another of your workspaces.">
              <div className="flex gap-2">
                <Input id="new-token-curl" readOnly value={curl} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copy(curl)} aria-label="Copy the curl command">
                  Copy
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Name" htmlFor="new-token-name">
              <Input id="new-token-name" value={name} maxLength={60} placeholder="e.g. nightly-sales-report" onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Expires in" htmlFor="new-token-days">
              <Select id="new-token-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value) as 30 | 90 | 365)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </Select>
            </Field>
            {create.isError && <Callout tone="bad">{create.error instanceof ApiError ? create.error.message : String(create.error)}</Callout>}
          </div>
        )}
      </Dialog>
    </Card>
  )
}

function WorkspacesCard({ me }: { me: Me }) {
  const [createOpen, setCreateOpen] = React.useState(false)
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToast()
  const refresh = async () => {
    queryClient.clear()
    await router.invalidate()
  }
  const switchTo = useMutation({
    mutationFn: (workspaceId: string) => api.post<Me>('/api/me/workspace', { workspaceId }),
    onSuccess: async (next) => {
      await refresh()
      toast.show({ tone: 'ok', title: `Now working in ${next.workspace?.workspaceName}` })
    },
  })
  const leave = useMutation({
    mutationFn: () => api.post<{ transferred: number }>('/api/workspace/leave'),
    onSuccess: async (res) => {
      const left = me.workspace?.workspaceName
      setLeaveOpen(false)
      await refresh()
      toast.show({
        tone: 'ok',
        title: `You left ${left}`,
        description: res.transferred ? `Your ${res.transferred} recipe${res.transferred === 1 ? '' : 's'} stay with the team, owned by an admin.` : undefined,
      })
    },
  })
  const current = me.workspace
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<Building2 />}
        title="Workspaces"
        description="Each workspace has its own recipes and members. The one you work in is marked."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
            New workspace
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {me.memberships.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
            You don’t belong to a workspace. Create one, or open an invite link from a teammate.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {me.memberships.map((m) => {
              const isCurrent = m.workspaceId === current?.workspaceId
              return (
                <li key={m.workspaceId} className="flex items-center gap-3 px-4 py-3">
                  <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{m.workspaceName}</div>
                    <div className="mt-0.5">
                      <RoleBadge role={m.role} />
                    </div>
                  </div>
                  {isCurrent ? (
                    <>
                      <Badge tone="brand">Working here</Badge>
                      {!me.user.isDemo && (
                        <Button size="sm" variant="ghost" onClick={() => setLeaveOpen(true)}>
                          Leave
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" loading={switchTo.isPending && switchTo.variables === m.workspaceId} onClick={() => switchTo.mutate(m.workspaceId)}>
                      Switch
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <CreateWorkspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <Dialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        size="sm"
        icon={<LogOut />}
        title={`Leave ${current?.workspaceName}?`}
        description="You'll lose access to its recipes. Recipes you own there stay with the team: they move to an admin. Your own runs stay yours."
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaveOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={leave.isPending} onClick={() => leave.mutate()}>
              Leave workspace
            </Button>
          </>
        }
      >
        {leave.error && <Callout tone="bad">{leave.error.message}</Callout>}
      </Dialog>
    </Card>
  )
}
