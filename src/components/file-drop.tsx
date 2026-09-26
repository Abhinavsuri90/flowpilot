import * as React from 'react'
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { formatBytes, formatCount } from '~/lib/format'
import { FILE_ACCEPT, fileKind, openWorkbook, WorkbookError, type Workbook } from '~/lib/spreadsheet'
import { cn, Select, Spinner } from './ui'

/** A workbook that was opened here, and the CSV made from the chosen sheet (null when that sheet can't be run). */
type Opened = { source: File; book: Workbook; sheet: string; csv: File | null; error: string | null }

/**
 * A keyboard-accessible drop zone for one CSV or spreadsheet file. Workbooks
 * (Excel, ODS) are converted to CSV right here, so callers only ever receive
 * CSV, and the file stays in the browser until you run.
 */
export function FileDrop({
  file,
  onFile,
  onClear,
  label = 'Drop a CSV or Excel file here, or choose one',
  hint = 'CSV, Excel or ODS · up to 1 MiB · 5,000 rows · 50 columns',
  compact,
  id,
}: {
  file: File | null
  onFile: (file: File) => void
  onClear?: () => void
  label?: string
  hint?: string
  compact?: boolean
  id?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const uid = React.useId()
  const [over, setOver] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const [opened, setOpened] = React.useState<Opened | null>(null)
  const [problem, setProblem] = React.useState<string | null>(null)
  // Only shown while the caller holds the CSV made here (a sample the caller set itself isn't ours).
  const workbook = opened && file === opened.csv ? opened : null

  /** Makes CSV from one sheet and hands it over; a sheet that can't be run leaves the caller without a file. */
  const choose = (base: Pick<Opened, 'source' | 'book'>, sheet: string) => {
    try {
      const csv = new File([base.book.csvOf(sheet)], base.source.name, { type: 'text/csv' })
      setOpened({ ...base, sheet, csv, error: null })
      onFile(csv)
    } catch (err) {
      setOpened({ ...base, sheet, csv: null, error: err instanceof WorkbookError ? err.message : 'This sheet could not be converted.' })
      onClear?.()
    }
  }

  const pick = async (picked: File) => {
    setProblem(null)
    if (fileKind(picked.name) !== 'workbook') {
      setOpened(null)
      onFile(picked)
      return
    }
    setReading(true)
    try {
      const book = await openWorkbook(new Uint8Array(await picked.arrayBuffer()))
      if (!book.defaultSheet) throw new WorkbookError('This workbook has no data on any sheet.')
      choose({ source: picked, book }, book.defaultSheet)
    } catch (err) {
      setOpened(null)
      setProblem(err instanceof WorkbookError ? err.message : 'This file could not be read as a spreadsheet.')
    } finally {
      setReading(false)
    }
  }

  const clear = () => {
    if (inputRef.current) inputRef.current.value = ''
    setOpened(null)
    setProblem(null)
    onClear?.()
  }

  if (file || workbook) {
    const shown = file ?? workbook!.source
    const sheet = workbook?.book.sheets.find((s) => s.name === workbook.sheet)
    const sheetId = `${id ?? uid}-sheet`
    return (
      <div className="rounded-xl border border-flow/30 bg-flow-soft/50 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-flow-ink shadow-soft">
            <FileSpreadsheet className="size-4.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{shown.name}</div>
            <div className="text-[12px] text-muted">
              {workbook
                ? `${formatBytes(workbook.source.size)} workbook · sheet “${workbook.sheet}”${sheet && !workbook.error ? ` · ${formatCount(sheet.rows)} rows as CSV` : ''}`
                : formatBytes(shown.size)}
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
            aria-label={`Remove ${shown.name}`}
          >
            <X className="size-4" />
          </button>
        </div>
        {workbook && workbook.book.sheets.length > 1 && (
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-muted">
            <label htmlFor={sheetId} className="shrink-0 font-medium text-ink-2">
              Sheet
            </label>
            <Select id={sheetId} value={workbook.sheet} onChange={(e) => choose(workbook, e.target.value)} wrapperClassName="min-w-0 flex-1" className="h-8 text-[12.5px]">
              {workbook.book.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} · {s.truncated ? 'too many rows' : `${formatCount(s.rows)} rows`}
                </option>
              ))}
            </Select>
          </div>
        )}
        {workbook?.error ? (
          <p role="alert" className="mt-2 text-[12.5px] text-bad-ink">
            {workbook.error}
          </p>
        ) : (
          workbook && <p className="mt-2 text-[12px] text-muted">Converted to CSV in your browser; the workbook itself is never uploaded.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped && !reading) void pick(dropped)
        }}
        className={cn(
          'bg-dots relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors',
          compact ? 'px-4 py-5' : 'px-5 py-8',
          over ? 'border-flow bg-flow-soft/60' : 'border-line-strong hover:border-flow/60',
        )}
      >
        {reading ? (
          <p className="flex items-center gap-2 text-[13.5px] text-muted" role="status">
            <Spinner className="size-4" /> Reading the workbook…
          </p>
        ) : (
          <>
            <UploadCloud className={cn('mb-2 text-faint', compact ? 'size-5' : 'size-6', over && 'text-flow')} aria-hidden />
            <label htmlFor={id} className="cursor-pointer text-[13.5px] font-medium text-ink-2">
              {label.split(', or ')[0]}
              {label.includes(', or ') && (
                <>
                  , or <span className="text-flow-ink underline decoration-flow/40 underline-offset-2">{label.split(', or ')[1]}</span>
                </>
              )}
            </label>
            <p className="mt-1 text-[12px] text-faint">{hint}</p>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={FILE_ACCEPT}
          disabled={reading}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) void pick(picked)
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="text-[12.5px] text-bad-ink">
          {problem}
        </p>
      )}
    </div>
  )
}
