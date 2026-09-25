import * as React from 'react'
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { formatBytes } from '~/lib/format'
import { cn } from './ui'

/** A keyboard-accessible drop zone for one CSV file. The file stays in the browser until you run. */
export function FileDrop({
  file,
  onFile,
  onClear,
  label = 'Drop a CSV file here, or choose one',
  hint = 'Up to 1 MiB · 5,000 rows · 50 columns',
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
  const [over, setOver] = React.useState(false)

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-flow/30 bg-flow-soft/50 px-3.5 py-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-flow-ink shadow-soft">
          <FileSpreadsheet className="size-4.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{file.name}</div>
          <div className="text-[12px] text-muted">{formatBytes(file.size)}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = ''
            onClear?.()
          }}
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
          aria-label={`Remove ${file.name}`}
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
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
        if (dropped) onFile(dropped)
      }}
      className={cn(
        'bg-dots relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'px-4 py-5' : 'px-5 py-8',
        over ? 'border-flow bg-flow-soft/60' : 'border-line-strong hover:border-flow/60',
      )}
    >
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
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".csv,text/csv"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onFile(picked)
        }}
      />
    </div>
  )
}
