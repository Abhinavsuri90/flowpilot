import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GitFork } from 'lucide-react'
import { api, ApiError, qk } from '~/lib/api'
import type { WorkflowSummary } from '~/lib/types'
import { Button, Callout, Dialog, Field, Input, Select } from './ui'
import { useToast } from './toast'

type Target = { id: string; title: string; versions: Array<{ id: string; number: number }>; versionId: string }

/** Copies one version into a new private recipe owned by the caller, then opens it in the editor. */
export function ForkDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const [title, setTitle] = React.useState('')
  const [versionId, setVersionId] = React.useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  React.useEffect(() => {
    if (target) {
      setTitle(`Copy of ${target.title}`.slice(0, 120))
      setVersionId(target.versionId)
    }
  }, [target])

  const fork = useMutation({
    mutationFn: () =>
      api.post<{ workflow: WorkflowSummary; version: { id: string; number: number } }>(`/api/workflows/${target!.id}/fork`, {
        versionId,
        title: title.trim(),
      }),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
        queryClient.invalidateQueries({ queryKey: qk.workflowAll(target!.id) }),
      ])
      onClose()
      toast.show({ tone: 'ok', title: 'Private copy created', description: 'Adapt it and save. The original is not affected.' })
      await navigate({ to: '/w/$workflowId/edit', params: { workflowId: res.workflow.id } })
    },
  })

  const version = target?.versions.find((v) => v.id === versionId)
  const error = fork.error instanceof ApiError ? fork.error : null

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      icon={<GitFork />}
      title="Make a private copy"
      description="Your copy is a new recipe that only you can see. Changing it never changes the original."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" loading={fork.isPending} disabled={!title.trim() || !versionId} onClick={() => fork.mutate()}>
            Make a copy
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) fork.mutate()
        }}
      >
        <Field label="Title of your copy" htmlFor="fork-title">
          <Input id="fork-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {target && target.versions.length > 1 && (
          <Field label="Start from" htmlFor="fork-version" hint="The copy starts from exactly this version.">
            <Select id="fork-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {target.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.number}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ul className="space-y-1.5 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
          <li>• Copies the recipe {version ? `(v${version.number})` : ''} only: never anyone's files, results or run history.</li>
          <li>• Remembers where it came from, so its card says “Copied from …”.</li>
          <li>• Keeps working even if the original is edited or made private.</li>
        </ul>
        {error && <Callout tone="bad">{error.message}</Callout>}
      </form>
    </Dialog>
  )
}
