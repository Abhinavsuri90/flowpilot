import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Eye, EyeOff, FileSpreadsheet, Filter, GitFork, History, Lock, ShieldCheck, Sigma, Table2 } from 'lucide-react'
import { passwordStrength } from '~/lib/account'
import { Logo } from './logo'
import { Input, cn } from './ui'

// The split layout shared by sign-in, sign-up, invites and password resets.

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <BrandPanel />
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="animate-rise w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Link to="/login" aria-label="FlowPilot sign in">
              <Logo />
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

/** A password input with a show/hide toggle and, for new passwords, a strength meter. */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { meter?: boolean; value: string }
>(function PasswordInput({ meter, className, ...props }, ref) {
  const [shown, setShown] = React.useState(false)
  const strength = passwordStrength(props.value)
  const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const
  return (
    <div>
      <div className="relative">
        <Input ref={ref} {...props} type={shown ? 'text' : 'password'} className={cn('pr-10', className)} />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-sunken hover:text-ink"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {meter && props.value.length > 0 && (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= step ? (strength <= 1 ? 'bg-bad' : strength === 2 ? 'bg-warn' : 'bg-ok') : 'bg-line',
                )}
              />
            ))}
          </div>
          <span className="w-16 text-right text-[12px] text-muted">{LABELS[strength]}</span>
        </div>
      )}
    </div>
  )
})

const PIPELINE = [
  { icon: <FileSpreadsheet />, label: 'sales_A.csv', rows: 6, tone: 'text-sidebar-ink' },
  { icon: <Filter />, label: 'Keep rows where status equals "paid"', rows: 4, tone: 'text-[#9aa6ff]' },
  { icon: <Sigma />, label: 'Total amount by region as total', rows: 3, tone: 'text-[#9aa6ff]' },
  { icon: <Filter />, label: 'Keep rows where total is less than ₹1,00,000', rows: 2, tone: 'text-[#9aa6ff]' },
]

function BrandPanel() {
  return (
    <aside className="relative hidden w-[46%] max-w-[640px] overflow-hidden bg-sidebar text-sidebar-ink lg:flex lg:flex-col">
      <div className="bg-grid absolute inset-0 opacity-60 [--dot:rgb(255_255_255/0.045)]" aria-hidden />
      <div className="absolute -top-40 -left-32 size-[520px] rounded-full bg-[var(--brand)] opacity-25 blur-[120px]" aria-hidden />
      <div className="absolute -right-40 bottom-0 size-[420px] rounded-full bg-[#0ea5a0] opacity-15 blur-[120px]" aria-hidden />

      <div className="relative flex flex-1 flex-col px-12 py-10">
        <Logo inverted />
        <div className="mt-auto mb-auto pt-14 pb-10">
          <div className="text-[12px] font-semibold tracking-[0.14em] text-[#9aa6ff] uppercase">Shareable workflows for teams</div>
          <h2 className="mt-3 max-w-md text-[34px] leading-[1.12] font-semibold tracking-tight text-white">
            Build the recipe once. Let your whole team run it.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-sidebar-muted">
            Describe a repetitive CSV report in one sentence. FlowPilot turns it into steps you review, save and share, and
            anyone on your team can rerun it on their own file with no AI involved.
          </p>

          <div className="mt-9 max-w-md rounded-2xl border border-sidebar-line bg-white/[0.035] p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.7)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between text-[11.5px] text-sidebar-muted">
              <span>Example run · Regional revenue exceptions</span>
              <span className="inline-flex items-center gap-1 text-[#5fe0d9]">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-[#26c2bb]" /> deterministic
              </span>
            </div>
            <ol>
              {PIPELINE.map((step, i) => (
                <li key={step.label}>
                  <div className="flex items-center gap-3 rounded-xl border border-sidebar-line bg-sidebar-2/80 px-3 py-2.5">
                    <span className={cn('[&_svg]:size-4', step.tone)}>{step.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-ink">{step.label}</span>
                    <span className="tabular rounded-md bg-white/5 px-1.5 py-0.5 text-[11.5px] text-sidebar-muted">{step.rows} rows</span>
                  </div>
                  <div className="relative ml-[21px] h-4 w-px bg-white/12">
                    <span
                      className="animate-drip absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#26c2bb] shadow-[0_0_8px_#26c2bb]"
                      style={{ animationDelay: `${i * 0.35}s` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-3 rounded-xl border border-[#26c2bb]/30 bg-[#26c2bb]/10 px-3 py-2.5">
              <Table2 className="size-4 text-[#5fe0d9]" />
              <span className="tabular flex-1 text-[13px] text-white">South ₹40,000 · West ₹70,000</span>
              <span className="text-[11.5px] text-[#5fe0d9]">2 rows</span>
            </div>
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-4 text-[12.5px] text-sidebar-muted">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> No AI on reruns: a fixed engine runs every step
          </li>
          <li className="flex items-start gap-2">
            <History className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> Every save is a new, immutable version
          </li>
          <li className="flex items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-[#9aa6ff]" /> Results stay private to whoever ran them
          </li>
        </ul>
        <div className="mt-6 flex items-center gap-2 text-[12px] text-sidebar-muted">
          <GitFork className="size-3.5" /> Copies are independent: adapting a recipe never changes the original.
        </div>
      </div>
    </aside>
  )
}
