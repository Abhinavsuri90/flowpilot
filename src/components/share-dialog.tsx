import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Lock, Share2, Users } from 'lucide-react'
import { api, ApiError, qk } from '~/lib/api'
import type { Visibility, WorkflowSummary } from '~/lib/types'
import { Button, Callout, Dialog, cn } from './ui'
import { useToast } from './toast'

export function shareLink(workflowId: string, versionId: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/w/${workflowId}?v=${versionId}`
}

export function CopyLinkButton({ href, label = 'Copy link', size = 'sm' }: { href: string; label?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = React.useState(false)
  const toast = useToast()
  return (
    <Button
      size={size}
      variant="secondary"
      icon={copied ? <Check className="size-3.5 text-ok" /> : <Link2 className="size-3.5" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(href)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1800)
        } catch {
          toast.show({ tone: 'bad', title: 'Could not copy', description: href })
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

const OPTIONS: Array<{ value: Visibility; title: string; icon: React.ReactNode; body: (ws: string) => string }> = [
  { value: 'private', title: 'Private', icon: <Lock />, body: () => 'Only you can see and run it.' },
  {
    value: 'team',
    title: 'Team',
    icon: <Users />,
    body: (ws) => `Everyone in ${ws} can see it and run it on their own files. Admins and members can make a copy; viewers can only run.`,
  },
]

/** Owner-only: flip visibility and copy a version-pinned link. */
export function ShareDialog({
  open,
  onClose,
  workflow,
  versionId,
  versionNumber,
}: {
  open: boolean
  onClose: () => void
  workflow: WorkflowSummary
  versionId: string
  versionNumber: number
}) {
  const [visibility, setVisibility] = React.useState<Visibility>(workflow.visibility)
  const queryClient = useQueryClient()
  const toast = useToast()
  React.useEffect(() => {
    if (open) setVisibility(workflow.visibility)
  }, [open, workflow.visibility])

  const save = useMutation({
    mutationFn: (next: Visibility) => api.patch<{ workflow: WorkflowSummary }>(`/api/workflows/${workflow.id}`, { visibility: next }),
    onSuccess: async (_res, next) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workflowAll(workflow.id) }),
        queryClient.invalidateQueries({ queryKey: qk.access(workflow.id) }),
        queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      toast.show({
        tone: 'ok',
        title: next === 'team' ? `Shared with ${workflow.workspace.name}` : 'Recipe is private again',
        description: next === 'team' ? 'Copy the link below to send it.' : 'New access is blocked now. Copies already made keep working.',
      })
      if (next === 'private') onClose()
    },
  })

  const link = shareLink(workflow.id, versionId)
  const error = save.error instanceof ApiError ? save.error : null
  const dirty = visibility !== workflow.visibility

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={<Share2 />}
      title={`Share “${workflow.title}”`}
      description="Sharing shares the recipe only: never your files, results or run history."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="brand" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(visibility)}>
            {visibility === 'team' ? `Share with ${workflow.workspace.name}` : 'Make private'}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Who can see this recipe" className="grid gap-2.5 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const selected = visibility === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setVisibility(opt.value)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all',
                selected ? 'border-brand bg-brand-soft/60 shadow-[0_0_0_3px_var(--brand-soft)]' : 'border-line hover:border-line-strong',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink [&_svg]:size-4 [&_svg]:text-brand-ink">
                {opt.icon}
                {opt.title}
                {workflow.visibility === opt.value && <span className="text-[11px] font-normal text-faint">(current)</span>}
              </span>
              <span className="text-[12.5px] leading-snug text-muted">{opt.body(workflow.workspace.name)}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        <div className="mb-1.5 text-[13px] font-medium text-ink-2">Link to version {versionNumber}</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sunken px-3 py-2 text-[12px] text-ink-2">{link}</code>
          <CopyLinkButton href={link} label="Copy" />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted">
          <Copy className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          A link is a pointer, not a grant: people still need access, which is checked on every request.
          {workflow.visibility === 'private' && ' Right now only you can open it.'}
        </p>
      </div>
      {error && <Callout tone="bad" className="mt-4">{error.message}</Callout>}
    </Dialog>
  )
}
