import * as React from 'react'
import { cn } from './ui'

/** The FlowPilot mark: two flowing lines ending in a node, on the brand gradient. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = React.useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={`fp-g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4353ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#fp-g-${id})`} />
      <path d="M7.5 21.5c3.6 0 4.6-3.2 7.8-3.2s4.2 3.2 8.2 3.2" stroke="#fff" strokeOpacity=".5" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M7.5 13.2c3.6 0 4.6-3.2 7.8-3.2s4.2 3.2 8.2 3.2" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="23.6" cy="13.2" r="2.7" fill="#fff" />
    </svg>
  )
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('text-[17px] font-semibold tracking-tight', inverted ? 'text-white' : 'text-ink')}>FlowPilot</span>
    </span>
  )
}
