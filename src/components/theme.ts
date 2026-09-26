import * as React from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'fp-theme'

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;var t=null;try{t=localStorage.getItem('${KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.dataset.theme=t})();`

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const serverTheme = (): Theme => 'light'

/** The document's data-theme (set before first paint by THEME_SCRIPT) is the source of truth; SSR and hydration render light. */
export function useTheme(): [Theme, () => void] {
  const theme = React.useSyncExternalStore(subscribe, readTheme, serverTheme)

  const toggle = React.useCallback(() => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page view.
    }
    for (const listener of listeners) listener()
  }, [])

  return [theme, toggle]
}
