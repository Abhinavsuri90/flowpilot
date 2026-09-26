import * as React from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from './ui'

// 14-day run chart: stacked columns (succeeded = brand, failed = #e5484d),
// colours validated in both themes with the dataviz palette checks.
// Specs: <=24px columns, 4px rounded caps square at the baseline, 2px surface
// gap between segments, hairline grid, legend always shown, hover/focus
// tooltip per day, and a table view so nothing is hover-only.

export type DayCount = { date: string; succeeded: number; failed: number }

const HEIGHT = 208
const M = { top: 12, right: 8, bottom: 26, left: 30 }
const GAP = 2
const RADIUS = 4

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Clean integer ticks for small counts. */
function ticksFor(max: number): number[] {
  if (max <= 4) return Array.from({ length: Math.max(max, 1) + 1 }, (_, i) => i)
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500].find((s) => max / s <= 4) ?? Math.ceil(max / 4)
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}

/** A column segment whose top corners are rounded (square at the bottom). */
function capPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

const dayLabel = (iso: string, style: 'short' | 'long') =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    ...(style === 'short' ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' }),
  })

export function RunChart({ data }: { data: DayCount[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [view, setView] = React.useState<'chart' | 'table'>('chart')
  const [active, setActive] = React.useState<number | null>(null)

  const totals = data.reduce((t, d) => ({ succeeded: t.succeeded + d.succeeded, failed: t.failed + d.failed }), { succeeded: 0, failed: 0 })
  const empty = totals.succeeded + totals.failed === 0
  const ticks = ticksFor(Math.max(...data.map((d) => d.succeeded + d.failed), 0))
  const yMax = ticks[ticks.length - 1] || 1

  const innerW = Math.max(width - M.left - M.right, 0)
  const innerH = HEIGHT - M.top - M.bottom
  const band = data.length ? innerW / data.length : 0
  const colW = Math.min(24, Math.max(band * 0.56, 4))
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH
  // Short date labels need ~50px; skip days (always keeping "Today") when bands are narrower.
  const labelEvery = Math.max(1, Math.ceil(50 / Math.max(band, 1)))

  const legend = (
    <div className="flex items-center gap-4 text-[12px] text-muted" aria-label="Legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--chart-ok)]" aria-hidden />
        Succeeded <span className="font-semibold text-ink">{totals.succeeded}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--chart-bad)]" aria-hidden />
        Failed <span className="font-semibold text-ink">{totals.failed}</span>
      </span>
    </div>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {legend}
        <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Chart or table">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium',
                view === v ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
              )}
            >
              {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
              {v === 'chart' ? 'Chart' : 'Table'}
            </button>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Runs per day, last 14 days (UTC)</caption>
            <thead className="sticky top-0 bg-surface-2 text-left text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Succeeded
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-2">{dayLabel(d.date, 'long')}</td>
                  <td className="tabular px-3 py-1.5 text-right">{d.succeeded}</td>
                  <td className="tabular px-3 py-1.5 text-right">{d.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" style={{ height: HEIGHT }}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label={`Runs per day for the last 14 days: ${totals.succeeded} succeeded, ${totals.failed} failed`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--faint)] text-[11px] tabular">
                    {t}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const cx = M.left + band * i + band / 2
                const x = cx - colW / 2
                const okH = (d.succeeded / yMax) * innerH
                const badH = (d.failed / yMax) * innerH
                const okTop = M.top + innerH - okH
                // The failed segment sits on top, separated by a 2px surface gap.
                const badTop = okTop - (d.succeeded > 0 && d.failed > 0 ? GAP : 0) - badH
                const isToday = i === data.length - 1
                const showLabel = (data.length - 1 - i) % labelEvery === 0
                const dim = active !== null && active !== i
                return (
                  <g key={d.date} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
                    {active === i && <rect x={M.left + band * i + 1} y={M.top} width={band - 2} height={innerH} rx={6} fill="var(--sunken)" />}
                    {d.succeeded > 0 && (
                      <path d={d.failed > 0 ? `M${x},${okTop}h${colW}v${okH}h${-colW}Z` : capPath(x, okTop, colW, okH, RADIUS)} fill="var(--chart-ok)" />
                    )}
                    {d.failed > 0 && <path d={capPath(x, badTop, colW, badH, RADIUS)} fill="var(--chart-bad)" />}
                    {showLabel && (
                      <text x={cx} y={HEIGHT - 8} textAnchor="middle" className={cn('text-[11px]', isToday ? 'fill-[var(--ink-2)] font-medium' : 'fill-[var(--faint)]')}>
                        {isToday ? 'Today' : dayLabel(d.date, 'short')}
                      </text>
                    )}
                    {/* Hit target: the whole day band, bigger than the mark. */}
                    <rect
                      x={M.left + band * i}
                      y={M.top}
                      width={band}
                      height={innerH}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${dayLabel(d.date, 'long')}: ${d.succeeded} succeeded, ${d.failed} failed`}
                      onPointerEnter={() => setActive(i)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className="cursor-default outline-none"
                    />
                  </g>
                )
              })}
              <line x1={M.left} x2={width - M.right} y1={M.top + innerH} y2={M.top + innerH} stroke="var(--line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
            </svg>
          )}

          {empty && width > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-[13px] text-muted">
              No runs in the last 14 days. Your runs will show up here.
            </div>
          )}

          {active !== null && data[active] && width > 0 && (
            <Tooltip
              left={Math.min(Math.max(M.left + band * active + band / 2, 90), width - 90)}
              top={Math.max(y(data[active].succeeded + data[active].failed) - 12, 0)}
              day={data[active]}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Tooltip({ left, top, day }: { left: number; top: number; day: DayCount }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-surface px-3 py-2 text-[12px] shadow-lift"
      style={{ left, top }}
    >
      <div className="mb-1 font-medium text-ink-2">{dayLabel(day.date, 'long')}</div>
      {[
        { label: 'Succeeded', value: day.succeeded, color: 'var(--chart-ok)' },
        { label: 'Failed', value: day.failed, color: 'var(--chart-bad)' },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} aria-hidden />
          <span className="flex-1 text-muted">{row.label}</span>
          <span className="tabular font-semibold text-ink">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result chart: one bar per row of a grouped result, direct-labelled
// ---------------------------------------------------------------------------

import { formatCount, formatINR } from '~/lib/format'
import { isNumericType, type Column, type Row } from '~/lib/workflow/schema'

const CHART_ROWS = 30

/** A result can be charted when it has a figure to plot: at least one number column and one row. */
export function chartable(columns: Column[], rows: Row[]): boolean {
  return rows.length > 0 && columns.some((c) => isNumericType(c.type))
}

/**
 * Horizontal bars, one per result row: the label is the row's text (and date)
 * columns, the bar is one number column (choose which when there are several).
 * Single series in the brand colour (validated on both surfaces with the run
 * chart), thin marks with a rounded data end, every value written next to its
 * bar, and the table one click away. The first 30 rows are shown, in the
 * result's own order (a sort step decides it).
 */
export function ResultChart({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const measures = columns.filter((c) => isNumericType(c.type))
  const labels = columns.filter((c) => !isNumericType(c.type))
  const [measureName, setMeasure] = React.useState(measures[0]?.name ?? '')
  const measure = measures.find((m) => m.name === measureName) ?? measures[0]
  const [active, setActive] = React.useState<number | null>(null)
  if (!measure) return null

  const shown = rows.slice(0, CHART_ROWS)
  const values = shown.map((row) => (typeof row[measure.name] === 'number' ? (row[measure.name] as number) : 0))
  const max = Math.max(...values, 0)
  const format = (v: number) => (measure.type === 'integer_inr' ? formatINR(v) : formatCount(v))
  const labelOf = (row: Row, i: number) => (labels.length ? labels.map((c) => String(row[c.name] ?? '')).join(' · ') : `Row ${i + 1}`)

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>
          <span className="font-medium text-ink-2">{measure.name}</span> by {labels.length ? labels.map((c) => c.name).join(' and ') : 'row'}
          {rows.length > CHART_ROWS && ` · first ${CHART_ROWS} of ${formatCount(rows.length)} rows`}
        </span>
        {measures.length > 1 && (
          <label className="flex items-center gap-1.5">
            Figure
            <select
              aria-label="Figure to chart"
              value={measure.name}
              onChange={(e) => setMeasure(e.target.value)}
              className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink"
            >
              {measures.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol className="space-y-2" aria-label={`${measure.name} per row`}>
        {shown.map((row, i) => {
          const value = values[i]!
          const width = max > 0 ? (value / max) * 100 : 0
          const dim = active !== null && active !== i
          return (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[12.5px]"
              style={{ opacity: dim ? 0.45 : 1, transition: 'opacity 120ms' }}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="truncate text-ink-2" title={labelOf(row, i)}>
                {labelOf(row, i)}
              </span>
              <span className="relative h-2.5 rounded-r-[4px] bg-sunken" role="img" aria-label={`${labelOf(row, i)}: ${format(value)}`}>
                {value > 0 && <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--brand)]" style={{ width: `${Math.max(width, 1)}%` }} />}
              </span>
              <span className="tabular min-w-[4.5rem] text-right font-medium text-ink">{format(value)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The "Chart | Table" switch shared by result views. */
export function ChartTableToggle({ view, onChange }: { view: 'chart' | 'table'; onChange: (view: 'chart' | 'table') => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Chart or table">
      {(['table', 'chart'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium', view === v ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink')}
        >
          {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          {v === 'chart' ? 'Chart' : 'Table'}
        </button>
      ))}
    </div>
  )
}
