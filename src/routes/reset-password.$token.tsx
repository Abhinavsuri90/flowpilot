import * as React from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { api, ApiError } from '~/lib/api'
import { passwordProblem } from '~/lib/account'
import type { Me } from '~/lib/types'
import { AuthLayout, PasswordInput } from '~/components/auth-layout'
import { Button, Callout, Field, Skeleton, buttonClass, useHydrated } from '~/components/ui'

export const Route = createFileRoute('/reset-password/$token')({
  head: () => ({ meta: [{ title: 'Choose a new password · FlowPilot' }] }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const link = useQuery({ queryKey: ['reset', token], queryFn: () => api.get<{ email: string }>(`/api/auth/reset/${token}`), retry: false })
  const reset = useMutation({
    mutationFn: () => api.post<Me>('/api/auth/reset', { token, password }),
    onSuccess: async () => {
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/', replace: true })
    },
  })
  const problem = passwordProblem(password) ?? (confirm !== password ? 'The two passwords don’t match' : null)

  return (
    <AuthLayout>
      <div className="mb-6 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">
        <KeyRound className="size-5" aria-hidden />
      </div>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">Choose a new password</h1>
      {link.isPending ? (
        <Skeleton className="mt-6 h-40" />
      ) : link.isError ? (
        <>
          <Callout tone="warn" className="mt-6">
            {link.error instanceof ApiError ? link.error.message : 'This link is not valid.'}
          </Callout>
          <Link to="/forgot-password" className={buttonClass('secondary', 'md', 'mt-5')}>
            Request a new link
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[14.5px] text-muted">
            For <span className="font-medium text-ink">{link.data.email}</span>. You’ll be signed out everywhere else.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setTouched(true)
              if (!problem) reset.mutate()
            }}
            method="post"
            className="mt-7 space-y-4"
            noValidate
          >
            <Field label="New password" htmlFor="new-password" hint="At least 10 characters.">
              <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} meter />
            </Field>
            <Field label="Repeat it" htmlFor="confirm-password" error={touched && problem ? problem : undefined}>
              <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={() => setTouched(true)} />
            </Field>
            {reset.error && <Callout tone="bad">{reset.error.message}</Callout>}
            <Button type="submit" variant="brand" size="lg" className="w-full" loading={reset.isPending} disabled={!hydrated}>
              Save and sign in
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
