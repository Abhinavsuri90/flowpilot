# FlowPilot: context
_Last updated: 2026-09-26 02:30 · Phase 3/8 · API + access done; starting core UI_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000

## Current status
- Phase: 3 API + access. Status: done
- Tests: 69/69 (`npm test`, 2026-09-26: engine 13, csv 12, validator 13, access 19, demo-loop 12). Typecheck: pass. Build: pass (phase 1)
- App runs with: `npm install && npm run dev` → http://localhost:3000

## Done (with evidence)
- [x] TanStack Start app boots; SSR guard redirects signed-out visitors to /login. Evidence: `curl /` → 307 `/login?redirect=%2F` (dev and prod)
- [x] SQLite schema, 8 tables + 12 invariant triggers, migrations tracked in `schema_migrations`. Evidence: `src/server/migrations.ts`; seed run lists all triggers
- [x] Seed: 4 demo accounts in Sales/Marketing. Evidence: `npm run seed` output
- [x] Auth: scrypt hashes, SHA-256 session tokens, HttpOnly SameSite=Lax cookie, same-origin check on writes. Evidence: curl login 200 + cookie, cross-site login → 403 BAD_ORIGIN
- [x] Login page (split brand panel + one-click demo accounts), app shell, light/dark tokens. Evidence: screenshots reviewed in session (scratchpad), to be regenerated under docs/screenshots in phase 8
- [x] Production build via Nitro, better-sqlite3 traced into `.output/server/node_modules`. Evidence: `node .output/server/index.mjs` served login + /api/me with `private, no-store`

- [x] Recipe contract: strict Zod schema, LIMITS, types. Evidence: `src/lib/workflow/schema.ts`, validator suite
- [x] Validator with step-by-step schema tracking (works on partial drafts) + parameter resolution. Evidence: `tests/validator.test.ts` (13), incl. exact "no longer available" message
- [x] Engine: filter/group_sum, code-point ordering, exact sums, 30 s deadline checked between steps and every 1,024 rows, step log. Evidence: `tests/engine.test.ts` (13): all six demo expectations, lt vs lte, TIMEOUT
- [x] CSV: 1 MiB/5,000 rows/50 columns, BOM, trimming, duplicates, field counts, 5 bad-amount kinds with line numbers, inference, formula-escaped export. Evidence: `tests/csv.test.ts` (12)
- [x] Deterministic describe + summary (`2 rows · status = "paid" · grouped by region · total < ₹1,00,000`). Evidence: engine suite

- [x] Pure policy (`decide`, `denialStatus`, `decideRoleChange`, `permissionMatrix`). Evidence: access suite "renders the permission matrix from the same policy the API enforces"
- [x] 19 of 20 REST endpoints through `handleApi` (all but `/api/generate`, phase 5). Evidence: `tests/access.test.ts` (19), `tests/demo-loop.test.ts` (12)
- [x] 404 hides existence (outsider body identical to a missing id), 403 only for visible-but-not-yours. Evidence: access "outsider 404 everywhere"
- [x] Runs private to runner (even owner/admin), CSV download formula-escaped with attachment + nosniff. Evidence: access "keeps runs and result downloads private"
- [x] Versions immutable, forks independent, unshare → 404 while the copy runs with hidden attribution. Evidence: access + demo-loop 8–10
- [x] DB triggers verified directly (versions, identity, pointer, final runs, append-only events, sequential/owner-only versions, json_valid). Evidence: access "enforces the invariants in the database itself"
- [x] Activity feed filtered: fork announced to the source owner without the copy's title/id; runs only to the runner. Evidence: demo-loop 11
- [x] Seed includes labelled examples: "Paid revenue by sales rep" (Vikram, Sales, team) and "Live spend by channel" (Olivia, Marketing). Evidence: access "isolates workspaces"

## In progress
- Phase 4: core UI

## Next steps (ordered)
1. Full shell (nav groups, AI status pill, ⌘K search, New recipe button)
2. Library (`/library?tab=&q=`), recipe cards
3. Editor (`/workflows/new`, `/w/$id/edit`): 5 sections, step cards, parameters, live validity, columns-through-pipeline, Advanced JSON
4. Recipe detail (`/w/$id?v=&run=`): header/version picker, recipe card, run panel (drop zone, header pre-check, parameters + reset), result (summary, funnel, TanStack Table v9, CSV), my runs, who-has-access
5. Screenshot review in light/dark

## Decisions log
| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-09-26 | Own git repo in `Flowpilot/` | Folder sat inside an unrelated Desktop-level repo (Java coursework) | Committing into the Desktop repo |
| 2026-09-26 | Brief truncated mid-section 11; sections 11 (rest)–19 reconstructed from the system design PDF | PDF describes the finished system (routes, tests, limits, failure modes) | Stopping to ask |
| 2026-09-26 | TypeScript 6.0 (JS) for `tsc --noEmit` | npm `latest` is TS 7 (native); TanStack's own example pins TS 6 for tooling compatibility | TS 7 |
| 2026-09-26 | Vitest 4.1 (npm resolved it) | Vitest 5 lists Node 22/24/26 engines, not 25 | Forcing Vitest 5 |
| 2026-09-26 | No `src/start.ts` CSRF middleware | Only two read-only GET server functions exist; all writes go through /api with its own origin check | Global request middleware |
| 2026-09-26 | Server functions only for session + login info; everything else is REST via `/api/$` | Brief: one dispatcher; tests call `handleApi(Request)` | Server functions per feature |
| 2026-09-26 | Client data via TanStack Query `useQuery` (no SSR prefetch) | Brief: QueryClient via router context + `Wrap`; SSR renders shell, data loads client-side | ssr-query integration |
| 2026-09-26 | Cookie `fp_session` (+Secure on HTTPS) instead of `__Host-` prefix | `__Host-` requires Secure, which breaks plain http://localhost | `__Host-fp_session` |
| 2026-09-26 | Import protection denies `src/server/**` in the client bundle | Build fails if DB/session/model code leaks to the browser | Marker imports |
| 2026-09-26 | Text cells are trimmed; amounts must match `^\d+$` after trim | Stray spaces from spreadsheet exports otherwise break exact matching; amounts stay strict | Keeping raw whitespace |
| 2026-09-26 | Fully blank rows (all fields empty) are skipped | They carry no data; brief says skip blank lines | Treating `,,,,` as a bad row |
| 2026-09-26 | Escaped export cells are quoted (`"'=A1"`) | Papa Parse 5.7 behaviour; still neutralises formulas | — |
| 2026-09-26 | Names `__proto__`/`constructor`/`prototype` rejected for columns, aliases, parameters | Rows are plain objects keyed by these names | Null-prototype rows |
| 2026-09-26 | Create bodies strip unknown keys (identity fields ignored); PATCH bodies are strict (422) | Brief: "ignored on create and rejected on update" | Strict everywhere |
| 2026-09-26 | New recipes go to the caller's first workspace where they are admin/member | Workspace comes from the session, never the body | `workspaceId` in body |
| 2026-09-26 | Fork allowed = can view AND role admin/member (owner included) | Matrix: viewers can't copy; a copy is a new recipe in the workspace | Owner always allowed |
| 2026-09-26 | Extra DB triggers beyond the brief: versions numbered sequentially + only by the owner; runs must start `running` and pin a version of their own recipe; runs keep version/runner/parameters | Cheap, and makes crafted writes impossible below the API | — |
| 2026-09-26 | "Library team" tab includes my own shared recipes | Team library = what the team sees | Excluding mine |
| 2026-09-26 | Access-matrix workspace rows (create, roles) don't change with recipe visibility | They are workspace permissions, not recipe permissions | Showing 404 for them on private |
| 2026-09-26 | Dashboard day buckets are UTC | Server-side aggregation; prototype | Per-user time zones |

## Deviations from the brief
- (none yet)

## Known issues / bugs
- CSV line numbers count records (header = line 1); a quoted field containing a newline would shift later line numbers. Low severity; documented.
- Build prints rolldown "use client" directive warnings from lucide-react. Harmless.

## How to run
- Install: `npm install` (Node 22+; developed on Node 25.3)
- Dev: `npm run dev` (predev seeds `./data/flowpilot.db` if empty) → http://localhost:3000
- Seed / reset: `npm run seed` / `npm run seed:reset`
- Test: `npm test` · Typecheck: `npm run typecheck` · E2E: `npm run test:e2e` (phase 8)
- Build / start: `npm run build` → `npm start` (Nitro output, `node .output/server/index.mjs`)
- Screenshots: `npx tsx scripts/screenshots.ts --as asha --theme both / /library`

## Environment variables (names only)
DATABASE_PATH, SEED_PASSWORD, MODEL_PROVIDER, MODEL_NAME, ANTHROPIC_API_KEY, OPENAI_API_KEY

## File map
- `src/server/migrations.ts`: schema + invariant triggers · `db.ts`: connection, migrate, `useDatabase` for tests
- `src/server/auth.ts`: scrypt, sessions, cookie, login throttle · `http.ts`: ApiError, JSON/body helpers
- `src/server/api/router.ts`: `handleApi` dispatcher (route match → origin → session → handler → errors) · `api/auth.ts`: login/logout/me
- `src/server/seed.ts` + `scripts/seed.ts`: demo data · `src/server/ai/config.ts`: model env config (no keys leave the server)
- `src/lib/session.ts`: server functions for the `_app` guard and login page · `lib/api.ts`: fetch wrapper + query keys · `lib/types.ts`: shared types · `lib/demo.ts`: demo people
- `src/routes/`: `__root.tsx` (document, theme script), `login.tsx`, `_app.tsx` (guard + shell), `_app/index.tsx`, `api/$.ts`
- `src/components/`: `ui.tsx` (Button, Badge, Card, Dialog, Callout, Field, Avatar…), `shell.tsx`, `toast.tsx`, `states.tsx`, `logo.tsx`, `theme.ts`
- `src/lib/workflow/`: `schema.ts` (contract, LIMITS, Zod) · `validate.ts` (validateDefinition, analyze, resolveParameters) · `execute.ts` (engine) · `describe.ts` (INR, plain-language steps, summary) · `examples.ts` (demo + seed definitions)
- `src/lib/csv.ts`: parseTable, parseForContract, checkAmount, inferColumns, toCsv
- `fixtures/`: sales_A/B + invalid files · `public/samples/`: downloadable demo CSVs · `tests/helpers/fixtures.ts`
- `src/lib/policy.ts`: pure access policy + matrix
- `src/server/repo.ts`: access-aware queries, create/save/fork transactions, runs, stale reaper · `events.ts`: audit log + filtered feed
- `src/server/api/`: `workflows.ts`, `runs.ts`, `workspace.ts`, `dashboard.ts`, `system.ts` (+ `auth.ts`, `router.ts`)
- `tests/helpers/app.ts`: in-memory app + cookie-keeping client calling `handleApi`
- `scripts/screenshots.ts`: Playwright screenshot helper

## Demo checklist
- [ ] Asha creates & shares · [ ] Vikram reruns · [ ] Vikram forks · [ ] Asha's original unchanged · [ ] Meera/Olivia blocked

## Open questions for the owner
- Sections 11 (after "Governance: Access") to 19 of the brief were cut off by the paste limit. The default I took meanwhile: follow the system design PDF for those parts, with 8 phases: 1 scaffold · 2 deterministic core · 3 API + access · 4 core UI · 5 AI authoring · 6 sharing/governance UI · 7 dashboard, runs, system design · 8 hardening, e2e, README.
