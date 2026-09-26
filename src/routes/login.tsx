import * as React from 'react'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowRight } from 'lucide-react'
import { getLoginInfoFn, getSessionFn } from '~/lib/session'
import { api, ApiError } from '~/lib/api'
import { DEMO_PEOPLE } from '~/lib/demo'
import type { Me } from '~/lib/types'
import { AuthLayout, PasswordInput } from '~/components/auth-layout'
import { Avatar, Badge, Button, Callout, Field, Input, cn, useHydrated } from '~/components/ui'
import { safeRedirect } from '~/lib/redirect'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().max(500).optional().catch(undefined) }),
  beforeLoad: async ({ search }) => {
    const me = await getSessionFn()
    if (me) throw redirect({ href: safeRedirect(search.redirect) })
  },
  loader: () => getLoginInfoFn(),
  head: () => ({ meta: [{ title: 'Sign in · FlowPilot' }] }),
  component: LoginPage,
})

const ROLE_TONE = { admin: 'brand', member: 'flow', viewer: 'neutral' } as const

function LoginPage() {
  const options = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const passwordRef = React.useRef<HTMLInputElement>(null)
  // Until React hydrates, controls stay disabled: a click would do nothing, and a
  // native submit must never put credentials in a URL (the form is also POST).
  const hydrated = useHydrated()

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) => api.post<Me>('/api/auth/login', creds),
    onSuccess: async () => {
      // A new account must never see the previous account's cached data.
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ href: safeRedirect(search.redirect), replace: true })
    },
  })

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!email.trim() || !password) return
    login.mutate({ email: email.trim(), password })
  }

  const signInAs = (demoEmail: string) => {
    setEmail(demoEmail)
    if (options.demoPassword) {
      setPassword(options.demoPassword)
      login.mutate({ email: demoEmail, password: options.demoPassword })
    } else {
      setPassword('')
      passwordRef.current?.focus()
    }
  }

  const error = login.error instanceof ApiError ? login.error : login.error ? new ApiError(0, 'ERROR', login.error.message) : null

  return (
    <AuthLayout>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 text-[14.5px] text-muted">
        {options.demoMode ? 'Use your email and password, or pick one of the demo accounts below.' : 'Welcome back. Sign in to your workspace.'}
      </p>

      <form onSubmit={submit} method="post" className="mt-7 space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-medium text-ink-2">
              Password
            </label>
            <Link to="/forgot-password" className="text-[12.5px] font-medium text-brand-ink hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            ref={passwordRef}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <Callout tone="bad" title={error.status === 429 ? 'Too many attempts' : "Couldn't sign you in"}>
            {error.message}
          </Callout>
        )}
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="w-full"
          loading={login.isPending}
          disabled={!hydrated || !email.trim() || !password}
        >
          Sign in <ArrowRight className="size-4" />
        </Button>
      </form>

      {options.registration === 'open' && (
        <p className="mt-5 text-center text-[13.5px] text-muted">
          New to FlowPilot?{' '}
          <Link to="/signup" className="font-semibold text-brand-ink hover:underline">
            Create an account
          </Link>
        </p>
      )}
      {options.registration === 'invite-only' && (
        <p className="mt-5 text-center text-[13px] text-muted">New here? Ask an admin for an invite link to join their workspace.</p>
      )}

      {options.demoMode && (
        <div className="mt-9">
          <div className="flex items-center gap-3 text-[12px] font-medium tracking-wide text-faint uppercase">
            <span className="h-px flex-1 bg-line" />
            Demo accounts · synthetic data
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {DEMO_PEOPLE.map((person) => (
              <button
                key={person.key}
                type="button"
                onClick={() => signInAs(person.email)}
                disabled={!hydrated || login.isPending}
                className={cn(
                  'group flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left shadow-soft transition-all',
                  'hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card disabled:opacity-60',
                )}
              >
                <Avatar name={person.name} hue={person.hue} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold text-ink">{person.name.split(' ')[0]}</span>
                    <Badge tone={ROLE_TONE[person.role]}>{person.role}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                    {person.workspace} · {person.purpose}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted">
            {options.demoPassword
              ? 'Each button signs in with that account’s real email and the documented demo password. Demo accounts are shared, so their password and name can’t be changed.'
              : 'Each button fills the email. Enter the SEED_PASSWORD configured for this server.'}
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
