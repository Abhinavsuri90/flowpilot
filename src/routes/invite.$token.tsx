import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Building2, LinkIcon } from 'lucide-react'
import { getSessionFn } from '~/lib/session'
import { api, ApiError } from '~/lib/api'
import type { InviteLanding, Me } from '~/lib/types'
import { formatDateTime } from '~/lib/format'
import { AuthLayout } from '~/components/auth-layout'
import { Avatar, Badge, Button, Callout, Skeleton, buttonClass } from '~/components/ui'

export const Route = createFileRoute('/invite/$token')({
  loader: async () => ({ me: await getSessionFn() }),
  head: () => ({ meta: [{ title: 'Invitation · FlowPilot' }] }),
  component: InvitePage,
})

function InvitePage() {
  const { token } = Route.useParams()
  const { me } = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const invite = useQuery({
    queryKey: ['invite', token, me?.user.id ?? 'anonymous'],
    queryFn: () => api.get<InviteLanding>(`/api/invites/${token}`),
    retry: false,
  })
  const accept = useMutation({
    mutationFn: () => api.post<{ alreadyMember: boolean; me: Me }>(`/api/invites/${token}/accept`),
    onSuccess: async () => {
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/', replace: true })
    },
  })
  const signOut = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: async () => {
      queryClient.clear()
      await router.invalidate()
    },
  })

  return (
    <AuthLayout>
      <div className="mb-6 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">
        <LinkIcon className="size-5" aria-hidden />
      </div>
      {invite.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-20" />
        </div>
      ) : invite.isError ? (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">This invite can’t be used</h1>
          <Callout tone="warn" className="mt-5">
            {invite.error instanceof ApiError ? invite.error.message : 'The link is not valid.'}
          </Callout>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to={me ? '/' : '/login'} className={buttonClass('secondary')}>
              {me ? 'Go to your dashboard' : 'Sign in'}
            </Link>
            {!me && (
              <Link to="/signup" className={buttonClass('ghost')}>
                Create your own workspace
              </Link>
            )}
          </div>
        </>
      ) : (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Join {invite.data.workspace.name}</h1>
          <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <Avatar name={invite.data.invitedBy} hue={invite.data.invitedByHue} size={36} />
              <p className="text-[14px] text-ink-2">
                <span className="font-semibold text-ink">{invite.data.invitedBy}</span> invited you to join{' '}
                <span className="inline-flex items-center gap-1 font-semibold text-ink">
                  <Building2 className="size-3.5" aria-hidden />
                  {invite.data.workspace.name}
                </span>{' '}
                as <Badge tone="brand">{invite.data.role}</Badge>
              </p>
            </div>
            <p className="mt-3 text-[12.5px] text-muted">
              {invite.data.email ? `For ${invite.data.email} only. ` : ''}Valid until {formatDateTime(invite.data.expiresAt)}.
            </p>
          </div>

          {!me ? (
            <div className="mt-6 space-y-2.5">
              <Link to="/signup" search={{ invite: token }} className={buttonClass('brand', 'lg', 'w-full')}>
                Create an account and join <ArrowRight className="size-4" />
              </Link>
              <Link to="/login" search={{ redirect: `/invite/${token}` }} className={buttonClass('secondary', 'lg', 'w-full')}>
                I already have an account
              </Link>
            </div>
          ) : invite.data.viewer?.alreadyMember ? (
            <div className="mt-6 space-y-3">
              <Callout tone="ok">You’re already a member of {invite.data.workspace.name}.</Callout>
              <Button variant="brand" size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
                Open {invite.data.workspace.name} <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : invite.data.viewer && !invite.data.viewer.emailMatches ? (
            <div className="mt-6 space-y-3">
              <Callout tone="warn" title="This invite is for someone else">
                It was sent to {invite.data.email}, but you’re signed in as {me.user.email}.
              </Callout>
              <Button variant="secondary" size="lg" className="w-full" loading={signOut.isPending} onClick={() => signOut.mutate()}>
                Sign out and use another account
              </Button>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <p className="text-[13.5px] text-muted">
                Signed in as <span className="font-medium text-ink">{me.user.email}</span>.
              </p>
              {accept.error && <Callout tone="bad">{accept.error.message}</Callout>}
              <Button variant="brand" size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
                Join {invite.data.workspace.name} <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </AuthLayout>
  )
}
