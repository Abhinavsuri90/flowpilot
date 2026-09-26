import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import { Segmented, cn } from '../ui'

// Step-by-step flows as an ordered list of cards: readable by screen readers,
// and they wrap on narrow screens instead of shrinking into an unreadable picture.

export type FlowStep = { title: string; lines: string[]; tag?: string }

export function FlowDiagram({ steps, label, tone = 'brand' }: { steps: FlowStep[]; label: string; tone?: 'brand' | 'flow' | 'ai' }) {
  const accent = tone === 'flow' ? 'border-flow/35 bg-flow-soft/40' : tone === 'ai' ? 'border-ai/35 bg-ai-soft/40' : 'border-brand/30 bg-brand-soft/40'
  const number = tone === 'flow' ? 'bg-flow text-white' : tone === 'ai' ? 'bg-ai text-white' : 'bg-brand text-white'
  return (
    <ol aria-label={label} className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col lg:min-w-0 lg:flex-1 lg:flex-row lg:items-center">
          <div className={cn('flex h-full flex-col rounded-xl border px-3.5 py-3', accent)}>
            <div className="flex items-center gap-2">
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold', number)}>{i + 1}</span>
              <span className="text-[13px] font-semibold text-ink">{step.title}</span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {step.lines.map((line) => (
                <li key={line} className="text-[12px] leading-snug text-muted">
                  {line}
                </li>
              ))}
            </ul>
            {step.tag && <span className="mt-2 self-start rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 ring-1 ring-line">{step.tag}</span>}
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="mx-auto my-0.5 size-4 shrink-0 rotate-90 text-faint lg:mx-1 lg:my-0 lg:rotate-0" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  )
}

/** Several named flows behind a switch (e.g. sign-up / invite / reset). */
export function FlowSwitcher<T extends string>({ flows, label }: { flows: Array<{ value: T; label: string; steps: FlowStep[]; note?: string }>; label: string }) {
  const [current, setCurrent] = React.useState<T>(flows[0]!.value)
  const flow = flows.find((f) => f.value === current) ?? flows[0]!
  return (
    <div className="space-y-4">
      <Segmented label={label} value={current} onChange={setCurrent} items={flows.map((f) => ({ value: f.value, label: f.label }))} />
      <FlowDiagram steps={flow.steps} label={`${flow.label}, step by step`} />
      {flow.note && <p className="text-[12.5px] text-muted">{flow.note}</p>}
    </div>
  )
}
