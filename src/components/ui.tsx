import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, Sparkles, X, XCircle } from 'lucide-react'

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const noSubscribe = () => () => {}

/** False during SSR and hydration, true afterwards: a store that never changes, read the way React expects. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(noSubscribe, () => true, () => false)
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'brand' | 'ai' | 'flow' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-canvas hover:bg-ink-2 shadow-soft',
  brand:
    'text-white shadow-[0_6px_18px_-6px_var(--glow-brand)] bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] hover:brightness-110',
  ai: 'text-white shadow-[0_6px_18px_-6px_var(--glow-ai)] bg-[linear-gradient(135deg,var(--ai),var(--brand-2))] hover:brightness-110',
  flow: 'text-white shadow-[0_6px_18px_-6px_var(--glow-flow)] bg-[linear-gradient(135deg,var(--flow),#0b8f8a)] hover:brightness-110',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-soft',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-surface text-bad-ink border border-line hover:border-bad hover:bg-bad-soft',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9.5 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 justify-center rounded-xl',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-all duration-150',
    'active:translate-y-px disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    extra,
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'brand' | 'flow' | 'ai' | 'ok' | 'bad' | 'warn' | 'outline'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 border-transparent',
  brand: 'bg-brand-soft text-brand-ink border-transparent',
  flow: 'bg-flow-soft text-flow-ink border-transparent',
  ai: 'bg-ai-soft text-ai-ink border-transparent',
  ok: 'bg-ok-soft text-ok-ink border-transparent',
  bad: 'bg-bad-soft text-bad-ink border-transparent',
  warn: 'bg-warn-soft text-warn-ink border-transparent',
  outline: 'bg-transparent text-muted border-line',
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
  title,
}: {
  tone?: Tone
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] leading-4 font-medium whitespace-nowrap',
        '[&_svg]:size-3 [&_svg]:shrink-0',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({
  icon,
  title,
  description,
  actions,
  className,
  tone = 'brand',
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  tone?: Exclude<Tone, 'outline'>
}) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-5 pb-3', className)}>
      {icon && (
        <div className={cn('grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', TONES[tone])}>{icon}</div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="animate-rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-semibold tracking-wide text-brand-ink uppercase">{eyebrow}</div>}
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[14.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Segmented tabs
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: Array<{ value: T; label: React.ReactNode; count?: number; icon?: React.ReactNode }>
  label: string
  className?: string
}) {
  return (
    // Never wider than its container: on a narrow screen the tabs scroll sideways inside it.
    <div role="tablist" aria-label={label} className={cn('scrollbar-thin inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-sunken p-1', className)}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all [&_svg]:size-3.5',
              active ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-[11px] leading-4.5',
                  active ? 'bg-brand-soft text-brand-ink' : 'bg-surface text-faint',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const FIELD =
  'w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint shadow-soft transition-colors ' +
  'hover:border-line-strong focus:border-brand focus:outline-none focus:ring-3 focus:ring-[var(--ring)]/25 ' +
  'disabled:bg-sunken disabled:text-muted aria-invalid:border-bad'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(FIELD, 'h-9.5', className)} {...rest} />
})

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(FIELD, 'min-h-20 py-2 leading-relaxed', className)} {...rest} />
  },
)

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }
>(function Select({ className, wrapperClassName, children, ...rest }, ref) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <select ref={ref} className={cn(FIELD, 'h-9.5 appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
    </div>
  )
})

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-bad-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5.5 w-9.5 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-line-strong',
      )}
    >
      <span
        className={cn(
          'inline-block size-4.5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} aria-label="Loading" />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-surface px-1.5 py-px text-[11px] text-muted shadow-soft">{children}</kbd>
  )
}

const CALLOUT_TONES = {
  info: { box: 'border-brand/20 bg-brand-soft/60', icon: <Info className="text-brand" />, title: 'text-brand-ink' },
  ai: { box: 'border-ai/25 bg-ai-soft/70', icon: <Sparkles className="text-ai" />, title: 'text-ai-ink' },
  warn: { box: 'border-warn/25 bg-warn-soft', icon: <AlertTriangle className="text-warn" />, title: 'text-warn-ink' },
  bad: { box: 'border-bad/25 bg-bad-soft', icon: <XCircle className="text-bad" />, title: 'text-bad-ink' },
  ok: { box: 'border-ok/25 bg-ok-soft', icon: <CheckCircle2 className="text-ok" />, title: 'text-ok-ink' },
} as const

export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: keyof typeof CALLOUT_TONES
  title?: React.ReactNode
  children?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const t = CALLOUT_TONES[tone]
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3 text-[13.5px] text-ink-2', t.box, className)}
    >
      <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon ?? t.icon}</div>
      <div className="min-w-0 flex-1">
        {title && <div className={cn('font-semibold', t.title)}>{title}</div>}
        {children && <div className={cn(Boolean(title) && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-dots flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line bg-surface text-muted shadow-soft [&_svg]:size-5">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Avatar: initials on a hue gradient
// ---------------------------------------------------------------------------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'
}

export function Avatar({
  name,
  hue,
  size = 28,
  className,
  ring,
}: {
  name: string
  hue: number
  size?: number
  className?: string
  ring?: boolean
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', ring && 'ring-2 ring-surface', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        background: `linear-gradient(135deg, hsl(${hue} 72% 60%), hsl(${(hue + 32) % 360} 70% 44%))`,
      }}
    >
      {initials(name)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Dialog: Esc closes, the first field gets focus, focus returns on close.
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  icon,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  icon?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()

  React.useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
    const first = panel?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])')
    ;(first ?? focusable()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const items = focusable()
        if (!items.length) return
        const firstItem = items[0]!
        const lastItem = items[items.length - 1]!
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault()
          lastItem.focus()
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault()
          firstItem.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="animate-fade absolute inset-0 bg-[rgb(8_10_20/0.45)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'animate-pop relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-lift sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon && (
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink [&_svg]:size-4.5">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-[13px] text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** A small hover/focus tooltip for explaining disabled controls. */
export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' }) {
  const id = React.useId()
  return (
    <span className="group/tip relative inline-flex" aria-describedby={id}>
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] leading-snug font-medium text-canvas opacity-0 shadow-lift transition-opacity',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Menu: a button that opens a list of actions (WAI-ARIA menu button pattern).
// Arrow keys move, Escape or a click outside closes, focus returns to the button.
// ---------------------------------------------------------------------------

type MenuContextValue = { close: () => void }
const MenuContext = React.createContext<MenuContextValue>({ close: () => {} })

export function Menu({
  label,
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  className,
  panelClassName,
}: {
  /** Accessible name of the menu button. */
  label: string
  /** The button's content. */
  trigger: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()

  const items = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"])',
      ) ?? [],
    )
  const close = React.useCallback((focusButton = true) => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }, [])

  React.useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, close])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className="block w-full text-left"
      >
        {trigger}
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={cn(
              'animate-pop absolute z-50 min-w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lift',
              side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
              align === 'start' ? 'left-0' : 'right-0',
              panelClassName,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  )
}

export function MenuItem({
  onSelect,
  children,
  icon,
  disabled,
  hint,
  checked,
  tone,
}: {
  onSelect: () => void
  children: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  hint?: React.ReactNode
  /** Marks the current choice in a list (e.g. the workspace in use). */
  checked?: boolean
  tone?: 'danger'
}) {
  const { close } = React.useContext(MenuContext)
  return (
    <div
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (disabled) return
        close()
        onSelect()
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault()
          close()
          onSelect()
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] outline-none select-none [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'danger' ? 'text-bad-ink' : 'text-ink',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-sunken focus:bg-sunken',
      )}
    >
      {icon && <span className={tone === 'danger' ? '' : 'text-muted'}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
      </span>
      {checked && <CheckCircle2 className="text-brand" aria-hidden />}
    </div>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</div>
}
