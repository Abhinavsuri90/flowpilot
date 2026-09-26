import type { DatePart, DateUnit, RelativeDate, WorkflowDefinition } from './workflow/schema'

// Calendar dates as "YYYY-MM-DD" text, with the maths done on day numbers
// rather than Date objects: a CSV or a workbook has no time zone, so the same
// recipe must give the same rows on every machine.

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export const DATE_YEAR_MIN = 1900
export const DATE_YEAR_MAX = 2200

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export type Ymd = { y: number; m: number; d: number }

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
}

function validYmd(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= DATE_YEAR_MIN && y <= DATE_YEAR_MAX && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
  )
}

export function toIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function fromIso(iso: string): Ymd | null {
  const match = ISO_DATE.exec(iso)
  if (!match) return null
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
  return validYmd(ymd.y, ymd.m, ymd.d) ? ymd : null
}

/** A real calendar date written as YYYY-MM-DD. */
export function isIsoDate(text: unknown): text is string {
  return typeof text === 'string' && fromIso(text) !== null
}

// ----- Day numbers (days since 1970-01-01), proleptic Gregorian; Howard Hinnant's algorithms -----

export function dayNumber({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = (m + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function fromDayNumber(n: number): Ymd {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: m <= 2 ? y + 1 : y, m, d }
}

/** 1 = Monday … 7 = Sunday (1970-01-01 was a Thursday). */
export function isoWeekday(ymd: Ymd): number {
  return ((((dayNumber(ymd) + 3) % 7) + 7) % 7) + 1
}

/** ISO 8601 week: weeks start on Monday and belong to the year that holds their Thursday. */
export function isoWeek(ymd: Ymd): { year: number; week: number } {
  const thursday = dayNumber(ymd) + (4 - isoWeekday(ymd))
  const t = fromDayNumber(thursday)
  return { year: t.y, week: Math.floor((thursday - dayNumber({ y: t.y, m: 1, d: 1 })) / 7) + 1 }
}

// ----- Relative dates and periods --------------------------------------------------------------

/** The date a relative value means on the day the recipe runs ("the start of last month" from 2026-09-27 → 2026-08-01). */
export function relativeDate(asOf: string, rel: RelativeDate): string {
  const base = fromIso(asOf)
  if (!base) throw new Error(`Not a date: ${asOf}`)
  const start = rel.edge === 'start'
  switch (rel.unit) {
    case 'day':
      return toIso(fromDayNumber(dayNumber(base) + rel.offset))
    case 'week': {
      const monday = dayNumber(base) - (isoWeekday(base) - 1) + rel.offset * 7
      return toIso(fromDayNumber(start ? monday : monday + 6))
    }
    case 'month': {
      const total = base.y * 12 + (base.m - 1) + rel.offset
      const y = Math.floor(total / 12)
      const m = total - y * 12 + 1
      return toIso({ y, m, d: start ? 1 : daysInMonth(y, m) })
    }
    case 'quarter': {
      const total = base.y * 4 + Math.floor((base.m - 1) / 3) + rel.offset
      const y = Math.floor(total / 4)
      const first = (total - y * 4) * 3 + 1
      return start ? toIso({ y, m: first, d: 1 }) : toIso({ y, m: first + 2, d: daysInMonth(y, first + 2) })
    }
    case 'year': {
      const y = base.y + rel.offset
      return start ? toIso({ y, m: 1, d: 1 }) : toIso({ y, m: 12, d: 31 })
    }
  }
}

/** The period a date falls in: "2026", "2026-Q3", "2026-09" or "2026-W39" (all sort in calendar order as text). */
export function datePart(iso: string, part: DatePart): string {
  const ymd = fromIso(iso)
  if (!ymd) throw new Error(`Not a date: ${iso}`)
  switch (part) {
    case 'year':
      return String(ymd.y)
    case 'quarter':
      return `${ymd.y}-Q${Math.floor((ymd.m - 1) / 3) + 1}`
    case 'month':
      return `${ymd.y}-${String(ymd.m).padStart(2, '0')}`
    case 'week': {
      const w = isoWeek(ymd)
      return `${w.year}-W${String(w.week).padStart(2, '0')}`
    }
  }
}

/** "today", "30 days ago", "the start of last month", "the end of this quarter". */
export function describeRelative(rel: RelativeDate): string {
  const { unit, offset, edge } = rel
  if (unit === 'day') {
    if (offset === 0) return 'today'
    if (offset === -1) return 'yesterday'
    if (offset === 1) return 'tomorrow'
    return offset < 0 ? `${-offset} days ago` : `${offset} days from now`
  }
  const which =
    offset === 0
      ? `this ${unit}`
      : offset === -1
        ? `last ${unit}`
        : offset === 1
          ? `next ${unit}`
          : offset < 0
            ? `the ${unit} ${-offset} ${unit}s ago`
            : `the ${unit} ${offset} ${unit}s from now`
  return `the ${edge} of ${which}`
}

/** "15 Jan 2026": readable in India and unambiguous everywhere. */
export function formatDate(iso: string): string {
  const ymd = fromIso(iso)
  return ymd ? `${ymd.d} ${MONTH_SHORT[ymd.m - 1]} ${ymd.y}` : iso
}

/** Today where the code runs: the browser's local day, or the server's UTC day. */
export function todayIso(now: Date = new Date(), utc: boolean = typeof window === 'undefined'): string {
  return utc ? now.toISOString().slice(0, 10) : toIso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
}

/** Whether any step depends on the day the recipe runs. */
export function usesRelativeDates(def: Pick<WorkflowDefinition, 'steps'>): boolean {
  return def.steps.some((s) => s.type === 'filter' && 'relative' in s.value)
}

// ----- Reading dates from files ----------------------------------------------------------------

export type DateCheck = { ok: true; value: string } | { ok: false; problem: string }

export const DATE_HINT = 'write dates as 2026-04-03, or upload the Excel file itself (its dates convert exactly)'

const TIME = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2}|[AaPp][Mm])?)?`
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}$`)
const DAY_MONTH_YEAR = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{4})${TIME}$`)
const MONTH_DAY_YEAR = new RegExp(String.raw`^([A-Za-z]{3,9})\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?[\s,\-/.]+(\d{4})${TIME}$`)
const NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})${TIME}$`)

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase()
  const index = MONTH_FULL.findIndex((full) => full.startsWith(lower) && lower.length >= 3)
  return index === -1 ? null : index + 1
}

function finish(y: number, m: number, d: number, shown: string): DateCheck {
  return validYmd(y, m, d) ? { ok: true, value: toIso({ y, m, d }) } : { ok: false, problem: `"${shown}" is not a real date` }
}

/**
 * Reads one date cell. Accepted: 2026-04-03 (with or without a time),
 * 3 Apr 2026, 03-Apr-2026, April 3, 2026, 2026/04/03, and day/month/year
 * digits only when they can be read one way (15/04/2026, never 03/04/2026).
 * Nothing is guessed: an ambiguous cell is reported with both readings.
 */
export function checkDate(raw: string): DateCheck {
  const s = raw.trim()
  if (s === '') return { ok: false, problem: 'is blank; every row needs a date' }
  let m = YEAR_FIRST.exec(s)
  if (m) return finish(Number(m[1]), Number(m[2]), Number(m[3]), s)
  m = DAY_MONTH_YEAR.exec(s)
  if (m) {
    const month = monthNumber(m[2]!)
    if (month) return finish(Number(m[3]), month, Number(m[1]), s)
  }
  m = MONTH_DAY_YEAR.exec(s)
  if (m) {
    const month = monthNumber(m[1]!)
    if (month) return finish(Number(m[3]), month, Number(m[2]), s)
  }
  m = NUMERIC.exec(s)
  if (m) {
    if (m[3]!.length !== 4) return { ok: false, problem: `"${s}" has a two-digit year; ${DATE_HINT}` }
    const a = Number(m[1])
    const b = Number(m[2])
    const y = Number(m[3])
    const dayFirst = validYmd(y, b, a) ? toIso({ y, m: b, d: a }) : null
    const monthFirst = validYmd(y, a, b) ? toIso({ y, m: a, d: b }) : null
    if (dayFirst && monthFirst && dayFirst !== monthFirst) {
      return { ok: false, problem: `"${s}" could be ${formatDate(dayFirst)} or ${formatDate(monthFirst)}; ${DATE_HINT}` }
    }
    const only = dayFirst ?? monthFirst
    return only ? { ok: true, value: only } : { ok: false, problem: `"${s}" is not a real date` }
  }
  return { ok: false, problem: `"${s}" is not a date; ${DATE_HINT}` }
}
