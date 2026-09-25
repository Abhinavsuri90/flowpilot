import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CornerDownLeft, FileText, Search } from 'lucide-react'
import { api, qs } from '~/lib/api'
import type { WorkflowList } from '~/lib/types'
import { Kbd, Spinner, cn } from './ui'
import { VisibilityBadge } from './workflow-bits'

export type PaletteLink = { label: string; to: string; icon: React.ReactNode; hint?: string }

type Item =
  | { kind: 'recipe'; id: string; label: string; sub: string; visibility: 'private' | 'team' }
  | { kind: 'page'; label: string; to: string; icon: React.ReactNode; hint?: string }

/** ⌘K: jump to any recipe you can read, or to a page. Results come from the same access-checked API. */
export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PaletteLink[] }) {
  const [q, setQ] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 150)
    return () => window.clearTimeout(t)
  }, [q])

  React.useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const previous = document.activeElement as HTMLElement | null
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => previous?.focus?.()
  }, [open])

  const recipes = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api.get<WorkflowList>(`/api/workflows${qs({ scope: 'all', q: debounced })}`),
    enabled: open,
    staleTime: 5_000,
  })

  const items: Item[] = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    const recipeItems: Item[] = (recipes.data?.items ?? []).slice(0, 7).map((r) => ({
      kind: 'recipe',
      id: r.id,
      label: r.title,
      sub: `${r.isMine ? 'Yours' : r.owner.name} · v${r.currentVersion.number}`,
      visibility: r.visibility,
    }))
    const pageItems: Item[] = pages
      .filter((p) => !needle || p.label.toLowerCase().includes(needle))
      .map((p) => ({ kind: 'page', label: p.label, to: p.to, icon: p.icon, hint: p.hint }))
    return [...recipeItems, ...pageItems]
  }, [recipes.data, pages, q])

  React.useEffect(() => setActive(0), [debounced])

  const go = (item: Item | undefined) => {
    if (!item) return
    onClose()
    if (item.kind === 'recipe') void navigate({ to: '/w/$workflowId', params: { workflowId: item.id } })
    else void navigate({ to: item.to })
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="animate-fade absolute inset-0 bg-[rgb(8_10_20/0.45)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search recipes and pages"
        className="animate-pop relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            go(items[active])
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search recipes you can open, or jump to a page"
            className="h-13 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
          />
          {recipes.isFetching && <Spinner />}
          <Kbd>Esc</Kbd>
        </div>
        <ul id="palette-list" role="listbox" className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted">{recipes.isPending ? 'Searching…' : 'Nothing matches.'}</li>
          )}
          {items.map((item, i) => {
            const selected = i === active
            const firstPage = item.kind === 'page' && items[i - 1]?.kind !== 'page'
            const firstRecipe = item.kind === 'recipe' && i === 0
            return (
              <React.Fragment key={item.kind === 'recipe' ? item.id : item.to}>
                {(firstRecipe || firstPage) && (
                  <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">
                    {item.kind === 'recipe' ? 'Recipes' : 'Pages'}
                  </li>
                )}
                <li
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                    selected ? 'bg-brand-soft text-ink' : 'text-ink-2',
                  )}
                >
                  <span className="grid size-7 place-items-center rounded-lg border border-line bg-surface text-muted [&_svg]:size-3.5">
                    {item.kind === 'recipe' ? <FileText /> : item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.kind === 'recipe' ? (
                      <span className="block truncate text-[12px] text-muted">{item.sub}</span>
                    ) : item.hint ? (
                      <span className="block truncate text-[12px] text-muted">{item.hint}</span>
                    ) : null}
                  </span>
                  {item.kind === 'recipe' && <VisibilityBadge visibility={item.visibility} />}
                  {selected ? <CornerDownLeft className="size-3.5 text-faint" /> : <ArrowRight className="size-3.5 text-transparent" />}
                </li>
              </React.Fragment>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
