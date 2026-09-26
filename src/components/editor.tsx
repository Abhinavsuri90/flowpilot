import * as React from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  Braces,
  Calculator,
  CheckCircle2,
  Columns3,
  FileSpreadsheet,
  Filter,
  ListOrdered,
  ListStart,
  Plus,
  Save,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Wand2,
  X,
} from 'lucide-react'
import { api, ApiError, qk } from '~/lib/api'
import { CsvError, inferColumns, literalMismatch } from '~/lib/csv'
import { SAMPLE_FILES, fetchSample, type SampleName } from '~/lib/samples'
import { formatCount, formatINR } from '~/lib/format'
import { describeStep, formatParameterValue, STEP_LABEL, DATE_OPERATOR_PHRASE, PART_PHRASE, type ParameterUnit } from '~/lib/workflow/describe'
import { describeRelative, formatDate, isIsoDate, relativeDate, todayIso } from '~/lib/dates'
import { CalendarRange } from 'lucide-react'
import { analyze, validateDefinition } from '~/lib/workflow/validate'
import {
  AGGREGATE_OPS,
  COLUMN_TYPE_LABEL,
  DATE_PARTS,
  DATE_UNITS,
  LIMITS,
  NAME_PATTERN,
  NUMERIC_ONLY_OPERATORS,
  OPERATORS,
  STEP_TYPES,
  TEXT_ONLY_OPERATORS,
  isDateType,
  isNumericType,
  type AggregateOp,
  type Column,
  type ColumnType,
  type DatePart,
  type DateUnit,
  type Operator,
  type StepType,
  type WorkflowDefinition,
} from '~/lib/workflow/schema'
import {
  definitionToDraft,
  draftFromUnknown,
  draftToDefinition,
  mergeColumns,
  newMeasure,
  newParam,
  newPick,
  newSortKey,
  newStep,
  splitList,
  typesBefore,
  type Draft,
  type DraftColumn,
  type DraftMeasure,
  type DraftParam,
  type DraftPick,
  type DraftSortKey,
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
  // Integer parameters read as rupees when they filter an amount, as plain numbers when they count rows.
  const paramUnits = React.useMemo(() => {
    const units: Record<string, 'inr' | 'number'> = {}
    const types = typesBefore(draft)
    draft.steps.forEach((s, i) => {
      if (s.valueKind !== 'parameter' || !s.parameter) return
      if (s.type === 'limit') units[s.parameter] ??= 'number'
      else if (s.type === 'filter') {
        const t = types[i]?.get(s.column)
        if (t === 'integer_inr') units[s.parameter] = 'inr'
        else if (t === 'integer') units[s.parameter] ??= 'number'
      }
    })
    return units
  }, [draft])
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
          description="Each step works on the rows left by the step before it. Steps come from a fixed list (filter, group, summarize, sort, keep first N, choose columns), so nothing here can run code."
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
                previousType={i > 0 ? draft.steps[i - 1]!.type : null}
                sampleValues={analysis.stages[i]?.available.some((c) => c.name === step.column && c.type === 'string') ? draft.columns.find((c) => c.name === step.column)?.values : undefined}
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
                onMakeParameter={(dflt, type, options) =>
                  setDraft((d) => {
                    const p = newParam(
                      d.parameters.map((x) => x.name),
                      type,
                      dflt,
                      options?.base,
                      options?.min,
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
              {(
                [
                  ['aggregate', 'Add summary', <Calculator key="i" className="size-3.5" />],
                  ['sort', 'Add sort', <ArrowDownWideNarrow key="i" className="size-3.5" />],
                  ['limit', 'Add keep first N', <ListStart key="i" className="size-3.5" />],
                  ['select', 'Add column choice', <Columns3 key="i" className="size-3.5" />],
                  ['date_part', 'Add period from a date', <CalendarRange key="i" className="size-3.5" />],
                ] as const
              ).map(([type, label, icon]) => (
                <Button
                  key={type}
                  size="sm"
                  icon={icon}
                  disabled={draft.steps.length >= LIMITS.steps}
                  onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep(type, d.steps.map((s) => s.id))] }))}
                >
                  {label}
                </Button>
              ))}
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
                unit={paramUnits[p.name]}
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

  // Bytes, not text(): the parser rejects files that aren't UTF-8 instead of guessing.
  const loadSample = async (picked: Blob, name: string) => {
    try {
      const inferred = inferColumns(new Uint8Array(await picked.arrayBuffer()))
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
    await loadSample(sample, name)
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
          label="Drop a sample CSV or Excel file, or choose one"
          hint="Read in this browser to suggest columns; it is never uploaded"
          onFile={async (picked) => {
            setFile(picked)
            if (picked.size > LIMITS.fileBytes) {
              setError('The sample is larger than the 1 MiB limit.')
              return
            }
            await loadSample(picked, picked.name)
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
                        <option value="integer">Number (whole)</option>
                        <option value="date">Date</option>
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
            <option value="integer">Number (whole)</option>
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
            {note.reason} Recipes filter, group, summarize, sort and trim the rows of a file you upload; they can't join files, work with dates or send anything.
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

function columnOptions(available: Column[], current: string, want?: ColumnType[]) {
  const options = available.filter((c) => !want || want.includes(c.type))
  const missing = current && !available.some((c) => c.name === current)
  return { options, missing }
}

const NUMERIC: ColumnType[] = ['integer_inr', 'integer']
const TEXT: ColumnType[] = ['string']
const FIGURE_LABEL: Record<AggregateOp, string> = { count: 'Count rows', sum: 'Total of', avg: 'Average of', min: 'Smallest', max: 'Largest' }
const FIGURE_DEFAULT_NAME: Record<AggregateOp, string> = { count: 'rows', sum: 'total', avg: 'average', min: 'smallest', max: 'largest' }

/** Fields a step needs when it becomes another type (kept if already filled in). */
function switchType(step: DraftStep, type: StepType): Partial<DraftStep> {
  const fresh = newStep(type, [])
  return {
    type,
    as: type === 'group_sum' ? step.as || 'total' : type === 'date_part' ? step.as || 'month' : step.as,
    groupColumns: step.groupColumns.length ? step.groupColumns : fresh.groupColumns,
    measures: step.measures.length ? step.measures : fresh.measures,
    sortKeys: step.sortKeys.length ? step.sortKeys : fresh.sortKeys,
    literal: type === 'limit' && !/^\d+$/.test(step.literal.trim()) ? fresh.literal : step.literal,
    valueKind: type === 'limit' && step.valueKind === 'parameter' && !step.parameter ? 'literal' : step.valueKind,
  }
}

/** A text filter value that never occurs in the sample file (e.g. "Paid" vs "paid"), with a one-click fix. */
function filterMismatch(step: DraftStep, columnType: ColumnType | undefined, sampleValues?: string[]) {
  if (step.type !== 'filter' || columnType !== 'string' || !sampleValues?.length) return null
  if (step.operator === 'in') {
    const values = splitList(step.list)
    for (const value of values) {
      const found = literalMismatch(step.column, value, sampleValues)
      if (found) {
        const fixed = found.suggestion ? values.map((v) => (v === value ? found.suggestion! : v)).join(', ') : null
        return { message: found.message, suggestion: found.suggestion, apply: fixed !== null ? { list: fixed } : null }
      }
    }
    return null
  }
  if ((step.operator === 'eq' || step.operator === 'neq') && step.valueKind === 'literal') {
    const found = literalMismatch(step.column, step.literal.trim(), sampleValues)
    return found ? { message: found.message, suggestion: found.suggestion, apply: found.suggestion ? { literal: found.suggestion } : null } : null
  }
  return null
}

type MakeParameter = (defaultValue: string, type: 'integer' | 'string' | 'date', options?: { base?: string; min?: string }) => void

function StepCard({
  step,
  index,
  count,
  available,
  parameters,
  issues,
  aiDraft,
  definition,
  previousType,
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
  /** The step before this one, if any (a "keep first N" usually follows a sort). */
  previousType: StepType | null
  onChange: (patch: Partial<DraftStep>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onMakeParameter: MakeParameter
  /** Distinct values of this step's column in the sample file, if one was read. */
  sampleValues?: string[]
}) {
  const savedStep = definition?.steps[index]
  const preview = savedStep && issues.length === 0 ? describeStep(savedStep, available, definition!) : null
  // The model never sees data, so a text value can be valid yet never match (e.g. "Paid" vs "paid").
  const mismatch = filterMismatch(step, available.find((c) => c.name === step.column)?.type, sampleValues)
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
          wrapperClassName="w-44"
          onChange={(e) => onChange(switchType(step, e.target.value as StepType))}
        >
          {STEP_TYPES.map((type) => (
            <option key={type} value={type}>
              {STEP_LABEL[type]}
            </option>
          ))}
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
        {step.type === 'filter' && (
          <FilterBody step={step} available={available} parameters={parameters} onChange={onChange} onMakeParameter={onMakeParameter} />
        )}
        {step.type === 'group_sum' && (
          <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)] sm:items-center">
            <span className="text-[13px] text-muted">Group by</span>
            <ColumnSelect label="Group by" value={step.groupBy} available={available} want={TEXT} onChange={(groupBy) => onChange({ groupBy })} />
            <span className="text-[13px] text-muted">sum</span>
            <ColumnSelect label="Sum" value={step.valueColumn} available={available} want={['integer_inr']} onChange={(valueColumn) => onChange({ valueColumn })} />
            <span className="text-[13px] text-muted">as</span>
            <Input aria-label="New column name" value={step.as} className="font-mono text-[12.5px]" placeholder="total" onChange={(e) => onChange({ as: e.target.value })} />
            <p className="text-[12px] text-faint sm:col-span-6">After this step only the group-by column and the new total remain.</p>
          </div>
        )}
        {step.type === 'aggregate' && <AggregateBody step={step} available={available} onChange={onChange} />}
        {step.type === 'sort' && <SortBody step={step} available={available} onChange={onChange} />}
        {step.type === 'limit' && (
          <LimitBody step={step} parameters={parameters} previousType={previousType} onChange={onChange} onMakeParameter={onMakeParameter} />
        )}
        {step.type === 'select' && <SelectBody step={step} available={available} onChange={onChange} />}
        {step.type === 'date_part' && <DatePartBody step={step} available={available} onChange={onChange} />}

        {mismatch && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink" role="status">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">In your sample file, {mismatch.message}</span>
            {mismatch.apply && (
              <Button size="sm" onClick={() => onChange(mismatch.apply!)}>
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

/** "Fixed value" / "Parameter" (/ "Relative to run day" for dates) switch shared by filters and "keep first N". */
function ValueKindToggle({ value, relative, onChange }: { value: DraftStep['valueKind']; relative?: boolean; onChange: (kind: DraftStep['valueKind']) => void }) {
  const kinds: Array<[DraftStep['valueKind'], string]> = [['literal', relative ? 'Fixed date' : 'Fixed value'], ['parameter', 'Parameter']]
  if (relative) kinds.push(['relative', 'Relative to run day'])
  return (
    <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {kinds.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          onClick={() => onChange(kind)}
          aria-pressed={value === kind}
          className={cn('rounded-md px-2 py-0.5 font-medium', value === kind ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function ParameterSelect({ value, parameters, type, onChange }: { value: string; parameters: DraftParam[]; type: DraftParam['type'] | null; onChange: (name: string) => void }) {
  const matching = parameters.filter((p) => !type || p.type === type)
  return (
    <Select aria-label="Parameter" value={value} wrapperClassName="min-w-0 flex-1" className="font-mono text-[12.5px]" onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {matching.map((p) => (
        <option key={p.key} value={p.name}>
          {p.name}
        </option>
      ))}
      {value && !parameters.some((p) => p.name === value) && <option value={value}>{value} (not declared)</option>}
    </Select>
  )
}

/** The relative date a filter draft describes (a half-typed offset counts as 0). */
function relativeOf(step: DraftStep) {
  const offset = Number(step.relativeOffset)
  return { unit: step.relativeUnit, offset: Number.isInteger(offset) ? offset : 0, edge: step.relativeEdge }
}

/** "[start of] [this | last | next | N ago | N from now] [month]" for a date filter. */
function RelativeDateFields({ step, onChange }: { step: DraftStep; onChange: (patch: Partial<DraftStep>) => void }) {
  const raw = step.relativeOffset.trim()
  const n = Number(raw)
  const when = raw === '-' ? 'ago' : raw === '' || n === 0 ? 'this' : n === -1 ? 'last' : n === 1 ? 'next' : n < 0 ? 'ago' : 'ahead'
  const many = when === 'ago' || when === 'ahead'
  const count = raw.replace('-', '')
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {step.relativeUnit !== 'day' && (
        <Select aria-label="Start or end" value={step.relativeEdge} className="text-[13px]" wrapperClassName="w-24 shrink-0" onChange={(e) => onChange({ relativeEdge: e.target.value as 'start' | 'end' })}>
          <option value="start">start of</option>
          <option value="end">end of</option>
        </Select>
      )}
      <Select
        aria-label="Which"
        value={when}
        className="text-[13px]"
        wrapperClassName="w-28 shrink-0"
        onChange={(e) => {
          const w = e.target.value
          const size = Math.max(2, Math.abs(n) || 0)
          onChange({ relativeOffset: w === 'this' ? '0' : w === 'last' ? '-1' : w === 'next' ? '1' : w === 'ago' ? String(-size) : String(size) })
        }}
      >
        <option value="this">this</option>
        <option value="last">last</option>
        <option value="next">next</option>
        <option value="ago">… ago</option>
        <option value="ahead">… from now</option>
      </Select>
      {many && (
        <div className="w-16 shrink-0">
          <Input
            aria-label="How many"
            inputMode="numeric"
            value={count}
            className="text-[13px]"
            onChange={(e) => onChange({ relativeOffset: (when === 'ago' ? '-' : '') + e.target.value.replace(/\D/g, '') })}
          />
        </div>
      )}
      <Select aria-label="Unit" value={step.relativeUnit} className="text-[13px]" wrapperClassName="w-28 shrink-0" onChange={(e) => onChange({ relativeUnit: e.target.value as DateUnit })}>
        {DATE_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
            {many ? 's' : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}

function FilterBody({
  step,
  available,
  parameters,
  onChange,
  onMakeParameter,
}: {
  step: DraftStep
  available: Column[]
  parameters: DraftParam[]
  onChange: (patch: Partial<DraftStep>) => void
  onMakeParameter: MakeParameter
}) {
  const columnType = available.find((c) => c.name === step.column)?.type
  const isAmount = columnType === 'integer_inr'
  const numeric = isNumericType(columnType)
  const isDate = isDateType(columnType)
  const ordered = numeric || isDate
  const operators = OPERATORS.filter((op) => (columnType === undefined ? true : ordered ? !TEXT_ONLY_OPERATORS.has(op) : !NUMERIC_ONLY_OPERATORS.has(op)))
  const phrases = isDate ? DATE_OPERATOR_PHRASE : OPERATOR_PHRASE
  const isList = step.operator === 'in'
  // "Relative to run day" only exists for dates; a draft that switched column falls back to a fixed value.
  const kind: DraftStep['valueKind'] = step.valueKind === 'relative' && !isDate ? 'literal' : step.valueKind
  const relative = kind === 'relative' ? relativeOf(step) : null
  return (
    <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
      <span className="text-[13px] text-muted">Keep rows where</span>
      <ColumnSelect
        label="Column"
        value={step.column}
        available={available}
        onChange={(column) => {
          const t = available.find((c) => c.name === column)?.type
          const incompatible = isNumericType(t) || isDateType(t) ? TEXT_ONLY_OPERATORS.has(step.operator) : NUMERIC_ONLY_OPERATORS.has(step.operator)
          onChange({ column, operator: incompatible ? 'eq' : step.operator, valueKind: step.valueKind === 'relative' && !isDateType(t) ? 'literal' : step.valueKind })
        }}
      />
      <Select aria-label="Comparison" value={step.operator} className="text-[13px]" onChange={(e) => onChange({ operator: e.target.value as Operator })}>
        {operators.map((op) => (
          <option key={op} value={op}>
            {phrases[op]}
          </option>
        ))}
      </Select>
      <div className="flex min-w-0 items-center gap-1.5">
        {isList ? (
          <Input aria-label="Values" value={step.list} placeholder="e.g. North, South" className="text-[13px]" onChange={(e) => onChange({ list: e.target.value })} />
        ) : kind === 'relative' ? (
          <RelativeDateFields step={step} onChange={onChange} />
        ) : kind === 'literal' ? (
          <div className="relative min-w-0 flex-1">
            {isAmount && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-faint">₹</span>}
            <Input
              aria-label="Value"
              type={isDate ? 'date' : undefined}
              value={step.literal}
              inputMode={numeric ? 'numeric' : undefined}
              placeholder={isAmount ? '100000' : numeric ? '10' : isDate ? 'YYYY-MM-DD' : 'e.g. paid'}
              className={cn('text-[13px]', isAmount && 'pl-6')}
              onChange={(e) => onChange({ literal: e.target.value })}
            />
          </div>
        ) : (
          <ParameterSelect
            value={step.parameter}
            parameters={parameters}
            type={numeric ? 'integer' : isDate ? 'date' : columnType === 'string' ? 'string' : null}
            onChange={(parameter) => onChange({ parameter })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] sm:col-span-4 sm:col-start-2">
        {!isList && <ValueKindToggle value={kind} relative={isDate} onChange={(valueKind) => onChange({ valueKind })} />}
        {!isList && kind === 'literal' && columnType && (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
            onClick={() => onMakeParameter(numeric ? step.literal.replace(/\D/g, '') : step.literal, numeric ? 'integer' : isDate ? 'date' : 'string')}
          >
            <SlidersHorizontal className="size-3" /> Make adjustable
          </button>
        )}
        {!isList && kind === 'literal' && numeric && /^\d+$/.test(step.literal.trim()) && (
          <span className="tabular text-faint">= {isAmount ? formatINR(Number(step.literal)) : formatCount(Number(step.literal))}</span>
        )}
        {!isList && kind === 'literal' && isDate && isIsoDate(step.literal.trim()) && <span className="tabular text-faint">= {formatDate(step.literal.trim())}</span>}
        {relative && (
          <span className="text-faint">
            {describeRelative(relative)} · run today, that is {formatDate(relativeDate(todayIso(), relative))}
          </span>
        )}
        {columnType === 'string' && (
          <span className="text-faint">
            {step.operator === 'contains' ? 'Ignores capitals' : isList ? 'Exact matches, separated by commas' : 'Exact, case-sensitive match'}
          </span>
        )}
      </div>
    </div>
  )
}

const PART_EXAMPLE: Record<DatePart, string> = { year: '2026', quarter: '2026-Q3', month: '2026-09', week: '2026-W39' }

function DatePartBody({ step, available, onChange }: { step: DraftStep; available: Column[]; onChange: (patch: Partial<DraftStep>) => void }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,0.7fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)] sm:items-center">
      <span className="text-[13px] text-muted">Add the</span>
      <Select aria-label="Period" value={step.part} className="text-[13px]" onChange={(e) => onChange({ part: e.target.value as DatePart })}>
        {DATE_PARTS.map((part) => (
          <option key={part} value={part}>
            {PART_PHRASE[part]}
          </option>
        ))}
      </Select>
      <span className="text-[13px] text-muted">of</span>
      <ColumnSelect label="Date column" value={step.column} available={available} want={['date']} onChange={(column) => onChange({ column })} />
      <span className="text-[13px] text-muted">as</span>
      <Input aria-label="New column name" value={step.as} className="font-mono text-[12.5px]" placeholder="month" onChange={(e) => onChange({ as: e.target.value })} />
      <p className="text-[12px] text-faint sm:col-span-6">
        Adds a text column like <span className="font-mono">{PART_EXAMPLE[step.part]}</span> beside the others, in calendar order; group by it in a summary step.
      </p>
    </div>
  )
}

function AggregateBody({ step, available, onChange }: { step: DraftStep; available: Column[]; onChange: (patch: Partial<DraftStep>) => void }) {
  const setGroup = (g: number, value: string) => onChange({ groupColumns: step.groupColumns.map((c, i) => (i === g ? value : c)) })
  const setMeasure = (key: string, patch: Partial<DraftMeasure>) =>
    onChange({ measures: step.measures.map((m) => (m.key === key ? { ...m, ...patch } : m)) })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">Group by</span>
        {step.groupColumns.map((column, g) => (
          <div key={g} className="flex items-center gap-1">
            <ColumnSelect label={`Group by column ${g + 1}`} value={column} available={available} want={['string', 'integer']} onChange={(value) => setGroup(g, value)} />
            <IconBtn label={`Remove group-by column ${g + 1}`} onClick={() => onChange({ groupColumns: step.groupColumns.filter((_, i) => i !== g) })}>
              <X className="size-3.5" />
            </IconBtn>
          </div>
        ))}
        {step.groupColumns.length < LIMITS.groupColumns && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ groupColumns: [...step.groupColumns, ''] })}>
            Column
          </Button>
        )}
        {step.groupColumns.length === 0 && <span className="text-[12px] text-faint">None: one summary row for all rows</span>}
      </div>
      <div className="space-y-2">
        {step.measures.map((m, j) => (
          <div key={m.key} className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto_minmax(0,0.8fr)_auto] sm:items-center">
            <Select
              aria-label={`Figure ${j + 1}`}
              value={m.op}
              className="text-[13px]"
              onChange={(e) => {
                const op = e.target.value as AggregateOp
                // Keep a name the author typed; otherwise follow the figure.
                const named = Object.values(FIGURE_DEFAULT_NAME).includes(m.as) || m.as === ''
                setMeasure(m.key, { op, as: named ? FIGURE_DEFAULT_NAME[op] : m.as, column: op === 'count' ? '' : m.column })
              }}
            >
              {AGGREGATE_OPS.map((op) => (
                <option key={op} value={op}>
                  {FIGURE_LABEL[op]}
                </option>
              ))}
            </Select>
            {m.op === 'count' ? (
              <span className="text-[12.5px] text-faint">every row in the group</span>
            ) : (
              <ColumnSelect label={`Column for figure ${j + 1}`} value={m.column} available={available} want={NUMERIC} onChange={(column) => setMeasure(m.key, { column })} />
            )}
            <span className="text-[13px] text-muted">as</span>
            <Input aria-label={`Name of figure ${j + 1}`} value={m.as} className="font-mono text-[12.5px]" onChange={(e) => setMeasure(m.key, { as: e.target.value })} />
            <IconBtn label={`Remove figure ${j + 1}`} disabled={step.measures.length <= 1} onClick={() => onChange({ measures: step.measures.filter((x) => x.key !== m.key) })}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        ))}
        {step.measures.length < LIMITS.measures && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ measures: [...step.measures, newMeasure('count', 'rows')] })}>
            Add a figure
          </Button>
        )}
      </div>
      <p className="text-[12px] text-faint">
        After this step only the group-by columns and these figures remain. Averages are rounded to the nearest whole number.
      </p>
    </div>
  )
}

function SortBody({ step, available, onChange }: { step: DraftStep; available: Column[]; onChange: (patch: Partial<DraftStep>) => void }) {
  const setKey = (key: string, patch: Partial<DraftSortKey>) => onChange({ sortKeys: step.sortKeys.map((k) => (k.key === key ? { ...k, ...patch } : k)) })
  return (
    <div className="space-y-2">
      {step.sortKeys.map((k, j) => {
        const numeric = isNumericType(available.find((c) => c.name === k.column)?.type)
        return (
          <div key={k.key} className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-[13px] text-muted">{j === 0 ? 'Sort by' : 'then by'}</span>
            <div className="min-w-40 flex-1">
              <ColumnSelect label={`Sort column ${j + 1}`} value={k.column} available={available} onChange={(column) => setKey(k.key, { column })} />
            </div>
            <Select aria-label={`Order ${j + 1}`} value={k.direction} wrapperClassName="w-36" className="text-[13px]" onChange={(e) => setKey(k.key, { direction: e.target.value as 'asc' | 'desc' })}>
              <option value="desc">{numeric ? 'Highest first' : 'Z → A'}</option>
              <option value="asc">{numeric ? 'Lowest first' : 'A → Z'}</option>
            </Select>
            <IconBtn label={`Remove sort column ${j + 1}`} disabled={step.sortKeys.length <= 1} onClick={() => onChange({ sortKeys: step.sortKeys.filter((x) => x.key !== k.key) })}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        )
      })}
      {step.sortKeys.length < LIMITS.sortKeys && (
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ sortKeys: [...step.sortKeys, newSortKey()] })}>
          Then by another column
        </Button>
      )}
    </div>
  )
}

function LimitBody({
  step,
  parameters,
  previousType,
  onChange,
  onMakeParameter,
}: {
  step: DraftStep
  parameters: DraftParam[]
  previousType: StepType | null
  onChange: (patch: Partial<DraftStep>) => void
  onMakeParameter: MakeParameter
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">Keep the first</span>
        {step.valueKind === 'literal' ? (
          <div className="w-24">
            <Input aria-label="Number of rows" value={step.literal} inputMode="numeric" className="text-[13px]" onChange={(e) => onChange({ literal: e.target.value })} />
          </div>
        ) : (
          <div className="w-44">
            <ParameterSelect value={step.parameter} parameters={parameters} type="integer" onChange={(parameter) => onChange({ parameter })} />
          </div>
        )}
        <span className="text-[13px] text-muted">rows</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <ValueKindToggle value={step.valueKind} onChange={(valueKind) => onChange({ valueKind })} />
        {step.valueKind === 'literal' && (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
            onClick={() => onMakeParameter(step.literal.replace(/\D/g, '') || '10', 'integer', { base: 'top_n', min: '1' })}
          >
            <SlidersHorizontal className="size-3" /> Make adjustable
          </button>
        )}
        {previousType !== 'sort' && <span className="text-faint">Tip: put a Sort step just before this one to keep the top rows.</span>}
      </div>
    </div>
  )
}

function SelectBody({ step, available, onChange }: { step: DraftStep; available: Column[]; onChange: (patch: Partial<DraftStep>) => void }) {
  const setPick = (key: string, patch: Partial<DraftPick>) => onChange({ picks: step.picks.map((p) => (p.key === key ? { ...p, ...patch } : p)) })
  const move = (j: number, dir: -1 | 1) => {
    const picks = [...step.picks]
    const k = j + dir
    if (k < 0 || k >= picks.length) return
    ;[picks[j], picks[k]] = [picks[k]!, picks[j]!]
    onChange({ picks })
  }
  return (
    <div className="space-y-2">
      {step.picks.length === 0 && <p className="text-[12.5px] text-muted">Choose the columns to keep, in the order you want them.</p>}
      {step.picks.map((p, j) => (
        <div key={p.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center">
          <ColumnSelect label={`Column ${j + 1}`} value={p.column} available={available} onChange={(column) => setPick(p.key, { column })} />
          <span className="text-[13px] text-muted">shown as</span>
          <Input aria-label={`Header for column ${j + 1}`} value={p.as} placeholder={p.column || 'same name'} className="text-[13px]" onChange={(e) => setPick(p.key, { as: e.target.value })} />
          <div className="flex items-center gap-0.5">
            <IconBtn label={`Move column ${j + 1} up`} disabled={j === 0} onClick={() => move(j, -1)}>
              <ArrowUp className="size-3.5" />
            </IconBtn>
            <IconBtn label={`Move column ${j + 1} down`} disabled={j === step.picks.length - 1} onClick={() => move(j, 1)}>
              <ArrowDown className="size-3.5" />
            </IconBtn>
            <IconBtn label={`Remove column ${j + 1}`} danger onClick={() => onChange({ picks: step.picks.filter((x) => x.key !== p.key) })}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {step.picks.length < LIMITS.columns && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ picks: [...step.picks, newPick()] })}>
            Add a column
          </Button>
        )}
        {available.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ picks: available.map((c) => newPick(c.name)) })}>
            Keep all {available.length}
          </Button>
        )}
      </div>
      <p className="text-[12px] text-faint">Only these columns reach the result and the CSV download. Headers can use spaces and capitals.</p>
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
  want?: ColumnType[]
  onChange: (value: string) => void
}) {
  const { options, missing } = columnOptions(available, value, want)
  return (
    <Select aria-label={label} value={value} className="font-mono text-[12.5px]" onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a column…</option>
      {options.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name} · {c.type === 'integer_inr' ? '₹' : c.type === 'integer' ? '#' : 'text'}
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
  unit,
  issues,
  used,
  onChange,
  onRemove,
}: {
  param: DraftParam
  /** How an integer parameter reads (rupees or a plain number), from how steps use it. */
  unit: ParameterUnit | undefined
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
            <option value="date">Date</option>
          </Select>
        </Field>
        <Field label="Default" htmlFor={`p-default-${param.key}`}>
          <Input
            id={`p-default-${param.key}`}
            type={param.type === 'date' ? 'date' : undefined}
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
        ) : param.type === 'date' ? (
          <div className="sm:col-span-2 text-[12px] text-muted sm:pb-2.5">A calendar date; each run can choose another</div>
        ) : (
          <div className="sm:col-span-2 text-[12px] text-muted sm:pb-2.5">Up to {LIMITS.textMax} characters</div>
        )}
        <IconBtn label={`Remove parameter ${param.name}`} danger onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconBtn>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {param.type === 'integer' && /^\d+$/.test(param.default) && (
          <span className="tabular text-muted">Default {formatParameterValue(Number(param.default), unit)}</span>
        )}
        {param.type === 'date' && isIsoDate(param.default.trim()) && <span className="tabular text-muted">Default {formatDate(param.default.trim())}</span>}
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
              {i + 1}. {STEP_LABEL[step?.type ?? 'filter']}
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
        <TypeIcon className="size-3.5" /> Column types: {COLUMN_TYPE_LABEL.string} (<code>string</code>), {COLUMN_TYPE_LABEL.integer_inr} (<code>integer_inr</code>), {COLUMN_TYPE_LABEL.integer} (<code>integer</code>) and {COLUMN_TYPE_LABEL.date} (<code>date</code>).
      </p>
    </Dialog>
  )
}
