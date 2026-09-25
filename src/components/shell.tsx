import * as React from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, LogOut, Menu, Moon, Sun, X } from 'lucide-react'
import { api } from '~/lib/api'
import type { Me } from '~/lib/types'
import { Logo } from './logo'
import { useTheme } from './theme'
import { Avatar, Badge, cn } from './ui'

type NavItem = { to: string; label: string; icon: React.ReactNode; exact?: boolean }
type NavGroup = { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard />, exact: true }],
  },
]

const ROLE_TONE = { admin: 'brand', member: 'flow', viewer: 'neutral' } as const

function useSignOut() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: async () => {
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/login', search: { redirect: undefined } })
    },
  })
}

function SidebarContent({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const signOut = useSignOut()
  const ws = me.workspace

  return (
    <div className="flex h-full flex-col gap-5 px-3.5 py-5">
      <Link to="/" onClick={onNavigate} className="px-2" aria-label="FlowPilot home">
        <Logo inverted />
      </Link>

      {ws && (
        <div className="rounded-xl border border-sidebar-line bg-sidebar-2 px-3 py-2.5">
          <div className="text-[11px] font-medium tracking-wide text-sidebar-muted uppercase">Workspace</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-white">{ws.workspaceName}</span>
            <Badge tone={ROLE_TONE[ws.role]} className="!bg-white/10 !text-sidebar-ink">
              {ws.role}
            </Badge>
          </div>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-5" aria-label="Main">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-sidebar-muted/80 uppercase">{group.label}</div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors [&_svg]:size-4',
                        active
                          ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]'
                          : 'text-sidebar-muted hover:bg-white/5 hover:text-sidebar-ink',
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-line bg-sidebar-2 p-2.5">
          <Avatar name={me.user.name} hue={me.user.hue} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{me.user.name}</div>
            <div className="truncate text-[11.5px] text-sidebar-muted">{me.user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="grid size-8 place-items-center rounded-lg text-sidebar-muted hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-muted shadow-soft hover:text-ink"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  React.useEffect(() => setDrawerOpen(false), [pathname])

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar lg:block">
        <SidebarContent me={me} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="animate-pop absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar shadow-lift">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-4 right-3 grid size-8 place-items-center rounded-lg text-sidebar-muted hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            <SidebarContent me={me} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md">
          <div className="mx-auto flex h-15 max-w-[1320px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink-2 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </button>
            <div className="flex-1" />
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
