import * as React from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowRight, FileSpreadsheet, Filter, GitFork, History, Lock, ShieldCheck, Sigma, Table2 } from 'lucide-react'
import { getLoginInfoFn, getSessionFn } from '~/lib/session'
import { api, ApiError } from '~/lib/api'
import { DEMO_PEOPLE } from '~/lib/demo'
import type { Me } from '~/lib/types'
import { Logo } from '~/components/logo'
import { Avatar, Badge, Button, Callout, Field, Input, cn, useHydrated } from '~/components/ui'

/** Only same-site paths are allowed as post-login destinations (no open redirects). */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  if (target.startsWith('/login') || target.startsWith('/api/')) return '/'
  return target
}

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
  const { demoPassword } = Route.useLoaderData()
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
    if (demoPassword) {
      setPassword(demoPassword)
      login.mutate({ email: demoEmail, password: demoPassword })
    } else {
      setPassword('')
      passwordRef.current?.focus()
    }
  }

  const error = login.error instanceof ApiError ? login.error : login.error ? new ApiError(0, 'ERROR', login.error.message) : null

  return (
    <div className="flex min-h-dvh bg-canvas">
      <BrandPanel />

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="animate-rise w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-[14.5px] text-muted">Use your email and password, or pick one of the demo accounts below.</p>

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
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
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
              {demoPassword
                ? 'Each button signs in with that account’s real email and the documented demo password.'
                : 'Each button fills the email. Enter the SEED_PASSWORD configured for this server.'}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

const PIPELINE = [
  { icon: <FileSpreadsheet />, label: 'sales_A.csv', rows: 6, tone: 'text-sidebar-ink' },
  { icon: <Filter />, label: 'Keep rows where status equals "paid"', rows: 4, tone: 'text-[#9aa6ff]' },
  { icon: <Sigma />, label: 'Total amount by region as total', rows: 3, tone: 'text-[#9aa6ff]' },
  { icon: <Filter />, label: 'Keep rows where total is less than ₹1,00,000', rows: 2, tone: 'text-[#9aa6ff]' },
]

function BrandPanel() {
  return (
    <aside className="relative hidden w-[46%] max-w-[640px] overflow-hidden bg-sidebar text-sidebar-ink lg:flex lg:flex-col">
      <div className="bg-grid absolute inset-0 opacity-60 [--dot:rgb(255_255_255/0.045)]" aria-hidden />
      <div className="absolute -top-40 -left-32 size-[520px] rounded-full bg-[var(--brand)] opacity-25 blur-[120px]" aria-hidden />
      <div className="absolute -right-40 bottom-0 size-[420px] rounded-full bg-[#0ea5a0] opacity-15 blur-[120px]" aria-hidden />

      <div className="relative flex flex-1 flex-col px-12 py-10">
        <Logo inverted />
        <div className="mt-auto mb-auto pt-14 pb-10">
          <div className="text-[12px] font-semibold tracking-[0.14em] text-[#9aa6ff] uppercase">Shareable workflows for teams</div>
          <h2 className="mt-3 max-w-md text-[34px] leading-[1.12] font-semibold tracking-tight text-white">
            Build the recipe once. Let your whole team run it.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-sidebar-muted">
            Describe a repetitive CSV report in one sentence. FlowPilot turns it into steps you review, save and share, and
            anyone on your team can rerun it on their own file with no AI involved.
          </p>

          <div className="mt-9 max-w-md rounded-2xl border border-sidebar-line bg-white/[0.035] p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.7)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between text-[11.5px] text-sidebar-muted">
              <span>Example run · Regional revenue exceptions</span>
              <span className="inline-flex items-center gap-1 text-[#5fe0d9]">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-[#26c2bb]" /> deterministic
              </span>
            </div>
            <ol>
              {PIPELINE.map((step, i) => (
                <li key={step.label}>
                  <div className="flex items-center gap-3 rounded-xl border border-sidebar-line bg-sidebar-2/80 px-3 py-2.5">
                    <span className={cn('[&_svg]:size-4', step.tone)}>{step.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-ink">{step.label}</span>
                    <span className="tabular rounded-md bg-white/5 px-1.5 py-0.5 text-[11.5px] text-sidebar-muted">{step.rows} rows</span>
                  </div>
                  <div className="relative ml-[21px] h-4 w-px bg-white/12">
                    <span
                      className="animate-drip absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#26c2bb] shadow-[0_0_8px_#26c2bb]"
                      style={{ animationDelay: `${i * 0.35}s` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-3 rounded-xl border border-[#26c2bb]/30 bg-[#26c2bb]/10 px-3 py-2.5">
              <Table2 className="size-4 text-[#5fe0d9]" />
              <span className="tabular flex-1 text-[13px] text-white">South ₹40,000 · West ₹70,000</span>
              <span className="text-[11.5px] text-[#5fe0d9]">2 rows</span>
            </div>
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-4 text-[12.5px] text-sidebar-muted">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> No AI on reruns: a fixed engine runs every step
          </li>
          <li className="flex items-start gap-2">
            <History className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> Every save is a new, immutable version
          </li>
          <li className="flex items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> Results stay private to whoever ran them
          </li>
        </ul>
        <div className="mt-6 flex items-center gap-2 text-[12px] text-sidebar-muted/80">
          <GitFork className="size-3.5" /> Copies are independent: adapting a recipe never changes the original.
        </div>
      </div>
    </aside>
  )
}
