import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  GitFork,
  History,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sigma,
  Sparkles,
  Table2,
} from 'lucide-react'
import { getLoginInfoFn, getSessionFn } from '~/lib/session'
import { TEMPLATES } from '~/lib/workflow/templates'
import { Logo } from '~/components/logo'
import { buttonClass, cn } from '~/components/ui'

// The public front door: what FlowPilot does, how a recipe runs, and where to
// start. Signed-out visitors to "/" land here; everything inside needs an account.

export const Route = createFileRoute('/welcome')({
  loader: async () => ({ options: await getLoginInfoFn(), me: await getSessionFn() }),
  head: () => ({
    meta: [
      { title: 'FlowPilot · Recipes for repetitive CSV reports' },
      { name: 'description', content: 'Describe a repetitive CSV or Excel report once. FlowPilot turns it into a checked, versioned recipe your team reruns on any file, with no AI in the loop.' },
    ],
  }),
  component: WelcomePage,
})

const PIPELINE = [
  { icon: <FileSpreadsheet />, label: 'orders_dated.csv', note: '22 rows', tone: 'text-faint' },
  { icon: <Filter />, label: 'Keep rows where status equals "paid"', note: '17 rows', tone: 'text-flow-ink' },
  { icon: <CalendarRange />, label: 'Keep rows where ordered_on is on or after the start of the month 5 months ago', note: '14 rows', tone: 'text-flow-ink' },
  { icon: <CalendarRange />, label: 'Add month: the month of ordered_on', note: '14 rows', tone: 'text-flow-ink' },
  { icon: <Sigma />, label: 'Group by month: total amount as revenue, number of rows as orders', note: '6 rows', tone: 'text-flow-ink' },
]

const LOOP = [
  { icon: <Sparkles />, title: 'Describe', text: 'One sentence, in English or Hinglish. The AI drafts the steps; you read each one in plain words and change anything.' },
  { icon: <CheckCircle2 />, title: 'Check', text: 'Your file is checked in the browser before anything is sent: missing columns, bad amounts and ambiguous dates are named, line by line. Nothing is guessed.' },
  { icon: <Play />, title: 'Run', text: 'A fixed engine runs the saved recipe, without the AI. The same file and the same version give the same numbers, today and next year.' },
]

const FEATURES = [
  { icon: <FileSpreadsheet />, title: 'CSV and Excel, in and out', text: 'Drop a .csv, .xlsx or .ods file; workbooks convert in your browser and never leave it. Download results as CSV or as an Excel file with real numbers.' },
  { icon: <CalendarRange />, title: 'Dates that mean something', text: '“Last month”, “30 days ago” and “year to date” count from the day you run, and every run records that day. Group by month, quarter or week.' },
  { icon: <Sigma />, title: 'Exact figures', text: 'Whole rupees, exact totals, averages rounded the way the step says. Amounts are never rounded or guessed on the way in.' },
  { icon: <GitFork />, title: 'Share, copy, version', text: 'Share with your workspace in a click. Every save is an immutable version; old versions keep running. Copies remember where they came from.' },
  { icon: <ShieldCheck />, title: 'Governed', text: 'Admins, members and viewers; an audit log of every change; archive instead of delete. Anything you can’t see answers as if it didn’t exist.' },
  { icon: <LockKeyhole />, title: 'Private by design', text: 'Runs are private even from admins. The AI sees column names, never your rows. Passwords are hashed with scrypt; sessions and invite links are stored only as hashes.' },
]

function WelcomePage() {
  const { options, me } = Route.useLoaderData()
  const start = me ? { to: '/' as const, label: 'Open your dashboard' } : options.demoMode ? { to: '/login' as const, label: 'Try the demo' } : { to: '/login' as const, label: 'Sign in' }
  const templates = TEMPLATES.slice(0, 6)

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/welcome" aria-label="FlowPilot home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2" aria-label="Account">
          {me ? (
            <Link to="/" className={buttonClass('brand', 'sm')}>
              Dashboard <ArrowRight className="size-3.5" />
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass('ghost', 'sm')}>
                Sign in
              </Link>
              {options.registration !== 'closed' && (
                <Link to="/signup" className={buttonClass('brand', 'sm')}>
                  Create an account
                </Link>
              )}
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="animate-rise">
            <p className="text-[12.5px] font-semibold tracking-wide text-brand-ink uppercase">Recipes for repetitive reports</p>
            <h1 className="mt-3 text-[34px] leading-[1.08] font-semibold tracking-tight text-ink sm:text-[46px]">
              Describe the report once.
              <br />
              Rerun it on any file, without the AI.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted">
              FlowPilot turns one sentence about a CSV or Excel report into a checked, versioned recipe. The AI only drafts; a deterministic engine runs it, so
              the numbers are the same every time and every step is readable by the person who signs them off.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to={start.to} className={buttonClass('brand', 'lg')}>
                {start.label} <ArrowRight className="size-4" />
              </Link>
              {!me && options.registration !== 'closed' && (
                <Link to="/signup" className={buttonClass('secondary', 'lg')}>
                  Create a workspace
                </Link>
              )}
            </div>
            {options.demoMode && !me && (
              <p className="mt-3 text-[12.5px] text-faint">The demo has four ready accounts across two teams; no sign-up needed.</p>
            )}
          </div>

          <div className="animate-rise rounded-2xl border border-line bg-surface p-5 shadow-lift" style={{ animationDelay: '80ms' }}>
            <div className="mb-3 flex items-center justify-between text-[12px] text-muted">
              <span className="font-medium text-ink-2">Monthly paid revenue, last six months</span>
              <span className="inline-flex items-center gap-1">
                <History className="size-3.5" aria-hidden /> v1 · as of 27 Sep 2026
              </span>
            </div>
            <ol className="space-y-2" aria-label="Rows through each step of an example recipe">
              {PIPELINE.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12.5px]">
                  <span className={cn('mt-[2px] shrink-0 [&_svg]:size-3.5', step.tone)}>{step.icon}</span>
                  <span className="min-w-0 flex-1 text-ink-2">{step.label}</span>
                  <span className="tabular shrink-0 text-faint">{step.note}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-flow-soft px-3 py-2 text-[12.5px] text-flow-ink">
              <Table2 className="size-3.5 shrink-0" aria-hidden />
              6 rows · status = "paid" · ordered_on ≥ the start of the month 5 months ago (1 Apr 2026) · grouped by month
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface-2">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3">
            {LOOP.map((step, i) => (
              <div key={step.title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink [&_svg]:size-4">{step.icon}</span>
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">
                    {i + 1}. {step.title}
                  </h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-[22px] font-semibold tracking-tight text-ink">
            Built for the person who has to trust the numbers
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-sunken text-ink-2 [&_svg]:size-4">{f.icon}</span>
                <h3 className="mt-3 text-[14.5px] font-semibold text-ink">{f.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line bg-surface-2" aria-labelledby="templates-heading">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="templates-heading" className="text-[22px] font-semibold tracking-tight text-ink">
                  Start from a template
                </h2>
                <p className="mt-1 text-[13.5px] text-muted">{TEMPLATES.length} hand-written recipes, each with a sample file. Load one, adjust it, save it as your own.</p>
              </div>
              <Link to="/workflows/new" className={buttonClass('secondary', 'sm')}>
                All templates <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <Link
                  key={t.key}
                  to="/workflows/new"
                  search={{ template: t.key }}
                  className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand"
                >
                  <div className="flex flex-wrap gap-1 text-[11.5px] font-medium text-faint">{t.tags.join(' · ')}</div>
                  <h3 className="mt-2 text-[14.5px] font-semibold text-ink group-hover:text-brand-ink">{t.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{t.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-[12.5px] text-faint sm:px-6">
        <span>FlowPilot · synthetic data only · no AI on reruns</span>
        <span className="flex gap-4">
          <Link to="/login" className="hover:text-ink">
            Sign in
          </Link>
          {options.registration !== 'closed' && (
            <Link to="/signup" className="hover:text-ink">
              Create an account
            </Link>
          )}
        </span>
      </footer>
    </div>
  )
}
