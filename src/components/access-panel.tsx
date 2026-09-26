import { useQuery } from '@tanstack/react-query'
import { Check, EyeOff, Minus, ShieldCheck } from 'lucide-react'
import { api, qk } from '~/lib/api'
import type { Action, WorkflowAccess } from '~/lib/types'
import { Avatar, Card, CardHeader, Skeleton, cn } from './ui'
import { RoleBadge } from './workflow-bits'

const ACTIONS: Array<{ action: Action; label: string }> = [
  { action: 'view', label: 'See' },
  { action: 'run', label: 'Run' },
  { action: 'fork', label: 'Copy' },
  { action: 'edit', label: 'Edit' },
  { action: 'share', label: 'Share' },
]

export function Allowed({ allowed, label }: { allowed: boolean; label: string }) {
  return allowed ? (
    <span className="inline-grid size-5.5 place-items-center rounded-md bg-ok-soft text-ok-ink" title={`${label}: allowed`}>
      <Check className="size-3.5" aria-hidden />
      <span className="sr-only">{label}: allowed</span>
    </span>
  ) : (
    <span className="inline-grid size-5.5 place-items-center rounded-md bg-sunken text-faint" title={`${label}: not allowed`}>
      <Minus className="size-3.5" aria-hidden />
      <span className="sr-only">{label}: not allowed</span>
    </span>
  )
}

/** Who can do what with this recipe, computed by the same policy the API enforces. */
export function WhoHasAccess({ workflowId }: { workflowId: string }) {
  const access = useQuery({ queryKey: qk.access(workflowId), queryFn: () => api.get<WorkflowAccess>(`/api/workflows/${workflowId}/access`) })

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Who has access"
        description={
          access.data
            ? access.data.visibility === 'team'
              ? `Shared with ${access.data.workspace.name}. Checked on every request.`
              : 'Private: only the owner can see it.'
            : 'Checked on every request.'
        }
      />
      <div className="px-5 pb-5">
        {access.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : access.isError ? (
          <p className="text-sm text-muted">{access.error.message}</p>
        ) : (
          // relative: keeps the sr-only cell labels inside the scroller (see ResultTable).
          <div className="scrollbar-thin relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-faint">
                  <th scope="col" className="pb-2 font-medium">
                    Person
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Role
                  </th>
                  {ACTIONS.map((a) => (
                    <th key={a.action} scope="col" className="pb-2 text-center font-medium">
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {access.data.members.map((m) => (
                  <tr key={m.user.id} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={m.user.name} hue={m.user.hue} size={24} />
                        <span className="truncate font-medium text-ink">{m.user.name}</span>
                        {m.isYou && <span className="text-[11px] text-faint">(you)</span>}
                        {m.isOwner && <span className="rounded-md bg-sunken px-1.5 text-[11px] text-muted">owner</span>}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <RoleBadge role={m.role} />
                    </td>
                    {ACTIONS.map((a) => (
                      <td key={a.action} className="py-2 text-center">
                        <Allowed allowed={m.can[a.action]} label={a.label} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="py-2 pr-3" colSpan={2}>
                    <span className="flex items-center gap-2 text-muted">
                      <span className="grid size-6 place-items-center rounded-full bg-sunken">
                        <EyeOff className="size-3.5" aria-hidden />
                      </span>
                      Anyone outside {access.data.workspace.name}
                    </span>
                  </td>
                  <td className={cn('py-2 text-center text-[12px] text-muted')} colSpan={ACTIONS.length}>
                    No access · the recipe answers 404, as if it didn't exist
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[12px] text-muted">Runs and results are private to whoever ran them, including from the owner and admins.</p>
      </div>
    </Card>
  )
}

export { ACTIONS as ACCESS_ACTIONS }
