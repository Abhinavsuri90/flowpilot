import * as React from 'react'

// Versions, runs and forks, drawn with the demo scenario: saving appends a
// version, runs pin the version they executed, and a copy points back at one
// source version while evolving on its own.

type Box = { x: number; y: number; w: number; h: number; title: string; sub: string; kind: 'recipe' | 'version'; current?: boolean }

const BOXES: Box[] = [
  { x: 20, y: 30, w: 200, h: 54, title: 'Asha’s recipe', sub: 'team · owner Asha', kind: 'recipe' },
  { x: 280, y: 30, w: 140, h: 54, title: 'v1', sub: 'by region', kind: 'version' },
  { x: 480, y: 30, w: 170, h: 54, title: 'v2', sub: 'threshold 80,000', kind: 'version', current: true },
  { x: 20, y: 236, w: 200, h: 54, title: 'Vikram’s copy', sub: 'private · owner Vikram', kind: 'recipe' },
  { x: 280, y: 236, w: 140, h: 54, title: 'v1', sub: 'copied from Asha’s v1', kind: 'version' },
  { x: 480, y: 236, w: 170, h: 54, title: 'v2', sub: 'by sales_rep', kind: 'version', current: true },
]

const RUNS = [
  { x: 440, label: 'Asha · file A · 2 rows', to: { x: 405, y: 84 } },
  { x: 610, label: 'Vikram · file B · 2 rows', to: { x: 415, y: 84 } },
  { x: 780, label: 'Asha · file A · 1 row', to: { x: 600, y: 84 } },
]

export function VersioningDiagram() {
  const id = React.useId().replace(/:/g, '')
  return (
    <div className="scrollbar-thin relative overflow-x-auto">
      <svg viewBox="0 0 960 310" className="min-w-[720px]" role="img" aria-label="Asha's recipe has v1 and v2; runs point at the version they executed; Vikram's private copy was forked from Asha's v1 and has its own v2 grouped by sales_rep">
        <defs>
          <marker id={`${id}-gray`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--faint)" />
          </marker>
          <marker id={`${id}-flow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--flow)" />
          </marker>
          <marker id={`${id}-brand`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--brand)" />
          </marker>
        </defs>

        {/* recipe → v1 → v2, for both recipes */}
        {[57, 263].map((y) => (
          <g key={y}>
            <path d={`M220 ${y} H276`} stroke="var(--faint)" strokeWidth={1.5} fill="none" markerEnd={`url(#${id}-gray)`} />
            <path d={`M420 ${y} H476`} stroke="var(--faint)" strokeWidth={1.5} fill="none" markerEnd={`url(#${id}-gray)`} />
          </g>
        ))}

        {/* The copy's v1 points back at exactly one source version */}
        <path d="M350 236 V88" stroke="var(--brand)" strokeWidth={2} fill="none" markerEnd={`url(#${id}-brand)`} />
        <text x={342} y={168} textAnchor="end" className="fill-[var(--brand-ink)] font-mono text-[11.5px]">
          forked_from_version_id
        </text>

        {/* Runs pin the version they executed */}
        {RUNS.map((r) => (
          <g key={r.label}>
            <path d={`M${r.x + 80} 128 L${r.to.x} ${r.to.y + 4}`} stroke="var(--flow)" strokeWidth={1.5} fill="none" markerEnd={`url(#${id}-flow)`} />
            <rect x={r.x} y={128} width={160} height={28} rx={14} fill="var(--flow-soft)" stroke="var(--flow)" strokeOpacity={0.5} />
            <text x={r.x + 80} y={146} textAnchor="middle" className="fill-[var(--ink-2)] text-[11.5px]">
              {r.label}
            </text>
          </g>
        ))}
        <text x={440} y={184} className="fill-[var(--muted)] text-[11.5px]">
          Each run stores the version it executed and is private to whoever ran it.
        </text>

        {BOXES.map((b, i) => (
          <g key={i}>
            {b.current && (
              <g>
                <rect x={b.x + b.w / 2 - 30} y={b.y - 22} width={60} height={18} rx={9} fill="var(--brand-soft)" />
                <text x={b.x + b.w / 2} y={b.y - 9} textAnchor="middle" className="fill-[var(--brand-ink)] text-[10.5px] font-semibold">
                  current
                </text>
              </g>
            )}
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={12}
              fill={b.kind === 'recipe' ? 'var(--sunken)' : 'var(--surface)'}
              stroke={b.current ? 'var(--brand)' : 'var(--line-strong)'}
              strokeWidth={b.current ? 1.5 : 1}
            />
            <text x={b.x + b.w / 2} y={b.y + 23} textAnchor="middle" className="fill-[var(--ink)] text-[13px] font-semibold">
              {b.title}
            </text>
            <text x={b.x + b.w / 2} y={b.y + 41} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
              {b.sub}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
