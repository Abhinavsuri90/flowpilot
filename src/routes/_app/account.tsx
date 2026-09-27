import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { Building2, Copy, KeyRound, LogOut, MonitorSmartphone, Plus, RefreshCw, ShieldCheck, TerminalSquare, UserRound } from 'lucide-react'
import { api, ApiError } from '~/lib/api'
import { nameProblem, passwordProblem } from '~/lib/account'
import { timeAgo } from '~/lib/format'
import type { ApiTokenInfo, Me, SessionInfo, TwoFactorSetup, TwoFactorStatus } from '~/lib/types'
import { formatDate } from '~/lib/dates'
import { PasswordInput } from '~/components/auth-layout'
import { CreateWorkspaceDialog } from '~/components/shell'
import { QrCode, RecoveryCodes, groupKey } from '~/components/two-factor'
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
        <TwoFactorCard me={me} />
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

// ---------------------------------------------------------------------------
// Two-step sign-in
// ---------------------------------------------------------------------------

const TWO_FACTOR_KEY = ['two-factor'] as const

function TwoFactorCard({ me }: { me: Me }) {
  const status = useQuery({ queryKey: TWO_FACTOR_KEY, queryFn: () => api.get<TwoFactorStatus>('/api/me/two-factor') })
  const [dialog, setDialog] = React.useState<'setup' | 'off' | 'codes' | null>(null)
  // Each setup call makes a new secret, so it runs on the click, exactly once, never from a render.
  const setup = useMutation({ mutationFn: () => api.post<TwoFactorSetup>('/api/me/two-factor/setup') })
  const close = () => {
    setup.reset()
    setDialog(null)
  }
  const on = status.data?.enabled ?? false
  const left = status.data?.recoveryCodesLeft ?? 0
  return (
    <Card className="animate-rise">
      <CardHeader
        icon={<ShieldCheck />}
        title="Two-step sign-in"
        description="Ask for a code from an authenticator app as well as your password, so a stolen password alone can’t open your account."
        actions={status.data && !me.user.isDemo ? <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'On' : 'Off'}</Badge> : undefined}
      />
      <div className="space-y-3 px-5 pb-5">
        {me.user.isDemo ? (
          <p className="text-[13px] text-muted">Demo accounts are shared, so they can’t turn this on. Create your own account to protect it with a code.</p>
        ) : status.isPending ? (
          <Skeleton className="h-16" />
        ) : status.isError ? (
          <Callout tone="bad">{status.error.message}</Callout>
        ) : on ? (
          <>
            <p className="text-[13px] text-muted">
              On since {formatDate(status.data.enabledAt!.slice(0, 10))}. {left} of 10 recovery codes left, for when your phone isn’t at hand.
            </p>
            {left <= 3 && (
              <Callout tone="warn" title={left === 0 ? 'No recovery codes left' : 'Recovery codes are running out'}>
                Make new ones now, so a lost phone can’t lock you out.
              </Callout>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={() => setDialog('codes')}>
                New recovery codes
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDialog('off')}>
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">
              Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy and any app that shows 6-digit codes. Your API tokens keep working.
            </p>
            <Button
              size="sm"
              variant="brand"
              icon={<ShieldCheck className="size-3.5" />}
              onClick={() => {
                setup.mutate()
                setDialog('setup')
              }}
            >
              Turn on
            </Button>
          </>
        )}
      </div>
      {dialog === 'setup' && <TwoFactorSetupDialog me={me} setup={setup} onClose={close} />}
      {dialog === 'off' && <TwoFactorOffDialog onClose={close} />}
      {dialog === 'codes' && <NewRecoveryCodesDialog me={me} onClose={close} />}
    </Card>
  )
}

/** Scan, confirm with the first code and the password, then save the recovery codes (shown once). */
function TwoFactorSetupDialog({
  me,
  setup: start,
  onClose,
}: {
  me: Me
  setup: UseMutationResult<TwoFactorSetup, Error, void>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [code, setCode] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const enable = useMutation({
    mutationFn: () =>
      api.post<{ enabled: true; recoveryCodes: string[]; signedOutOtherDevices: number }>('/api/me/two-factor/enable', { password, code: code.trim() }),
    onSuccess: async (res) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: TWO_FACTOR_KEY, exact: true }), queryClient.invalidateQueries({ queryKey: ['sessions'] })])
      if (res.signedOutOtherDevices) {
        toast.show({ tone: 'ok', title: `Signed out ${res.signedOutOtherDevices} other device${res.signedOutOtherDevices === 1 ? '' : 's'}`, description: 'They’ll need a code to sign in again.' })
      }
    },
  })
  const fieldError = (path: string) => (enable.error instanceof ApiError ? enable.error.issues.find((i) => i.path === path)?.message : undefined)
  const codes = enable.data?.recoveryCodes

  return (
    <Dialog
      open
      onClose={onClose}
      icon={<ShieldCheck />}
      title={codes ? 'Save your recovery codes' : 'Turn on two-step sign-in'}
      description={
        codes
          ? 'Two-step sign-in is on. If you lose your phone, each of these codes signs you in once. They won’t be shown again.'
          : 'Scan the QR code with your authenticator app, then enter the 6-digit code it shows.'
      }
      footer={
        codes ? (
          <Button variant="brand" disabled={!saved} onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="two-factor-setup"
              variant="brand"
              loading={enable.isPending}
              disabled={!start.data || !/^\d{6}$/.test(code.replace(/\s/g, '')) || !password}
            >
              Turn on
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <div className="space-y-4">
          <RecoveryCodes codes={codes} email={me.user.email} />
          <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            I’ve saved these codes somewhere safe
          </label>
        </div>
      ) : start.isError ? (
        <Callout tone="bad">{start.error.message}</Callout>
      ) : !start.data ? (
        <Skeleton className="h-64" />
      ) : (
        <form
          id="two-factor-setup"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^\d{6}$/.test(code.replace(/\s/g, '')) && password) enable.mutate()
          }}
        >
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-xl border border-line bg-white p-2">
              <QrCode value={start.data.uri} label="QR code for your authenticator app" />
            </div>
            <div className="min-w-0 text-[13px] text-muted">
              <p>Can’t scan it? Add an account by hand with this key:</p>
              <code className="mt-1.5 block rounded-lg bg-sunken px-2.5 py-2 font-mono text-[13px] break-all text-ink" data-testid="two-factor-key">
                {groupKey(start.data.secret)}
              </code>
              <p className="mt-1.5">Account: {me.user.email} · time-based, 6 digits.</p>
            </div>
          </div>
          <Field label="Code from the app" htmlFor="two-factor-setup-code" error={fieldError('code')}>
            <Input
              id="two-factor-setup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123456"
              className="font-mono tracking-[0.25em]"
            />
          </Field>
          <Field label="Your password" htmlFor="two-factor-setup-password" error={fieldError('password')}>
            <PasswordInput id="two-factor-setup-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {enable.error && !(enable.error instanceof ApiError && enable.error.issues.length) && <Callout tone="bad">{enable.error.message}</Callout>}
        </form>
      )}
    </Dialog>
  )
}

function TwoFactorOffDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const off = useMutation({
    mutationFn: () => api.post<{ enabled: false }>('/api/me/two-factor/disable', { password, code: code.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TWO_FACTOR_KEY, exact: true })
      toast.show({ tone: 'ok', title: 'Two-step sign-in is off', description: 'Signing in needs only your password now.' })
      onClose()
    },
  })
  const fieldError = (path: string) => (off.error instanceof ApiError ? off.error.issues.find((i) => i.path === path)?.message : undefined)
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      icon={<ShieldCheck />}
      title="Turn off two-step sign-in?"
      description="Your account will be protected by your password alone, and your recovery codes stop working."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={off.isPending} disabled={!password || !code.trim()} onClick={() => off.mutate()}>
            Turn off
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Code from the app, or a recovery code" htmlFor="two-factor-off-code" error={fieldError('code')}>
          <Input id="two-factor-off-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="font-mono" />
        </Field>
        <Field label="Your password" htmlFor="two-factor-off-password" error={fieldError('password')}>
          <PasswordInput id="two-factor-off-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {off.error && !(off.error instanceof ApiError && off.error.issues.length) && <Callout tone="bad">{off.error.message}</Callout>}
      </div>
    </Dialog>
  )
}

function NewRecoveryCodesDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = React.useState('')
  const regenerate = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/me/two-factor/recovery-codes', { password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TWO_FACTOR_KEY, exact: true }),
  })
  const codes = regenerate.data?.recoveryCodes
  const fieldError = regenerate.error instanceof ApiError ? regenerate.error.issues.find((i) => i.path === 'password')?.message : undefined
  return (
    <Dialog
      open
      onClose={onClose}
      icon={<RefreshCw />}
      title={codes ? 'Your new recovery codes' : 'Make new recovery codes?'}
      description={codes ? 'The old codes no longer work. Save these; they won’t be shown again.' : 'You get ten new codes, and every old one stops working.'}
      footer={
        codes ? (
          <Button variant="brand" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="brand" loading={regenerate.isPending} disabled={!password} onClick={() => regenerate.mutate()}>
              Make new codes
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} email={me.user.email} />
      ) : (
        <div className="space-y-4">
          <Field label="Your password" htmlFor="two-factor-codes-password" error={fieldError}>
            <PasswordInput id="two-factor-codes-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {regenerate.error && !fieldError && <Callout tone="bad">{regenerate.error.message}</Callout>}
        </div>
      )}
    </Dialog>
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
