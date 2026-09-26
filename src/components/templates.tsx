import * as React from 'react'
import { ArrowRight, FileSpreadsheet, LayoutTemplate } from 'lucide-react'
import { describeRecipe } from '~/lib/workflow/describe'
import { TEMPLATES, TEMPLATE_TAGS, type Template } from '~/lib/workflow/templates'
import { Badge, Button, cn } from './ui'
import { StepIcon } from './workflow-bits'

/** Starting points for a new recipe: pick one, then adjust it in the editor. */
export function TemplateGallery({ onPick, picked }: { onPick: (template: Template) => void; picked: Template | null }) {
  const [tag, setTag] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(true)
  const shown = TEMPLATES.filter((t) => !tag || t.tags.includes(tag))

  return (
    <section aria-labelledby="templates-heading" className="mb-6 rounded-2xl border border-line bg-surface-2 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="templates-heading" className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <LayoutTemplate className="size-4 text-brand" aria-hidden />
          {picked ? (
            <>
              Started from <span className="text-brand-ink">“{picked.title}”</span>
            </>
          ) : (
            'Start from a template'
          )}
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          {!picked && open && (
            <div className="scrollbar-thin flex max-w-[60vw] gap-1 overflow-x-auto" role="group" aria-label="Filter templates">
              {[null, ...TEMPLATE_TAGS].map((t) => (
                <button
                  key={t ?? 'all'}
                  type="button"
                  aria-pressed={tag === t}
                  onClick={() => setTag(t)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] font-medium',
                    tag === t ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:text-ink',
                  )}
                >
                  {t ?? 'All'}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="templates-grid">
            {open ? 'Hide templates' : picked ? 'Choose another template' : `Show templates (${TEMPLATES.length})`}
          </Button>
        </div>
      </div>

      {open && (
        <div id="templates-grid" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((template) => (
            <TemplateCard key={template.key} template={template} active={picked?.key === template.key} onPick={() => onPick(template)} />
          ))}
        </div>
      )}
      {!open && !picked && <p className="mt-1 text-[12.5px] text-muted">Or declare your columns below and describe the report in your own words.</p>}
    </section>
  )
}

function TemplateCard({ template, active, onPick }: { template: Template; active: boolean; onPick: () => void }) {
  const lines = describeRecipe(template.definition)
  const parameters = Object.keys(template.definition.parameters)
  return (
    // min-w-0: a grid item may not shrink below its longest (truncated) step line otherwise, which widens the page on phones.
    <article className={cn('flex min-w-0 flex-col rounded-xl border bg-surface p-4 transition-colors', active ? 'border-brand' : 'border-line hover:border-line-strong')}>
      <div className="flex flex-wrap gap-1">
        {template.tags.map((t) => (
          <Badge key={t} tone={t === 'Dates' ? 'flow' : t === 'Adjustable' ? 'ai' : 'neutral'}>
            {t}
          </Badge>
        ))}
      </div>
      <h3 className="mt-2 text-[14px] font-semibold text-ink">{template.title}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{template.description}</p>
      <ol className="mt-3 space-y-1 text-[12px] text-ink-2" aria-label={`Steps of ${template.title}`}>
        {template.definition.steps.slice(0, 3).map((step, i) => (
          <li key={step.id} className="flex items-start gap-1.5">
            <StepIcon type={step.type} className="mt-[2px] size-3.5 shrink-0 text-faint" />
            <span className="min-w-0 truncate">{lines[i]}</span>
          </li>
        ))}
        {template.definition.steps.length > 3 && <li className="text-faint">+ {template.definition.steps.length - 3} more</li>}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
        <span className="inline-flex items-center gap-1">
          <FileSpreadsheet className="size-3.5" aria-hidden /> {template.sample}
        </span>
        {parameters.length > 0 && <span>{parameters.length === 1 ? '1 adjustable value' : `${parameters.length} adjustable values`}</span>}
      </div>
      <div className="mt-auto pt-3">
        <Button size="sm" variant={active ? 'secondary' : 'brand'} className="w-full" onClick={onPick} icon={<ArrowRight className="size-3.5" />}>
          {active ? 'Load again' : 'Use this template'}
        </Button>
      </div>
    </article>
  )
}
