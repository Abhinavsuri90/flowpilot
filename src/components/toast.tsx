import * as React from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from './ui'

type ToastTone = 'ok' | 'bad' | 'info'
type ToastItem = { id: number; tone: ToastTone; title: string; description?: string }
type ToastApi = { show: (toast: Omit<ToastItem, 'id'>) => void }

const ToastContext = React.createContext<ToastApi>({ show: () => {} })

export function useToast(): ToastApi {
  return React.useContext(ToastContext)
}

const ICONS: Record<ToastTone, React.ReactNode> = {
  ok: <CheckCircle2 className="size-4.5 text-ok" aria-hidden />,
  bad: <XCircle className="size-4.5 text-bad" aria-hidden />,
  info: <Info className="size-4.5 text-brand" aria-hidden />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(1)

  const dismiss = React.useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const show = React.useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-3), { ...toast, id }])
      window.setTimeout(() => dismiss(id), toast.tone === 'bad' ? 7000 : 4200)
    },
    [dismiss],
  )
  const api = React.useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={cn(
              'animate-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-lift',
              t.tone === 'bad' ? 'border-bad/30' : 'border-line',
            )}
          >
            <div className="mt-0.5">{ICONS[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              {t.description && <div className="mt-0.5 text-[13px] text-muted">{t.description}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mr-1 grid size-6 place-items-center rounded-md text-faint hover:bg-sunken hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
