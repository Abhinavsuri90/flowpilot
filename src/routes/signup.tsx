import * as React from 'react'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowRight, Building2, MailCheck } from 'lucide-react'
import { getLoginInfoFn, getSessionFn } from '~/lib/session'
import { api, ApiError } from '~/lib/api'
import { emailProblem, nameProblem, normalizeEmail, passwordProblem, workspaceNameProblem } from '~/lib/account'
import { browserTimeZone } from '~/lib/dates'
import type { InviteLanding, Me } from '~/lib/types'
import { AuthLayout, PasswordInput } from '~/components/auth-layout'
import { Badge, Button, Callout, Field, Input, Skeleton, useHydrated } from '~/components/ui'

export const Route = createFileRoute('/signup')({
  validateSearch: z.object({ invite: z.string().max(128).optional().catch(undefined) }),
  beforeLoad: async ({ search }) => {
    const me = await getSessionFn()
    if (me) throw redirect(search.invite ? { to: '/invite/$token', params: { token: search.invite } } : { to: '/' })
  },
  loader: () => getLoginInfoFn(),
  head: () => ({ meta: [{ title: 'Create your account · FlowPilot' }] }),
  component: SignupPage,
})

type FieldName = 'name' | 'email' | 'password' | 'workspaceName'

function SignupPage() {
  const options = Route.useLoaderData()
  const { invite: inviteToken } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const [values, setValues] = React.useState({ name: '', email: '', password: '', workspaceName: '' })
  const [touched, setTouched] = React.useState<Partial<Record<FieldName, boolean>>>({})

  const invite = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => api.get<InviteLanding>(`/api/invites/${inviteToken}`),
    enabled: !!inviteToken,
    retry: false,
  })
  // An email invite fills (and fixes) the address: adjusted during render when the
  // invite arrives, so no frame shows an empty field and no effect re-renders.
  const [filledFrom, setFilledFrom] = React.useState<string | null>(null)
  const invitedEmail = invite.data?.email ?? null
  if (invitedEmail && filledFrom !== invitedEmail) {
    setFilledFrom(invitedEmail)
    setValues((v) => ({ ...v, email: invitedEmail }))
  }

  const joining = !!inviteToken && !!invite.data
  const register = useMutation({
    mutationFn: () =>
      api.post<Me>('/api/auth/register', {
        name: values.name.trim(),
        email: normalizeEmail(values.email),
        password: values.password,
        ...(joining ? { inviteToken } : { workspaceName: values.workspaceName.trim(), timeZone: browserTimeZone() }),
      }),
    onSuccess: async () => {
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/', replace: true })
    },
  })

  const email = normalizeEmail(values.email)
  const problems: Record<FieldName, string | null> = {
    name: nameProblem(values.name),
    email: emailProblem(email),
    password: passwordProblem(values.password, { email, name: values.name }),
    workspaceName: joining ? null : workspaceNameProblem(values.workspaceName),
  }
  const serverIssue = (field: FieldName) =>
    register.error instanceof ApiError ? register.error.issues.find((i) => i.path === field)?.message : undefined
  const shown = (field: FieldName) => serverIssue(field) ?? (touched[field] ? problems[field] ?? undefined : undefined)
  const valid = Object.values(problems).every((p) => !p)
  const set = (field: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [field]: e.target.value }))
  const blur = (field: FieldName) => () => setTouched((t) => ({ ...t, [field]: true }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true, workspaceName: true })
    if (valid) register.mutate()
  }
  const error = register.error instanceof ApiError ? register.error : null

  if (options.registration === 'closed' || (options.registration === 'invite-only' && !inviteToken)) {
    return (
      <AuthLayout>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Create your account</h1>
        <Callout tone="info" className="mt-6" title={options.registration === 'closed' ? 'Sign-ups are closed' : 'Invite only'}>
          {options.registration === 'closed'
            ? 'New accounts can’t be created on this server. Ask whoever runs it for access.'
            : 'Accounts on this server are created from an invite link. Ask an admin of your team’s workspace to invite you.'}
        </Callout>
        <p className="mt-6 text-[13.5px] text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-ink hover:underline">
            Sign in
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">{inviteToken ? 'Join your team' : 'Create your account'}</h1>
      <p className="mt-1.5 text-[14.5px] text-muted">
        {inviteToken ? 'Create an account to accept the invitation.' : 'Start a workspace for your team. You can invite people once you’re in.'}
      </p>

      {inviteToken && (
        <div className="mt-6">
          {invite.isPending ? (
            <Skeleton className="h-16" />
          ) : invite.isError ? (
            <Callout tone="warn" title="This invite link can’t be used">
              {invite.error.message} You can still{' '}
              <Link to="/signup" className="font-medium underline">
                create your own workspace
              </Link>
              .
            </Callout>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/50 px-4 py-3">
              <Building2 className="size-5 shrink-0 text-brand-ink" aria-hidden />
              <p className="text-[13.5px] text-ink-2">
                <span className="font-medium">{invite.data.invitedBy}</span> invited you to{' '}
                <span className="font-semibold text-ink">{invite.data.workspace.name}</span> as{' '}
                <Badge tone="brand">{invite.data.role}</Badge>
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={submit} method="post" className="mt-6 space-y-4" noValidate>
        <Field label="Full name" htmlFor="name" error={shown('name')}>
          <Input id="name" autoComplete="name" value={values.name} maxLength={80} onChange={set('name')} onBlur={blur('name')} placeholder="e.g. Priya Sharma" />
        </Field>
        <Field label="Work email" htmlFor="email" error={shown('email')} hint={invite.data?.email ? 'This invite is for this address.' : undefined}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set('email')}
            onBlur={blur('email')}
            placeholder="you@company.com"
            readOnly={!!invite.data?.email}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={shown('password')} hint="At least 10 characters. A few words together work well.">
          <PasswordInput id="password" autoComplete="new-password" value={values.password} onChange={set('password')} onBlur={blur('password')} meter />
        </Field>
        {!joining && (
          <Field label="Workspace name" htmlFor="workspaceName" error={shown('workspaceName')} hint="Your team, department or company. You'll be its admin.">
            <Input
              id="workspaceName"
              autoComplete="organization"
              value={values.workspaceName}
              maxLength={80}
              onChange={set('workspaceName')}
              onBlur={blur('workspaceName')}
              placeholder="e.g. Sales operations"
            />
          </Field>
        )}
        {error && !error.issues.length && (
          <Callout tone="bad" title={error.status === 409 ? 'You already have an account' : "Couldn't create your account"}>
            {error.message}
          </Callout>
        )}
        {error?.code === 'EMAIL_TAKEN' && (
          <Callout tone="info" icon={<MailCheck />}>
            <Link to="/login" className="font-medium underline">
              Sign in
            </Link>{' '}
            instead, or{' '}
            <Link to="/forgot-password" className="font-medium underline">
              reset your password
            </Link>
            .
          </Callout>
        )}
        <Button type="submit" variant="brand" size="lg" className="w-full" loading={register.isPending} disabled={!hydrated || (inviteToken && !invite.data) || undefined}>
          {joining ? `Join ${invite.data!.workspace.name}` : 'Create account'} <ArrowRight className="size-4" />
        </Button>
        <p className="text-center text-[12px] text-faint">
          Passwords are stored as salted scrypt hashes. Your files are never stored.
        </p>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-muted">
        Already have an account?{' '}
        <Link
          to="/login"
          search={inviteToken ? { redirect: `/invite/${inviteToken}` } : {}}
          className="font-semibold text-brand-ink hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
