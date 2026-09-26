import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  CircleDashed,
  Columns3,
  Copy,
  Filter,
  GitFork,
  Hash,
  ListStart,
  Lock,
  Sigma,
  Type,
  Users,
  XCircle,
} from 'lucide-react'
import { describeRecipe, formatParameterValue, parameterUnits } from '~/lib/workflow/describe'
import type { ColumnType, ParameterValues, WorkflowDefinition } from '~/lib/workflow/schema'
import type { Attribution, Role, RunStatus, Visibility, WorkflowSummary } from '~/lib/types'
import { Avatar, Badge, Button, Tip, buttonClass, cn } from './ui'

export function VisibilityBadge({ visibility, workspace }: { visibility: Visibility; workspace?: string }) {
  return visibility === 'team' ? (
    <Badge tone="brand" icon={<Users />} title={workspace ? `Shared with everyone in ${workspace}` : 'Shared with the team'}>
      Team
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<Lock />} title="Only the owner can see this recipe">
      Private
    </Badge>
  )
}

export function ExampleBadge() {
  return (
    <Badge tone="outline" icon={<BookOpen />} title="A hand-written example recipe, not model output">
      Example
    </Badge>
  )
}

export function ArchivedBadge() {
  return (
    <Badge tone="warn" icon={<Archive />}>
      Archived
    </Badge>
  )
}

export function CopyBadge() {
  return (
    <Badge tone="outline" icon={<GitFork />} title="An independent copy of another recipe">
      Copy
    </Badge>
  )
}

const ROLE_TONE = { admin: 'brand', member: 'flow', viewer: 'neutral' } as const
export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONE[role]}>{role}</Badge>
}

export function ColumnChip({ name, type, className }: { name: string; type: ColumnType; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11.5px] leading-4',
        type === 'string' ? 'border-line bg-sunken text-ink-2' : 'border-flow/25 bg-flow-soft text-flow-ink',
        className,
      )}
      title={type === 'integer_inr' ? `${name}: amount in whole rupees` : type === 'integer' ? `${name}: whole number` : `${name}: text`}
    >
      {type === 'integer_inr' ? (
        <span className="font-sans font-semibold">₹</span>
      ) : type === 'integer' ? (
        <Hash className="size-3 opacity-70" aria-hidden />
      ) : (
        <Type className="size-3 opacity-60" aria-hidden />
      )}
      <span className="truncate">{name}</span>
    </span>
  )
}

const STEP_ICONS: Record<string, typeof Filter> = {
  filter: Filter,
  group_sum: Sigma,
  aggregate: Calculator,
  sort: ArrowDownWideNarrow,
  limit: ListStart,
  select: Columns3,
}

export function StepIcon({ type, className }: { type: string; className?: string }) {
  const Icon = STEP_ICONS[type] ?? Filter
  return <Icon className={cn('size-4', className)} aria-hidden />
}

/** "Copied from Asha Rao's Regional revenue exceptions (v1)", or a hidden source. */
export function AttributionLine({ forkedFrom, className }: { forkedFrom: Attribution; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-[12.5px] text-muted', className)}>
      <GitFork className="size-3.5 shrink-0" aria-hidden />
      {forkedFrom.kind === 'visible' ? (
        <span className="min-w-0 truncate">
          Copied from {forkedFrom.owner.name}&rsquo;s{' '}
          <Link
            to="/w/$workflowId"
            params={{ workflowId: forkedFrom.workflowId }}
            search={{ v: forkedFrom.versionId }}
            className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-brand-ink"
          >
            {forkedFrom.title}
          </Link>{' '}
          (v{forkedFrom.versionNumber})
        </span>
      ) : (
        <span>Copied from a recipe you no longer have access to (v{forkedFrom.versionNumber})</span>
      )}
    </div>
  )
}

/** Plain-language, numbered steps. Computed from the definition, never generated. */
export function StepList({ definition, params, className }: { definition: WorkflowDefinition; params?: ParameterValues; className?: string }) {
  const lines = describeRecipe(definition, params)
  return (
    <ol className={cn('space-y-2', className)}>
      {definition.steps.map((step, i) => (
        <li key={step.id} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-brand-soft text-[11.5px] font-semibold text-brand-ink">
            {i + 1}
          </span>
          <span className="flex min-w-0 flex-1 items-start gap-2 text-[13.5px] leading-relaxed text-ink-2">
            <StepIcon type={step.type} className="mt-[3px] size-3.5 shrink-0 text-faint" />
            <span className="min-w-0">{lines[i]}</span>
          </span>
          <span className="mt-0.5 hidden shrink-0 font-mono text-[11px] text-faint sm:inline">{step.id}</span>
        </li>
      ))}
    </ol>
  )
}

export function ParameterSummary({ definition }: { definition: WorkflowDefinition }) {
  const entries = Object.entries(definition.parameters)
  const units = parameterUnits(definition)
  if (!entries.length) return <p className="text-[13px] text-muted">No parameters. Every run uses the saved values.</p>
  return (
    <ul className="space-y-1.5">
      {entries.map(([name, p]) => (
        <li key={name} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <code className="rounded-md bg-sunken px-1.5 py-0.5 text-[12px] text-ink">{name}</code>
          {p.type === 'integer' ? (
            <span className="text-muted">
              default <span className="tabular font-medium text-ink-2">{formatParameterValue(p.default, units[name])}</span> · allowed{' '}
              <span className="tabular">{formatParameterValue(p.min, units[name])}</span>–<span className="tabular">{formatParameterValue(p.max, units[name])}</span>
            </span>
          ) : (
            <span className="text-muted">
              default <span className="font-medium text-ink-2">“{p.default}”</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function RunStatusBadge({ status, errorCode }: { status: RunStatus; errorCode?: string | null }) {
  if (status === 'succeeded') return <Badge tone="ok" icon={<CheckCircle2 />}>Succeeded</Badge>
  if (status === 'failed') {
    return (
      <Badge tone="bad" icon={<XCircle />}>
        {errorCode === 'STALE' ? 'Failed · stale' : errorCode === 'TIMEOUT' ? 'Failed · timeout' : 'Failed'}
      </Badge>
    )
  }
  return (
    <Badge tone="warn" icon={<CircleDashed className="animate-spin [animation-duration:2.5s]" />}>
      Running
    </Badge>
  )
}

export function RecipeCard({ recipe, onFork }: { recipe: WorkflowSummary; onFork?: (recipe: WorkflowSummary) => void }) {
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--brand-soft),var(--flow-soft))] text-brand-ink">
          <Hash className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">
            <Link
              to="/w/$workflowId"
              params={{ workflowId: recipe.id }}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-[var(--ring)]"
            >
              {recipe.title}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <VisibilityBadge visibility={recipe.visibility} workspace={recipe.workspace.name} />
            {recipe.isExample && <ExampleBadge />}
            {recipe.forkedFrom && <CopyBadge />}
            {recipe.archivedAt && <ArchivedBadge />}
            <span className="text-[12px] text-faint">
              v{recipe.currentVersion.number} · {recipe.stepCount} step{recipe.stepCount === 1 ? '' : 's'}
              {recipe.parameterNames.length ? ` · ${recipe.parameterNames.length} parameter${recipe.parameterNames.length === 1 ? '' : 's'}` : ''}
            </span>
          </div>
        </div>
      </div>

      {recipe.description ? (
        <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{recipe.description}</p>
      ) : (
        <p className="mt-3 text-[13.5px] text-faint italic">No description</p>
      )}

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">Needs columns</div>
        <div className="flex flex-wrap gap-1.5">
          {recipe.requiredColumns.map((c) => (
            <ColumnChip key={c.name} name={c.name} type={c.type} />
          ))}
        </div>
      </div>

      {recipe.forkedFrom && <AttributionLine forkedFrom={recipe.forkedFrom} className="relative z-10 mt-3" />}

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-4 [&]:mt-5">
        <Avatar name={recipe.owner.name} hue={recipe.owner.hue} size={24} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {recipe.isMine ? 'You' : recipe.owner.name} · {recipe.workspace.name}
        </span>
        <div className="relative z-10 flex items-center gap-1.5">
          {onFork &&
            (recipe.canFork ? (
              <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => onFork(recipe)}>
                Make a copy
              </Button>
            ) : (
              <Tip content="Viewers can run recipes but cannot make copies">
                <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} disabled aria-disabled>
                  Make a copy
                </Button>
              </Tip>
            ))}
          <Link to="/w/$workflowId" params={{ workflowId: recipe.id }} className={buttonClass('secondary', 'sm')}>
            Run <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </article>
  )
}
