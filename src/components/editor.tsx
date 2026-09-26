import * as React from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
  CheckCircle2,
  Columns3,
  FileSpreadsheet,
  Filter,
  ListOrdered,
  Plus,
  Save,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Wand2,
} from 'lucide-react'
import { api, ApiError, qk } from '~/lib/api'
import { CsvError, inferColumns, literalMismatch } from '~/lib/csv'
import { SAMPLE_FILES, fetchSample, type SampleName } from '~/lib/samples'
import { formatINR } from '~/lib/format'
import { describeStep } from '~/lib/workflow/describe'
import { analyze, validateDefinition } from '~/lib/workflow/validate'
import {
  AMOUNT_ONLY_OPERATORS,
  COLUMN_TYPE_LABEL,
  LIMITS,
  NAME_PATTERN,
  OPERATORS,
  type Column,
  type ColumnType,
  type Operator,
  type WorkflowDefinition,
} from '~/lib/workflow/schema'
import {
  definitionToDraft,
  draftFromUnknown,
  draftToDefinition,
  mergeColumns,
  newParam,
  newStep,
  type Draft,
  type DraftColumn,
  type DraftParam,
  type DraftStep,
} from '~/lib/workflow/draft'
import { OPERATOR_PHRASE } from '~/lib/workflow/describe'
import type { ApiIssue, GenerateResult, Me, WorkflowSummary } from '~/lib/types'
import { Badge, Button, Callout, Card, Dialog, Field, Input, Select, Textarea, cn } from './ui'
import { ColumnChip, StepIcon } from './workflow-bits'
import { FileDrop } from './file-drop'
import { useToast } from './toast'

// ---------------------------------------------------------------------------

type Props =
  | { mode: 'create'; initial: Draft; me: Me }
  | { mode: 'edit'; initial: Draft; me: Me; workflowId: string; currentVersion: number; savedTitle: string; savedDescription: string }

type AiNote =
  | { kind: 'ok'; model: string; repaired: boolean }
  | { kind: 'invalid'; message: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'clarification'; question: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'limited'; message: string }
  | null

const isIdLike = (name: string) => /(^|[_\s-])id$/i.test(name.trim())

export function RecipeEditor(props: Props) {
  const { mode, me } = props
  const [draft, setDraft] = React.useState<Draft>(props.initial)
  const [aiNote, setAiNote] = React.useState<AiNote>(null)
  const [jsonOpen, setJsonOpen] = React.useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const raw = React.useMemo(() => draftToDefinition(draft), [draft])
  const validation = React.useMemo(() => validateDefinition(raw), [raw])
  const analysis = React.useMemo(() => analyze(raw), [raw])
  const issues: ApiIssue[] = validation.ok ? [] : validation.issues
  const titleProblem = !draft.title.trim() ? 'Give the recipe a title' : draft.title.length > LIMITS.titleMax ? 'Titles can be at most 120 characters' : null
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initial)
  const initialDefinition = React.useMemo(() => JSON.stringify(draftToDefinition(props.initial)), [props.initial])
  const definitionChanged = JSON.stringify(raw) !== initialDefinition
  const detailsChanged = draft.title.trim() !== props.initial.title.trim() || draft.description.trim() !== props.initial.description.trim()

  // Refs, not state: the blocker runs during navigation, possibly in the same
  // tick as a successful save, and must see the latest values.
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  const savedRef = React.useRef(false)
  useBlocker({
    shouldBlockFn: () =>
      dirtyRef.current && !savedRef.current && !window.confirm('Leave without saving? Your changes to this recipe will be lost.'),
    enableBeforeUnload: () => dirtyRef.current && !savedRef.current,
  })

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const updateStep = (key: string, patch: Partial<DraftStep>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))
  const updateParam = (key: string, patch: Partial<DraftParam>) =>
    setDraft((d) => {
      const before = d.parameters.find((p) => p.key === key)
      const parameters = d.parameters.map((p) => (p.key === key ? { ...p, ...patch } : p))
      // Keep step references in sync when a parameter is renamed.
      const steps =
        before && patch.name !== undefined && patch.name !== before.name
          ? d.steps.map((s) => (s.valueKind === 'parameter' && s.parameter === before.name ? { ...s, parameter: patch.name! } : s))
          : d.steps
      return { ...d, parameters, steps }
    })

  const save = useMutation({
    mutationFn: async () => {
      const definition = validation.ok ? validation.definition : raw
      if (props.mode === 'create') {
        return api.post<{ workflow: WorkflowSummary; version: { id: string; number: number } }>('/api/workflows', {
          title: draft.title.trim(),
          description: draft.description.trim(),
          definition,
        })
      }
      // Only a changed definition creates a new version; title and description are recipe details.
      const res = definitionChanged
        ? await api.post<{ workflowId: string; version: { id: string; number: number } }>(`/api/workflows/${props.workflowId}/versions`, {
            definition,
          })
        : null
      if (draft.title.trim() !== props.savedTitle || draft.description.trim() !== props.savedDescription) {
        await api.patch(`/api/workflows/${props.workflowId}`, { title: draft.title.trim(), description: draft.description.trim() })
      }
      return { workflow: { id: props.workflowId } as WorkflowSummary, version: res?.version ?? null }
    },
    onSuccess: async (res) => {
      savedRef.current = true
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.workflowsAll }),
        queryClient.invalidateQueries({ queryKey: qk.workflowAll(res.workflow.id) }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ])
      toast.show({
        tone: 'ok',
        title: mode === 'create' ? 'Recipe saved as version 1' : res.version ? `Saved version ${res.version.number}` : 'Details saved',
        description:
          mode === 'create'
            ? 'It is private. Run it, then share it when you are ready.'
            : res.version
              ? 'Earlier versions and their runs are unchanged.'
              : 'Title and description changed; the steps and their version stay as they were.',
      })
      await navigate({ to: '/w/$workflowId', params: { workflowId: res.workflow.id } })
    },
  })

  const applyDefinition = (def: unknown, origin: Draft['origin']) => {
    const loaded = draftFromUnknown(def)
    setDraft((d) => ({ ...d, columns: mergeColumns(d.columns, loaded.columns), parameters: loaded.parameters, steps: loaded.steps, origin }))
  }

  const generate = useMutation({
    mutationFn: () =>
      api.post<GenerateResult>('/api/generate', {
        request: draft.request.trim(),
        columns: Object.fromEntries(draft.columns.filter((c) => c.include).map((c) => [c.name, c.type])),
      }),
    onMutate: () => setAiNote(null),
    onSuccess: (res) => {
      if (res.kind === 'workflow') {
        applyDefinition(res.definition, 'ai')
        setAiNote({ kind: 'ok', model: res.model, repaired: res.repaired })
      } else if (res.kind === 'unsupported') setAiNote({ kind: 'unsupported', reason: res.reason })
      else setAiNote({ kind: 'clarification', question: res.question })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DRAFT_INVALID' && err.draft) {
        applyDefinition(err.draft, 'ai')
        setAiNote({ kind: 'invalid', message: err.message })
      } else if (err instanceof ApiError && err.status === 429) {
        setAiNote({ kind: 'limited', message: err.message })
      } else if (err instanceof ApiError && err.status === 503) {
        setAiNote({ kind: 'unavailable', message: err.message })
      } else {
        setAiNote({ kind: 'unavailable', message: err instanceof Error ? err.message : 'Generation failed.' })
      }
    },
  })

  const canSave = validation.ok && !titleProblem && !save.isPending && (mode === 'create' || definitionChanged || detailsChanged)
  const inputIssues = issues.filter((i) => i.path.startsWith('input'))
  const stepIssues = (index: number) => issues.filter((i) => i.stepIndex === index)
  const paramIssues = (name: string) => issues.filter((i) => i.path === `parameters.${name}` || i.path.startsWith(`parameters.${name}.`))
  const serverError = save.error instanceof ApiError ? save.error : save.error ? new ApiError(0, 'ERROR', save.error.message) : null

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Section number={1} title="Name it" description="What the report is for, in words your team will recognise.">
          <div className="grid gap-4">
            <Field label="Title" htmlFor="title" error={draft.title && titleProblem ? titleProblem : undefined}>
              <Input
                id="title"
                value={draft.title}
                maxLength={LIMITS.titleMax}
                placeholder="Regional revenue exceptions"
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <Field label="Description" htmlFor="description" hint="Optional. Shown on the recipe card.">
              <Textarea
                id="description"
                value={draft.description}
                maxLength={LIMITS.descriptionMax}
                rows={2}
                placeholder="Keeps paid orders, totals them by region, and flags regions below a threshold."
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
          </div>
        </Section>

        <InputSection draft={draft} setDraft={setDraft} issues={inputIssues} />

        <DescribeSection
          draft={draft}
          me={me}
          onChange={(request) => update({ request })}
          generate={() => generate.mutate()}
          generating={generate.isPending}
          note={aiNote}
        />

        <Section
          number={4}
          title="Review the steps"
          description="Each step works on the rows left by the step before it. Only filter and group & sum exist, so nothing here can run code."
          badge={
            draft.origin === 'ai' ? (
              <Badge tone="ai" icon={<Sparkles />}>
                AI draft — review before saving
              </Badge>
            ) : undefined
          }
        >
          <div className="space-y-3">
            {draft.steps.length === 0 && (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
                No steps yet. {me.model.available ? 'Generate them from your description, or add them by hand.' : 'Add them by hand below.'}
              </p>
            )}
            {draft.steps.map((step, i) => (
              <StepCard
                key={step.key}
                step={step}
                index={i}
                count={draft.steps.length}
                available={analysis.stages[i]?.available ?? []}
                parameters={draft.parameters}
                issues={stepIssues(i)}
                aiDraft={draft.origin === 'ai'}
                definition={validation.ok ? validation.definition : null}
                sampleValues={draft.columns.find((c) => c.name === step.column && c.type === 'string')?.values}
                onChange={(patch) => updateStep(step.key, patch)}
                onMove={(dir) =>
                  setDraft((d) => {
                    const steps = [...d.steps]
                    const j = i + dir
                    if (j < 0 || j >= steps.length) return d
                    ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
                    return { ...d, steps }
                  })
                }
                onRemove={() => setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.key !== step.key) }))}
                onMakeParameter={(dflt, type) =>
                  setDraft((d) => {
                    const p = newParam(
                      d.parameters.map((x) => x.name),
                      type,
                      dflt,
                    )
                    return {
                      ...d,
                      parameters: [...d.parameters, p],
                      steps: d.steps.map((s) => (s.key === step.key ? { ...s, valueKind: 'parameter', parameter: p.name } : s)),
                    }
                  })
                }
              />
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                icon={<Filter className="size-3.5" />}
                disabled={draft.steps.length >= LIMITS.steps}
                onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep('filter', d.steps.map((s) => s.id))] }))}
              >
                Add filter
              </Button>
              <Button
                size="sm"
                icon={<Sigma className="size-3.5" />}
                disabled={draft.steps.length >= LIMITS.steps}
                onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep('group_sum', d.steps.map((s) => s.id))] }))}
              >
                Add group &amp; sum
              </Button>
              <span className="self-center text-[12px] text-faint">
                {draft.steps.length}/{LIMITS.steps} steps
              </span>
            </div>
          </div>
        </Section>

        <Section
          number={5}
          title="Parameters"
          description="Values people can change for a single run (like a threshold). Run values never edit the saved recipe."
        >
          <div className="space-y-3">
            {draft.parameters.length === 0 && (
              <p className="text-[13px] text-muted">No parameters. Tip: on a filter step, choose “Make adjustable” to turn a fixed value into one.</p>
            )}
            {draft.parameters.map((p) => (
              <ParamRow
                key={p.key}
                param={p}
                issues={paramIssues(p.name)}
                used={draft.steps.some((s) => s.valueKind === 'parameter' && s.parameter === p.name)}
                onChange={(patch) => updateParam(p.key, patch)}
                onRemove={() => setDraft((d) => ({ ...d, parameters: d.parameters.filter((x) => x.key !== p.key) }))}
              />
            ))}
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={draft.parameters.length >= LIMITS.parameters}
              onClick={() => setDraft((d) => ({ ...d, parameters: [...d.parameters, newParam(d.parameters.map((p) => p.name))] }))}
            >
              Add parameter
            </Button>
          </div>
        </Section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            {validation.ok && !titleProblem ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-ok-ink">
                <CheckCircle2 className="size-4.5 text-ok" /> Ready to save
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <AlertCircle className="size-4.5 text-warn" />
                {issues.length + (titleProblem ? 1 : 0)} thing{issues.length + (titleProblem ? 1 : 0) === 1 ? '' : 's'} to fix
              </div>
            )}
            {!validation.ok || titleProblem ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12.5px] text-muted">
                {titleProblem && <li>• {titleProblem}</li>}
                {issues.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    • {issue.stepIndex !== undefined ? <span className="font-medium text-ink-2">Step {issue.stepIndex + 1}: </span> : null}
                    {issue.message}
                  </li>
                ))}
                {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">The server checks it again on save and before every run.</p>
            )}
          </div>

          <div className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-faint uppercase">
              <Columns3 className="size-3.5" /> Columns through the pipeline
            </div>
            <PipelineColumns input={analysis.input} stages={analysis.stages} steps={draft.steps} />
          </div>

          <div className="space-y-2 border-t border-line bg-surface-2 px-5 py-4">
            {serverError && (
              <Callout tone="bad" title="Not saved">
                {serverError.message}
              </Callout>
            )}
            <Button variant="brand" size="lg" className="w-full" icon={<Save className="size-4" />} disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>
              {mode === 'create'
                ? 'Save recipe'
                : definitionChanged || !detailsChanged
                  ? `Save as version ${props.mode === 'edit' ? props.currentVersion + 1 : ''}`
                  : 'Save details'}
            </Button>
            <p className="text-center text-[12px] text-muted">
              {mode === 'create'
                ? 'Saved as a private version 1. You choose when to share it.'
                : `Version ${props.mode === 'edit' ? props.currentVersion : ''} stays exactly as it is.`}
            </p>
            <Button variant="ghost" size="sm" className="w-full" icon={<Braces className="size-3.5" />} onClick={() => setJsonOpen(true)}>
              Advanced: view or paste JSON
            </Button>
          </div>
        </Card>
      </aside>

      <JsonDialog
        open={jsonOpen}
        onClose={() => setJsonOpen(false)}
        current={raw}
        onApply={(def) => {
          setDraft((d) => ({ ...d, ...definitionToDraft(def), columns: mergeColumns(d.columns, definitionToDraft(def).columns), origin: 'blank' }))
          setJsonOpen(false)
          toast.show({ tone: 'ok', title: 'JSON applied', description: 'The step cards now show the pasted recipe.' })
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function Section({
  number,
  title,
  description,
  badge,
  children,
}: {
  number: number
  title: string
  description?: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="animate-rise">
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[12.5px] font-semibold text-canvas">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {badge}
          </div>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      <div className="px-5 pb-5">{children}</div>
    </Card>
  )
}

function IssueList({ issues }: { issues: ApiIssue[] }) {
  if (!issues.length) return null
  return (
    <div role="alert">
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-bad-ink">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ----- 2. Declare input ------------------------------------------------------

function InputSection({ draft, setDraft, issues }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; issues: ApiIssue[] }) {
  const [file, setFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [newName, setNewName] = React.useState('')
  const [newType, setNewType] = React.useState<ColumnType>('string')

  const loadSample = (textValue: string, name: string) => {
    try {
      const inferred = inferColumns(textValue)
      setError(null)
      setDraft((d) => {
        const previous = new Map(d.columns.map((c) => [c.name, c]))
        const columns: DraftColumn[] = inferred.columns.map((c) => ({
          name: c.name,
          type: previous.get(c.name)?.type ?? c.type,
          include: previous.get(c.name)?.include ?? !isIdLike(c.name),
          samples: c.samples,
          blanks: c.blanks,
          values: c.values,
        }))
        return { ...d, columns }
      })
      return name
    } catch (err) {
      setError(err instanceof CsvError ? err.message : 'This file could not be read as CSV.')
      return null
    }
  }

  const loadDemoFile = async (name: SampleName) => {
    const sample = await fetchSample(name)
    setFile(sample)
    loadSample(await sample.text(), name)
  }

  const included = draft.columns.filter((c) => c.include).length

  return (
    <Section
      number={2}
      title="Declare the input"
      description="The columns every file must have. Read a sample to fill this in; the sample stays in your browser and is never uploaded."
    >
      <div className="space-y-4">
        <FileDrop
          id="sample-file"
          file={file}
          compact
          label="Drop a sample CSV, or choose one"
          hint="Read in this browser to suggest columns; it is never uploaded"
          onFile={async (picked) => {
            setFile(picked)
            if (picked.size > LIMITS.fileBytes) {
              setError('The sample is larger than the 1 MiB limit.')
              return
            }
            loadSample(await picked.text(), picked.name)
          }}
          onClear={() => {
            setFile(null)
            setError(null)
          }}
        />
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>Or use a sample file:</span>
          {SAMPLE_FILES.map((sample) => (
            <Button
              key={sample.name}
              size="sm"
              aria-label={`Use ${sample.name}`}
              icon={<FileSpreadsheet className="size-3.5" />}
              onClick={() => loadDemoFile(sample.name)}
            >
              {sample.name}
            </Button>
          ))}
        </div>
        {error && <Callout tone="bad">{error}</Callout>}

        {draft.columns.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-left text-[11.5px] text-faint">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 font-medium">
                    <span className="sr-only">Required</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Column
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                    Sample values
                  </th>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.columns.map((c, i) => (
                  <tr key={c.name} className={cn('border-t border-line', !c.include && 'bg-surface-2 text-faint')}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={c.include}
                        aria-label={`Require column ${c.name}`}
                        className="size-4 accent-[var(--brand)]"
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, columns: d.columns.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-[12.5px]">{c.name}</td>
                    <td className="px-3 py-2">
                      <Select
                        aria-label={`Type of ${c.name}`}
                        value={c.type}
                        disabled={!c.include}
                        className="!h-8 !rounded-lg text-[12.5px]"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            columns: d.columns.map((x, j) => (j === i ? { ...x, type: e.target.value as ColumnType } : x)),
                          }))
                        }
                      >
                        <option value="string">Text</option>
                        <option value="integer_inr">Amount (₹, whole)</option>
                      </Select>
                    </td>
                    <td className="hidden max-w-0 truncate px-3 py-2 text-[12.5px] text-muted sm:table-cell">
                      {c.samples.length ? c.samples.join(' · ') : <span className="text-faint">—</span>}
                      {c.blanks > 0 && <span className="ml-1 text-warn-ink">({c.blanks} blank)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Remove column ${c.name}`}
                        className="grid size-7 place-items-center rounded-md text-faint hover:bg-sunken hover:text-bad-ink"
                        onClick={() => setDraft((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newName.trim()
            if (!name || draft.columns.some((c) => c.name === name)) return
            setDraft((d) => ({ ...d, columns: [...d.columns, { name, type: newType, include: true, samples: [], blanks: 0 }] }))
            setNewName('')
          }}
        >
          <Field label="Add a column by name" htmlFor="new-column" className="min-w-40 flex-1">
            <Input id="new-column" value={newName} maxLength={LIMITS.columnNameMax} placeholder="e.g. region" onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Select aria-label="Type of the new column" value={newType} onChange={(e) => setNewType(e.target.value as ColumnType)} wrapperClassName="w-44">
            <option value="string">Text</option>
            <option value="integer_inr">Amount (₹, whole)</option>
          </Select>
          <Button type="submit" icon={<Plus className="size-3.5" />} disabled={!newName.trim() || draft.columns.some((c) => c.name === newName.trim())}>
            Add
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>
            {included} required column{included === 1 ? '' : 's'}. Unchecked columns are ignored when the recipe runs.
          </span>
        </div>
        <IssueList issues={issues} />
      </div>
    </Section>
  )
}

// ----- 3. Describe + Generate ----------------------------------------------------

function DescribeSection({
  draft,
  me,
  onChange,
  generate,
  generating,
  note,
}: {
  draft: Draft
  me: Me
  onChange: (value: string) => void
  generate: () => void
  generating: boolean
  note: AiNote
}) {
  const length = draft.request.trim().length
  const hasColumns = draft.columns.some((c) => c.include)
  const ready = me.model.available && hasColumns && length >= LIMITS.requestMin && length <= LIMITS.requestMax
  return (
    <Section
      number={3}
      title="Describe the report"
      description="One sentence is enough. The model sees your column names and types, never your data, and only drafts steps for you to review."
      badge={
        <Badge tone={me.model.available ? 'ai' : 'neutral'} icon={<Sparkles />}>
          {me.model.available ? `AI on · ${me.model.model}` : 'AI off'}
        </Badge>
      }
    >
      <div className="space-y-3">
        <Textarea
          aria-label="Describe the report"
          value={draft.request}
          rows={3}
          maxLength={LIMITS.requestMax}
          placeholder="Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000."
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ai" icon={<Wand2 className="size-4" />} disabled={!ready} loading={generating} onClick={generate}>
            {draft.steps.length ? 'Regenerate steps' : 'Generate steps'}
          </Button>
          <span className="text-[12px] text-faint">
            {!hasColumns
              ? 'Declare the input columns first.'
              : draft.steps.length
                ? 'Regenerating replaces the steps and parameters below.'
                : `${length}/${LIMITS.requestMax} characters`}
          </span>
        </div>

        {!me.model.available && (
          <Callout tone="info" title="AI drafting is off on this server">
            No model key is configured, so steps can't be generated right now. Add them by hand in step 4: every saved recipe runs
            without AI either way.
          </Callout>
        )}
        {note?.kind === 'ok' && (
          <Callout tone="ai" title="Draft ready for review">
            Generated by {note.model}
            {note.repaired ? ' (after one automatic repair)' : ''}. Check each step card, then save. Nothing is saved or run until you do.
          </Callout>
        )}
        {note?.kind === 'invalid' && (
          <Callout tone="warn" title="The draft needs fixing">
            {note.message} The problems are pinned to the step cards below.
          </Callout>
        )}
        {note?.kind === 'unsupported' && (
          <Callout tone="warn" title="That isn't something a recipe can do">
            {note.reason} Recipes can only filter rows and total amounts by a column, on a file you upload.
          </Callout>
        )}
        {note?.kind === 'clarification' && (
          <Callout tone="info" title="One question first">
            {note.question} Edit your description and generate again.
          </Callout>
        )}
        {note?.kind === 'limited' && (
          <Callout tone="warn" title="Slow down a little">
            {note.message}
          </Callout>
        )}
        {note?.kind === 'unavailable' && (
          <Callout tone="bad" title="AI generation is unavailable">
            {note.message} Saved recipes still run, and you can add steps by hand.
          </Callout>
        )}
      </div>
    </Section>
  )
}

// ----- 4. Step card ---------------------------------------------------------------

function columnOptions(available: Column[], current: string, want?: ColumnType) {
  const options = available.filter((c) => !want || c.type === want)
  const missing = current && !available.some((c) => c.name === current)
  return { options, missing }
}

function StepCard({
  step,
  index,
  count,
  available,
  parameters,
  issues,
  aiDraft,
  definition,
  onChange,
  onMove,
  onRemove,
  onMakeParameter,
  sampleValues,
}: {
  step: DraftStep
  index: number
  count: number
  available: Column[]
  parameters: DraftParam[]
  issues: ApiIssue[]
  aiDraft: boolean
  definition: WorkflowDefinition | null
  onChange: (patch: Partial<DraftStep>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onMakeParameter: (defaultValue: string, type: 'integer' | 'string') => void
  /** Distinct values of this step's column in the sample file, if one was read. */
  sampleValues?: string[]
}) {
  const columnType = available.find((c) => c.name === step.column)?.type
  const isAmount = columnType === 'integer_inr'
  const operators = OPERATORS.filter((op) => !(columnType === 'string' && AMOUNT_ONLY_OPERATORS.has(op)))
  const matchingParams = parameters.filter((p) => (isAmount ? p.type === 'integer' : columnType === 'string' ? p.type === 'string' : true))
  const savedStep = definition?.steps[index]
  const preview = savedStep && issues.length === 0 ? describeStep(savedStep, columnType, definition!) : null
  // The model never sees data, so a text value can be valid yet never match (e.g. "Paid" vs "paid").
  const mismatch =
    step.type === 'filter' && columnType === 'string' && step.valueKind === 'literal' && sampleValues?.length
      ? literalMismatch(step.column, step.literal.trim(), sampleValues)
      : null
  const idOk = NAME_PATTERN.test(step.id)

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface transition-colors',
        issues.length ? 'border-bad/40' : aiDraft ? 'border-ai/30' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="grid size-6 place-items-center rounded-lg bg-brand-soft text-[11.5px] font-semibold text-brand-ink">{index + 1}</span>
        <StepIcon type={step.type} className="text-muted" />
        <Select
          aria-label={`Step ${index + 1} type`}
          value={step.type}
          className="!h-8 !rounded-lg text-[13px] font-medium"
          wrapperClassName="w-40"
          onChange={(e) => {
            const type = e.target.value as DraftStep['type']
            onChange(type === 'group_sum' ? { type, as: step.as || 'total' } : { type })
          }}
        >
          <option value="filter">Filter rows</option>
          <option value="group_sum">Group &amp; sum</option>
        </Select>
        <label className="flex items-center gap-1 text-[12px] text-faint">
          id
          <input
            value={step.id}
            aria-label={`Step ${index + 1} id`}
            aria-invalid={!idOk || undefined}
            onChange={(e) => onChange({ id: e.target.value })}
            className={cn('h-7 w-16 rounded-md border bg-transparent px-1.5 font-mono text-[12px] text-ink-2 focus:border-brand focus:outline-none', idOk ? 'border-line' : 'border-bad')}
          />
        </label>
        {aiDraft && (
          <Badge tone="ai" icon={<Sparkles />} className="hidden sm:inline-flex">
            AI draft
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-3.5" />
          </IconBtn>
          <IconBtn label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-3.5" />
          </IconBtn>
          <IconBtn label="Delete step" danger onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </IconBtn>
        </div>
      </div>

      <div className="space-y-3 px-3.5 py-3.5">
        {step.type === 'filter' ? (
          <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
            <span className="text-[13px] text-muted">Keep rows where</span>
            <ColumnSelect label="Column" value={step.column} available={available} onChange={(column) => {
              const t = available.find((c) => c.name === column)?.type
              onChange({ column, operator: t === 'string' && AMOUNT_ONLY_OPERATORS.has(step.operator) ? 'eq' : step.operator })
            }} />
            <Select aria-label="Comparison" value={step.operator} className="text-[13px]" onChange={(e) => onChange({ operator: e.target.value as Operator })}>
              {operators.map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_PHRASE[op]}
                </option>
              ))}
            </Select>
            <div className="flex min-w-0 items-center gap-1.5">
              {step.valueKind === 'literal' ? (
                <div className="relative min-w-0 flex-1">
                  {isAmount && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-faint">₹</span>}
                  <Input
                    aria-label="Value"
                    value={step.literal}
                    inputMode={isAmount ? 'numeric' : undefined}
                    placeholder={isAmount ? '100000' : 'e.g. paid'}
                    className={cn('text-[13px]', isAmount && 'pl-6')}
                    onChange={(e) => onChange({ literal: e.target.value })}
                  />
                </div>
              ) : (
                <Select
                  aria-label="Parameter"
                  value={step.parameter}
                  wrapperClassName="min-w-0 flex-1"
                  className="font-mono text-[12.5px]"
                  onChange={(e) => onChange({ parameter: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {matchingParams.map((p) => (
                    <option key={p.key} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  {step.parameter && !parameters.some((p) => p.name === step.parameter) && <option value={step.parameter}>{step.parameter} (not declared)</option>}
                </Select>
              )}
            </div>
            <div className="sm:col-span-4 sm:col-start-2 flex flex-wrap items-center gap-2 text-[12px]">
              <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
                {(['literal', 'parameter'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onChange({ valueKind: kind })}
                    aria-pressed={step.valueKind === kind}
                    className={cn('rounded-md px-2 py-0.5 font-medium', step.valueKind === kind ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink')}
                  >
                    {kind === 'literal' ? 'Fixed value' : 'Parameter'}
                  </button>
                ))}
              </div>
              {step.valueKind === 'literal' && columnType && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
                  onClick={() => onMakeParameter(isAmount ? step.literal.replace(/\D/g, '') : step.literal, isAmount ? 'integer' : 'string')}
                >
                  <SlidersHorizontal className="size-3" /> Make adjustable
                </button>
              )}
              {step.valueKind === 'literal' && isAmount && /^\d+$/.test(step.literal.trim()) && (
                <span className="tabular text-faint">= {formatINR(Number(step.literal))}</span>
              )}
              {columnType === 'string' && <span className="text-faint">Exact, case-sensitive match</span>}
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)] sm:items-center">
            <span className="text-[13px] text-muted">Group by</span>
            <ColumnSelect label="Group by" value={step.groupBy} available={available} want="string" onChange={(groupBy) => onChange({ groupBy })} />
            <span className="text-[13px] text-muted">sum</span>
            <ColumnSelect label="Sum" value={step.valueColumn} available={available} want="integer_inr" onChange={(valueColumn) => onChange({ valueColumn })} />
            <span className="text-[13px] text-muted">as</span>
            <Input aria-label="New column name" value={step.as} className="font-mono text-[12.5px]" placeholder="total" onChange={(e) => onChange({ as: e.target.value })} />
            <p className="text-[12px] text-faint sm:col-span-6">After this step only the group-by column and the new total remain.</p>
          </div>
        )}

        {mismatch && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink" role="status">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">In your sample file, {mismatch.message}</span>
            {mismatch.suggestion && (
              <Button size="sm" onClick={() => onChange({ literal: mismatch.suggestion! })}>
                Use “{mismatch.suggestion}”
              </Button>
            )}
          </div>
        )}
        {issues.length > 0 ? (
          <IssueList issues={issues} />
        ) : preview ? (
          <p className={cn('flex items-start gap-1.5 text-[12.5px]', mismatch ? 'text-muted' : 'text-ok-ink')}>
            {!mismatch && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />} {preview}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ColumnSelect({
  label,
  value,
  available,
  want,
  onChange,
}: {
  label: string
  value: string
  available: Column[]
  want?: ColumnType
  onChange: (value: string) => void
}) {
  const { options, missing } = columnOptions(available, value, want)
  return (
    <Select aria-label={label} value={value} className="font-mono text-[12.5px]" onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a column…</option>
      {options.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name} · {c.type === 'integer_inr' ? '₹' : 'text'}
        </option>
      ))}
      {missing && <option value={value}>{value} (not available here)</option>}
    </Select>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md text-faint transition-colors disabled:opacity-30',
        danger ? 'hover:bg-bad-soft hover:text-bad-ink' : 'hover:bg-sunken hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

// ----- 5. Parameter row --------------------------------------------------------------

function ParamRow({
  param,
  issues,
  used,
  onChange,
  onRemove,
}: {
  param: DraftParam
  issues: ApiIssue[]
  used: boolean
  onChange: (patch: Partial<DraftParam>) => void
  onRemove: () => void
}) {
  return (
    <div className={cn('rounded-xl border px-3.5 py-3', issues.length ? 'border-bad/40' : 'border-line')}>
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Name" htmlFor={`p-name-${param.key}`}>
          <Input id={`p-name-${param.key}`} value={param.name} className="font-mono text-[12.5px]" onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Type" htmlFor={`p-type-${param.key}`}>
          <Select
            id={`p-type-${param.key}`}
            value={param.type}
            className="text-[13px]"
            onChange={(e) => onChange({ type: e.target.value as DraftParam['type'], default: '' })}
          >
            <option value="integer">Amount (₹)</option>
            <option value="string">Text</option>
          </Select>
        </Field>
        <Field label="Default" htmlFor={`p-default-${param.key}`}>
          <Input
            id={`p-default-${param.key}`}
            value={param.default}
            inputMode={param.type === 'integer' ? 'numeric' : undefined}
            className="text-[13px]"
            onChange={(e) => onChange({ default: e.target.value })}
          />
        </Field>
        {param.type === 'integer' ? (
          <>
            <Field label="Min" htmlFor={`p-min-${param.key}`}>
              <Input id={`p-min-${param.key}`} value={param.min} inputMode="numeric" className="text-[13px]" onChange={(e) => onChange({ min: e.target.value })} />
            </Field>
            <Field label="Max" htmlFor={`p-max-${param.key}`}>
              <Input id={`p-max-${param.key}`} value={param.max} inputMode="numeric" className="text-[13px]" onChange={(e) => onChange({ max: e.target.value })} />
            </Field>
          </>
        ) : (
          <div className="sm:col-span-2 text-[12px] text-muted sm:pb-2.5">Up to {LIMITS.textMax} characters</div>
        )}
        <IconBtn label={`Remove parameter ${param.name}`} danger onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconBtn>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {param.type === 'integer' && /^\d+$/.test(param.default) && <span className="tabular text-muted">Default {formatINR(Number(param.default))}</span>}
        {!used && <span className="text-warn-ink">Not used by any step yet</span>}
      </div>
      {issues.length > 0 && (
        <div className="mt-2">
          <IssueList issues={issues} />
        </div>
      )}
    </div>
  )
}

// ----- Sidebar: columns through the pipeline -------------------------------------------

function PipelineColumns({ input, stages, steps }: { input: Column[]; stages: ReturnType<typeof analyze>['stages']; steps: DraftStep[] }) {
  if (!input.length) return <p className="text-[12.5px] text-muted">Declare input columns to see how they flow through the steps.</p>
  return (
    <ol className="space-y-2.5">
      <li>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <FileSpreadsheet className="size-3.5 text-faint" /> Your file
        </div>
        <div className="flex flex-wrap gap-1">
          {input.map((c) => (
            <ColumnChip key={c.name} name={c.name} type={c.type} />
          ))}
        </div>
      </li>
      {stages.map((stage, i) => {
        const before = new Set(stage.available.map((c) => c.name))
        const step = steps[i]
        return (
          <li key={step?.key ?? i} className="border-l-2 border-line pl-3">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
              <StepIcon type={step?.type ?? 'filter'} className="size-3.5 text-faint" />
              {i + 1}. {step?.type === 'group_sum' ? 'Group & sum' : 'Filter'}
              <span className="font-mono text-faint">{step?.id}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {stage.output.map((c) => (
                <ColumnChip key={c.name} name={c.name} type={c.type} className={cn(!before.has(c.name) && 'ring-2 ring-brand/30')} />
              ))}
              {stage.removed.map((name) => (
                <span key={name} className="rounded-md px-1.5 py-0.5 font-mono text-[11.5px] text-faint line-through decoration-bad/60" title="Removed by this step">
                  {name}
                </span>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ----- Advanced JSON -------------------------------------------------------------------

function JsonDialog({
  open,
  onClose,
  current,
  onApply,
}: {
  open: boolean
  onClose: () => void
  current: unknown
  onApply: (def: WorkflowDefinition) => void
}) {
  const [textValue, setTextValue] = React.useState('')
  const [issues, setIssues] = React.useState<ApiIssue[] | null>(null)
  React.useEffect(() => {
    if (open) {
      setTextValue(JSON.stringify(current, null, 2))
      setIssues(null)
    }
  }, [open, current])

  const apply = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(textValue)
    } catch {
      setIssues([{ path: '', message: 'This is not valid JSON.' }])
      return
    }
    const result = validateDefinition(parsed)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    onApply(result.definition)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Braces />}
      title="Recipe JSON"
      description="FlowPilot's own format (not n8n's). Pasted JSON goes through the same strict validator; unknown keys and operations are rejected."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon={<ListOrdered className="size-4" />} onClick={apply}>
            Apply to editor
          </Button>
        </>
      }
    >
      <textarea
        aria-label="Definition JSON"
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        spellCheck={false}
        className="scrollbar-thin h-[46vh] w-full resize-none rounded-xl border border-line bg-sunken p-3 font-mono text-[12px] leading-relaxed text-ink focus:border-brand focus:outline-none"
      />
      {issues && (
        <div className="mt-3">
          <Callout tone="bad" title="Not applied">
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px]">
              {issues.slice(0, 12).map((i, n) => (
                <li key={n}>
                  {i.path && <code className="mr-1 text-[11.5px]">{i.path}</code>}
                  {i.message}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        <TypeIcon className="size-3.5" /> Column types: {COLUMN_TYPE_LABEL.string} (<code>string</code>) and {COLUMN_TYPE_LABEL.integer_inr} (<code>integer_inr</code>).
      </p>
    </Dialog>
  )
}
