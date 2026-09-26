import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react'
import { getLoginInfoFn } from '~/lib/session'
import { api, ApiError } from '~/lib/api'
import { emailProblem, normalizeEmail } from '~/lib/account'
import { AuthLayout } from '~/components/auth-layout'
import { Button, Callout, Field, Input, useHydrated } from '~/components/ui'

export const Route = createFileRoute('/forgot-password')({
  loader: () => getLoginInfoFn(),
  head: () => ({ meta: [{ title: 'Reset your password · FlowPilot' }] }),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const options = Route.useLoaderData()
  const hydrated = useHydrated()
  const [email, setEmail] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const request = useMutation({
    mutationFn: () => api.post<{ ok: true; message: string }>('/api/auth/forgot', { email: normalizeEmail(email) }),
  })
  const problem = emailProblem(normalizeEmail(email))

  return (
    <AuthLayout>
      <div className="mb-6 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">
        <KeyRound className="size-5" aria-hidden />
      </div>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">Reset your password</h1>

      {request.isSuccess ? (
        <>
          <Callout tone="ok" icon={<MailCheck />} className="mt-6" title="Check your inbox">
            {request.data.message}
          </Callout>
          {!options.mail && (
            <p className="mt-4 text-[13px] text-muted">
              Email isn’t set up on this server yet, so the link was written to the server log. Ask the person who runs FlowPilot to pass it
              on, or to add a <span className="font-mono text-[12px]">RESEND_API_KEY</span>.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[14.5px] text-muted">Enter the email you sign in with, and we’ll send a link to choose a new password.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setTouched(true)
              if (!problem) request.mutate()
            }}
            method="post"
            className="mt-7 space-y-4"
            noValidate
          >
            <Field label="Email" htmlFor="email" error={touched && problem ? problem : undefined}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </Field>
            {request.error && <Callout tone="bad">{request.error instanceof ApiError ? request.error.message : request.error.message}</Callout>}
            <Button type="submit" variant="brand" size="lg" className="w-full" loading={request.isPending} disabled={!hydrated}>
              Send reset link
            </Button>
          </form>
        </>
      )}

      <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-ink hover:underline">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </AuthLayout>
  )
}
