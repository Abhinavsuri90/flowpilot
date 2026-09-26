import * as React from 'react'
import { cn } from '../ui'

// Architecture: two paths that share only the dispatcher, the access policy and
// the validator. The model provider is never on the execution path.

export type PathView = 'both' | 'authoring' | 'execution'
type Path = 'authoring' | 'execution' | 'shared'

type Box = { id: string; x: number; y: number; w: number; h: number; title: string; sub: string[]; path: Path }

const BOXES: Box[] = [
  { id: 'editor', x: 26, y: 78, w: 168, h: 56, title: 'Recipe editor', sub: ['step cards'], path: 'authoring' },
  { id: 'library', x: 26, y: 196, w: 168, h: 56, title: 'Library, detail', sub: ['TanStack Query cache'], path: 'shared' },
  { id: 'runpanel', x: 26, y: 314, w: 168, h: 56, title: 'Run panel', sub: ['file + parameters'], path: 'execution' },
  { id: 'dispatcher', x: 244, y: 78, w: 112, h: 292, title: 'API dispatcher', sub: ['origin · session', 'errors'], path: 'shared' },
  { id: 'ai', x: 392, y: 78, w: 150, h: 56, title: 'AI author', sub: ['columns, never rows'], path: 'authoring' },
  { id: 'policy', x: 392, y: 196, w: 150, h: 56, title: 'Access policy', sub: ['role + visibility'], path: 'shared' },
  { id: 'validator', x: 578, y: 196, w: 146, h: 56, title: 'Validator', sub: ['strict schema'], path: 'shared' },
  { id: 'csv', x: 392, y: 314, w: 150, h: 56, title: 'CSV parser', sub: ['limits, typed amounts'], path: 'execution' },
  { id: 'engine', x: 578, y: 314, w: 146, h: 56, title: 'Engine', sub: ['6 allowlisted steps'], path: 'execution' },
  { id: 'model', x: 812, y: 72, w: 164, h: 68, title: 'Model provider', sub: ['Anthropic · OpenAI', 'or OpenRouter'], path: 'authoring' },
  { id: 'db', x: 812, y: 190, w: 164, h: 78, title: 'Database', sub: ['versions immutable', 'runs private'], path: 'shared' },
]

type Edge = { d: string; path: Path; label?: { x: number; y: number; text: string } }

const EDGES: Edge[] = [
  { d: 'M194 106 H240', path: 'authoring' },
  { d: 'M194 224 H240', path: 'shared' },
  { d: 'M194 342 H240', path: 'execution' },
  { d: 'M356 106 H388', path: 'authoring' },
  { d: 'M356 224 H388', path: 'shared' },
  { d: 'M542 224 H574', path: 'shared' },
  { d: 'M542 100 H808', path: 'authoring', label: { x: 676, y: 92, text: 'draft request (no rows)' } },
  { d: 'M467 134 V162 H651 V192', path: 'authoring', label: { x: 560, y: 155, text: 'validate draft' } },
  { d: 'M724 216 H808', path: 'authoring', label: { x: 766, y: 208, text: 'save version' } },
  { d: 'M651 252 V284 H467 V310', path: 'execution', label: { x: 560, y: 277, text: 're-check stored version' } },
  { d: 'M542 342 H574', path: 'execution' },
  { d: 'M724 342 H894 V272', path: 'execution', label: { x: 790, y: 334, text: 'run record' } },
]

const COLOR: Record<Path, string> = { authoring: 'var(--ai)', execution: 'var(--flow)', shared: 'var(--faint)' }

function active(path: Path, view: PathView): boolean {
  return view === 'both' || path === 'shared' || path === view
}

export function ArchitectureDiagram({ view }: { view: PathView }) {
  const id = React.useId().replace(/:/g, '')
  return (
    <div className="scrollbar-thin relative overflow-x-auto">
      <svg viewBox="0 0 1000 420" className="min-w-[760px]" role="img" aria-label="Architecture: the authoring path and the execution path share only the API dispatcher, the access policy and the validator">
        <defs>
          {(['authoring', 'execution', 'shared'] as const).map((p) => (
            <marker key={p} id={`${id}-${p}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={COLOR[p]} />
            </marker>
          ))}
        </defs>

        {/* Swimlanes */}
        {[
          { x: 12, w: 196, title: 'Browser' },
          { x: 228, w: 552, title: 'TanStack Start server' },
          { x: 800, w: 188, title: 'Services' },
        ].map((lane) => (
          <g key={lane.title}>
            <rect x={lane.x} y={16} width={lane.w} height={388} rx={16} fill="var(--sunken)" stroke="var(--line)" />
            <text x={lane.x + 16} y={44} className="fill-[var(--muted)] text-[12.5px] font-medium">
              {lane.title}
            </text>
          </g>
        ))}

        {/* Edges */}
        {EDGES.map((e, i) => {
          const on = active(e.path, view)
          return (
            <g key={i} opacity={on ? 1 : 0.14} style={{ transition: 'opacity 200ms' }}>
              <path d={e.d} fill="none" stroke={COLOR[e.path]} strokeWidth={2} strokeLinejoin="round" markerEnd={`url(#${id}-${e.path})`} />
              {e.label && (
                <text x={e.label.x} y={e.label.y} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                  {e.label.text}
                </text>
              )}
            </g>
          )
        })}

        {/* Boxes */}
        {BOXES.map((b) => {
          const on = active(b.path, view)
          const accent = b.path === 'shared' ? 'var(--line-strong)' : COLOR[b.path]
          return (
            <g key={b.id} opacity={on ? 1 : 0.28} style={{ transition: 'opacity 200ms' }}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill="var(--surface)" stroke={accent} strokeWidth={b.path === 'shared' ? 1 : 1.5} />
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 - (b.sub.length > 1 ? 11 : 4)} textAnchor="middle" className="fill-[var(--ink)] text-[13.5px] font-semibold">
                {b.title}
              </text>
              {b.sub.map((line, i) => (
                <text key={line} x={b.x + b.w / 2} y={b.y + b.h / 2 + (b.sub.length > 1 ? 8 : 14) + i * 15} textAnchor="middle" className="fill-[var(--muted)] text-[11.5px]">
                  {line}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function PathLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-muted', className)}>
      <span className="inline-flex items-center gap-2">
        <span className="h-0.5 w-6 rounded-full bg-[var(--ai)]" /> Authoring path (AI drafts, you save)
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-0.5 w-6 rounded-full bg-[var(--flow)]" /> Execution path (no AI)
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-0.5 w-6 rounded-full bg-[var(--faint)]" /> Shared by both
      </span>
    </div>
  )
}
