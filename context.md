# FlowPilot: context
_Last updated: 2026-09-26 14:10 · Phase 9 (evaluation) · Complete: evaluation findings fixed; 79 unit + 14 browser tests green_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork. AI drafts; a deterministic server executes; one access policy guards every request.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000 (demo password `flowpilot-demo`)

## Current status
- Phase: 9 evaluation + enhancements (owner asked for a strict review after phase 8). Status: done
- Tests: 79/79 (`npm test`: engine 13, csv 12, validator 13, access 20, demo-loop 12, ai 9) · Browser 14/14 (`npm run test:e2e`: demo 4, features 8, a11y 2) · Model eval 14/14 (`npm run eval:model`, gpt-6-luna, two runs) · Typecheck: pass · Build: pass (prod smoke with live gpt-6-luna)
- App runs with: `npm install && npm run dev` → http://localhost:3000

## Done (with evidence)
Foundation
- [x] TanStack Start app; SSR guard redirects signed-out visitors to /login. Evidence: `curl /` → 307 `/login?redirect=%2F`
- [x] SQLite schema: 8 tables, 12 invariant triggers, migrations in `schema_migrations`. Evidence: `src/server/migrations.ts`; access "enforces the invariants in the database itself"
- [x] Auth: scrypt, SHA-256 session tokens, HttpOnly SameSite=Lax cookie, 10-failure throttle, uniform login errors. Evidence: access suite (401s, throttle)
- [x] Seed: 4 demo accounts, Sales/Marketing, 2 labelled examples. Evidence: access "isolates workspaces"

Recipe language
- [x] Strict contract (Zod), validator with step-by-step column tracking (also on partial drafts), parameter resolution. Evidence: `tests/validator.test.ts` (13)
- [x] Engine: filter/group_sum, exact sums, code-point order, 30 s deadline, step log. Evidence: `tests/engine.test.ts` (13), incl. all six demo expectations
- [x] CSV rules and formula-safe export. Evidence: `tests/csv.test.ts` (12)
- [x] Deterministic summary (`2 rows · status = "paid" · grouped by region · total < ₹1,00,000`). Evidence: engine + demo-loop suites

API and access
- [x] All 20 REST endpoints behind one dispatcher `handleApi(Request)` (route → origin → session → handler → errors). Evidence: access (19) + demo-loop (12) + ai (8) suites
- [x] 404 hides existence; 403 only for visible-but-not-yours; runs private to the runner; unshare → 404 while copies keep running with hidden attribution. Evidence: access suite
- [x] Activity feed tells a source owner about a copy without revealing it. Evidence: demo-loop 11; e2e test 3
- [x] AI authoring: flat strict schema, Anthropic forced tool call / OpenAI + OpenRouter strict json_schema, one repair, 422 DRAFT_INVALID with draft, 503 MODEL_UNAVAILABLE, never writes; run path never imports the model client. Evidence: `tests/ai.test.ts` (8)
- [x] OpenRouter live: `npm run check:model` and the production server both produced a valid demo recipe from `anthropic/claude-sonnet-5` on the first try (7.6 s through prod), then saved and ran it (South ₹40,000 · West ₹70,000). Model comparison in README

UI (evidence screenshots in `docs/screenshots/`)
- [x] Login with one-click demo accounts; controls disabled until hydrated; form is POST. Evidence: `00-login.png`, e2e sign-ins
- [x] Shell: sidebar (workspace + role, New recipe, nav, AI status pill, user), top bar (⌘K palette, theme, New recipe), mobile drawer
- [x] Editor: sample CSV read in the browser, column checklist, AI draft with badges, step cards with per-step columns, Make adjustable, parameters, live validity, columns through the pipeline, Advanced JSON, unsaved-changes guard. Evidence: `01-editor-ai-draft.png`
- [x] Recipe page: version picker + "latest is M" banner, run panel with header pre-check and parameter reset, results (summary chips, Table v9 sorting, funnel, CSV), my runs + delete, who has access, share + copy dialogs. Evidence: `02`–`05`
- [x] Library, My runs, Access (matrix from `policy.ts`, roles, one-click sharing, principles), Dashboard (checklist, stats, validated run chart with table view, activity), System design (interactive diagrams, live schema). Evidence: `06`, `08`, `09`, `10-dashboard-dark.png`
- [x] No horizontal overflow at 390px on the main pages; light and dark themes

Phase 9: evaluation findings, all fixed (evidence: `tests/e2e/features.spec.ts`, `tests/e2e/a11y.spec.ts`, `tests/ai.test.ts`)
- [x] Model switched to `openai/gpt-6-luna` (owner's choice; OpenRouter default in code and `.env`). Evidence: `npm run eval:model` 14/14 twice, median 3.0 s; claude-sonnet-5 and gemini-3.8-flash also 14/14 but slower (5.3 s / 5.0 s median)
- [x] Eval caught 2 prompt weaknesses (copying a sentence-initial capital "Paid"; filtering raw amounts before grouping) → prompt rules added. Evidence: eval runs before/after
- [x] Editor warns when a text value never occurs in the sample file, one-click casing fix (values stay in the browser). Evidence: features "editor warns…"
- [x] Run panel runs the full CSV contract check in the browser (line-numbered issues before upload), hints when a filter can't match the file, offers compatible sample files. Evidence: features "run panel checks the file…"
- [x] Title/description edits no longer create a version ("Save details"). Evidence: features "a details-only edit…"
- [x] `?run=` of another recipe shows a notice + link instead of the wrong result. Evidence: features "a run from another recipe…"
- [x] Large results render 100 rows at a time (sorting covers all rows). Evidence: features "large results page…"
- [x] AI drafting rate limit per person (10/min, 200/day, 429 + Retry-After). Evidence: ai "limits drafts per person…"
- [x] WCAG 2.1 AA: faint text tokens, teal/green ink, sidebar labels darkened; ARIA list fix. Evidence: `tests/e2e/a11y.spec.ts` (axe-core, light + dark, every page)
- [x] Public `GET /api/health` (21 endpoints now). Evidence: access "exposes a public health check…"
- [x] Viewer-specific dashboard checklist; private-link copy notice; Ctrl K label off Mac; three sample files in the editor
- [x] README rewritten (features, model choice + eval table, demo, architecture diagram, API reference, security, testing, config, deployment, troubleshooting)

Phase 8 hardening
- [x] Browser e2e of the whole demo loop (Asha AI-drafts, saves, runs, shares; Vikram reruns, adjusts, resets, copies, regroups, runs; Asha's original unchanged + copy notice; Meera can't copy; Olivia 404). Evidence: `tests/e2e/demo.spec.ts` 4/4
- [x] Security headers on every page/API response (`X-Frame-Options: DENY`, nosniff, `Referrer-Policy`), CSRF middleware kept for server functions. Evidence: curl headers on / and /api/me
- [x] Canonical URLs: default search params stripped (no redirect on /library or /runs). Evidence: curl → 200
- [x] README: quick start, AI setup, OpenRouter model comparison, demo script, architecture, security, tests, limitations

## In progress
- Nothing. The project is complete; phase 9 evaluation findings are all fixed.

## Next steps (ordered)
1. Owner: rotate the OpenRouter key that was shared in chat (the model is chosen: `openai/gpt-6-luna`)
2. If deploying: HTTPS (cookies become Secure automatically), a persistent disk for SQLite, and `SEED_PASSWORD` set to something private
3. Production path from the design: Postgres + row-level security, a job queue for execution, Redis-backed rate limits

## Decisions log
| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-09-26 | Own git repo in `Flowpilot/` | Folder sat inside an unrelated Desktop-level repo | Committing into the Desktop repo |
| 2026-09-26 | Brief truncated mid-section 11; the rest followed the system design PDF | PDF describes the finished system | Stopping to ask |
| 2026-09-26 | TypeScript 6.0 for `tsc --noEmit`; Vitest 4.1 | TS 7 is native-only (TanStack pins TS 6); Vitest 5 excludes Node 25 | TS 7, Vitest 5 |
| 2026-09-26 | Server functions only for session + login info; everything else REST via `/api/$` | Brief: one dispatcher; tests call `handleApi(Request)` | Server functions per feature |
| 2026-09-26 | Client data via `useQuery` (no SSR prefetch); QueryClient in router context + `Wrap` | Brief; SSR renders the shell, data loads client-side | ssr-query integration |
| 2026-09-26 | Cookie `fp_session` (+Secure on HTTPS) instead of `__Host-` | `__Host-` needs Secure, which breaks http://localhost | `__Host-fp_session` |
| 2026-09-26 | Import protection denies `src/server/**` in the client bundle | Build fails if server code leaks to the browser | Marker imports |
| 2026-09-26 | Text cells trimmed; amounts must match `^\d+$`; fully blank rows skipped | Spreadsheet whitespace; blanks carry no data | Raw whitespace |
| 2026-09-26 | Reserved names (`__proto__` etc.) rejected for columns, aliases, parameters | Rows are plain objects | Null-prototype rows |
| 2026-09-26 | Create bodies ignore identity keys; PATCH bodies strict (422) | Brief wording | Strict everywhere |
| 2026-09-26 | New recipes go to the caller's first admin/member workspace | Workspace from the session, never the body | `workspaceId` in body |
| 2026-09-26 | Fork allowed = can view AND admin/member | Viewers can't copy; a copy is a new recipe | Owner always allowed |
| 2026-09-26 | Extra triggers: sequential owner-only versions; runs start `running`, pin their own recipe's version, keep version/runner/parameters | Crafted writes impossible below the API | — |
| 2026-09-26 | Team tab includes my own shared recipes; matrix workspace rows ignore visibility | Team library = what the team sees; workspace permissions | — |
| 2026-09-26 | Dashboard day buckets in UTC | Prototype | Per-user time zones |
| 2026-09-26 | Id-like sample columns (`order_id`) unchecked by default; after a copy the editor opens | Matches the demo contract and flow | — |
| 2026-09-26 | Model reply parsed leniently, then the definition validated strictly; literals placed by column type | Don't waste the single repair on omissions | Strict reply parse |
| 2026-09-26 | Defaults: `claude-sonnet-5` (Anthropic), `gpt-5` (OpenAI), `anthropic/claude-sonnet-5` (OpenRouter) | Brief's intended model; overridable with MODEL_NAME | `openai/gpt-6-luna` offered as the budget option |
| 2026-09-26 | Tests never load `.env` (skipped under VITEST); e2e forces a mock provider | Real keys never reach tests or spend credits | Per-test stubs only |
| 2026-09-26 | Run chart tokens `--chart-ok`/`--chart-bad`; failed = #e5484d in both themes | Validated with the dataviz checker; dark UI red failed the band | Reusing status tokens |
| 2026-09-26 | `src/start.ts` adds security headers and re-adds CSRF for server functions | Defining start.ts replaces Start's default CSRF middleware | No start.ts (earlier choice) |
| 2026-09-26 | Controls needing JS disabled until hydration; `<html data-hydrated>` for tests | Pre-hydration clicks did nothing; a native GET submit would expose credentials | — |
| 2026-09-26 | `stripSearchParams` for default search values | Avoid a redirect to `?tab=mine&q=` on every load | — |
| 2026-09-26 | OpenRouter default model → `openai/gpt-6-luna` | Owner's choice; 14/14 on the eval set, fastest and ~20× cheaper | claude-sonnet-5 (also 14/14, slower) |
| 2026-09-26 | Casing safety net in the browser, not by sending values to the model | Keeps "the model never sees data" true; catches manual typos too | Sending distinct column values to the model |
| 2026-09-26 | Only definition changes create versions; details are PATCHed | A rename isn't a new recipe version | Versioning metadata |
| 2026-09-26 | Drafting limits 10/min + 200/day per person, in memory | A paid key is now configured | No limit; global limit |
| 2026-09-26 | Faint text `#656d80` (light) / `#7c84a3` (dark), flow-ink `#08736f`, ok-ink `#137a3a` | Computed to clear 4.5:1 on every surface; enforced by axe in e2e | Keeping the brief's lighter greys |

## Deviations from the brief
- Added optional `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `OPENROUTER_BASE_URL` · the browser test needs a local mock model (the model call is server-side) · no change when unset
- Added a third provider, OpenRouter (`OPENROUTER_API_KEY`, `MODEL_PROVIDER=openrouter`) · owner asked for it and supplied a key · other adapters unchanged
- Added `docs/screenshots/` evidence and `scripts/screenshots.ts` · not in the brief · no runtime impact

## Known issues / bugs
- Fixed: editor's unsaved-changes prompt appeared after a successful save (stale closure) · found by Playwright
- Fixed: single-column grids overflowed at 390px
- Fixed: clicks before hydration were ignored on the login page; a native submit could have used GET
- Fixed: reduced-motion users briefly saw staggered cards missing (animation delays not zeroed)
- Fixed: dark-theme chart red failed the palette lightness band
- Fixed in phase 9: title-only edits created versions; `?run=` from another recipe rendered as this recipe's result; the AI could copy sentence-initial capitals ("Paid"); faint text failed WCAG contrast
- Open (low): login throttle and drafting limits are in memory (reset on restart); the login throttle is per email, so an address can be locked out for 10 minutes · documented
- Open (low): CSV line numbers count records; a quoted field containing a newline shifts later numbers · documented
- Open (cosmetic): build prints rolldown "use client" warnings from lucide-react; npm warns that Vitest's engines omit Node 25 (tests pass)

## How to run
- Install: `npm install` (Node 22+; built on Node 25.3) · E2E browser once: `npx playwright install chromium`
- Dev: `npm run dev` (predev seeds `./data/flowpilot.db` if empty) → http://localhost:3000
- Seed / reset: `npm run seed` / `npm run seed:reset`
- Test: `npm test` · E2E: `npm run test:e2e` · Typecheck: `npm run typecheck`
- Build / start: `npm run build` → `npm start`
- AI: put keys in `.env` (see `.env.example`), then `npm run check:model` and `npm run eval:model`
- Screenshots: `npx tsx scripts/screenshots.ts --as asha --theme both / /library` (dev server running)

## Environment variables (names only)
DATABASE_PATH, SEED_PASSWORD, MODEL_PROVIDER, MODEL_NAME, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY (+ optional ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL). The local git-ignored `.env` sets MODEL_PROVIDER=openrouter and OPENROUTER_API_KEY.

## File map
- `src/lib/workflow/`: `schema.ts` (contract, LIMITS) · `validate.ts` (validateDefinition, analyze, resolveParameters) · `execute.ts` (engine) · `describe.ts` (INR, steps, summary) · `draft.ts` (editor model) · `examples.ts`
- `src/lib/`: `csv.ts` · `policy.ts` (pure access policy + matrix) · `api.ts` (client + query keys) · `types.ts` · `format.ts` · `session.ts` (server fns) · `demo.ts`
- `src/server/`: `migrations.ts` (schema + triggers) · `db.ts` · `auth.ts` · `repo.ts` (access-aware queries, transactions, stale reaper) · `events.ts` (audit + feed) · `seed.ts` · `http.ts` · `env.ts` · `ids.ts`
- `src/server/api/`: `router.ts` (dispatcher) · `auth.ts` · `workflows.ts` · `runs.ts` · `generate.ts` · `workspace.ts` · `dashboard.ts` · `system.ts`
- `src/server/ai/`: `config.ts` (providers, env) · `generate.ts` (prompt, schema, adapters, repair loop)
- `src/routes/`: `__root.tsx` · `login.tsx` · `_app.tsx` (guard + shell) · `_app/{index,library,runs,access,system-design,workflows.new,w.$workflowId.index,w.$workflowId.edit}.tsx` · `api/$.ts`
- `src/components/`: `ui.tsx` · `shell.tsx` · `command.tsx` · `editor.tsx` · `results.tsx` · `charts.tsx` · `workflow-bits.tsx` · `file-drop.tsx` · `share-dialog.tsx` · `fork-dialog.tsx` · `access-panel.tsx` · `states.tsx` · `toast.tsx` · `logo.tsx` · `theme.ts` · `diagrams/{architecture,versioning}.tsx`
- `src/start.ts`: global request middleware (security headers, server-fn CSRF)
- `tests/`: 6 Vitest suites + `helpers/` · `tests/e2e/`: `demo.spec.ts`, `features.spec.ts`, `a11y.spec.ts`, `mock-model.ts` · `playwright.config.ts`
- `scripts/`: `seed.ts`, `check-model.ts`, `eval-model.ts`, `screenshots.ts` · `fixtures/`, `public/samples/`, `docs/screenshots/`
- `src/lib/samples.ts` (sample catalogue) · `src/server/ratelimit.ts` (drafting limits)

## Demo checklist
- [x] Asha creates & shares (e2e test 1) · [x] Vikram reruns (e2e test 2) · [x] Vikram forks (e2e test 2) · [x] Asha's original unchanged (e2e test 3) · [x] Meera/Olivia blocked (e2e test 4)

## Open questions for the owner
- Please rotate the OpenRouter key that was shared in chat (the local `.env` needs the new value afterwards).
- The brief was cut off after section 11 ("Governance: Access"). If sections 12–19 hold requirements beyond the system design PDF, share them and they can be checked against this build.
