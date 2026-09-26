# FlowPilot: context
_Last updated: 2026-09-26 12:35 · Phase 6/8 · Access, My runs and OpenRouter done; starting dashboard + system design_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000

## Current status
- Phase: 6 access, runs, OpenRouter. Status: done
- Tests: 77/77 (`npm test`, 2026-09-26: engine 13, csv 12, validator 13, access 19, demo-loop 12, ai 8). Typecheck: pass. Build: pass (phase 1)
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

- [x] Shell: dark sidebar (workspace card + role, New recipe, nav, AI status pill, user + sign out), sticky top bar (⌘K palette, theme toggle, New recipe), mobile drawer. Evidence: screenshots reviewed in session
- [x] Library `/library?tab=&q=` (Zod validateSearch, debounced search in URL, tab counts, recipe cards with badges/columns/attribution, Run + Make a copy). Evidence: screenshot as Vikram
- [x] Editor `/workflows/new` + `/w/$id/edit`: 5 sections, sample CSV parsed in browser, column checklist, step cards with per-step available columns, "Make adjustable", parameters, live validity, columns-through-the-pipeline, Advanced JSON (validated before applying), unsaved-changes guard. Evidence: Playwright walkthrough created "Regional revenue exceptions" through the UI
- [x] Recipe detail `/w/$id?v=&run=`: version picker + "Version N (latest is M)" banner, recipe card, run panel (drop zone, header pre-check, parameters with reset), result (summary chips, TanStack Table v9 sorting, rows-through-each-step funnel, CSV download, "No rows matched"), my runs + Delete my results, who has access. Evidence: walkthrough ran sales_A → South ₹40,000 / West ₹70,000 in Chromium; light/dark/390px screenshots
- [x] Share dialog (visibility + version-pinned link) and fork dialog (title, version, then opens the copy in the editor). Evidence: typecheck; exercised end-to-end in phase 8 e2e

- [x] `POST /api/generate` (20th endpoint): flat strict output schema; Anthropic forced `submit_recipe` tool call or OpenAI `json_schema` strict; author's contract wraps model steps; full validation; exactly one repair (Anthropic `tool_result` `is_error: true`); 422 DRAFT_INVALID with draft; 503 MODEL_UNAVAILABLE (no key, provider error, 20 s timeout); never writes. Evidence: `tests/ai.test.ts` (8)
- [x] Editor Generate flow: AI draft badges, unsupported/clarification/invalid/unavailable callouts. Evidence: Chromium run against `tests/e2e/mock-model.ts` (unsupported callout for Gmail; 3 generated step cards for the demo sentence)
- [x] Run path never imports the model client. Evidence: ai suite static import check + run with fetch stubbed to throw
- [x] `npm run check:model` reports configuration (currently: not configured)

- [x] `/access`: permission matrix rendered from `permissionMatrix()` (Team/Private toggle, 403/404 cells with reasons, "you" column), members with role dropdowns for admins (self and last admin locked), one-click share/unshare with link copy, six principles. Evidence: screenshot as Asha
- [x] `/runs`: all my runs, status filter in URL, sortable Table v9, per-run CSV, "Delete all my results" with confirm. Evidence: screenshot as Asha
- [x] OpenRouter provider (owner supplied a key, stored only in git-ignored `.env`): OpenAI-compatible call, strict json_schema, `provider.require_parameters: true`, `X-Title`. Evidence: `tests/ai.test.ts` "uses strict json_schema for OpenAI and for OpenRouter"; live `npm run check:model` → valid 3-step demo recipe from `anthropic/claude-sonnet-5` (first try, no repair)
- [x] Live model comparison via OpenRouter (1 run each, 2026-09-26): claude-sonnet-5 demo 5.7 s / Gmail 2.4 s / ambiguous 3.7 s; gpt-6-luna 3.1 / 2.1 / 2.2 s; gemini-3.8-flash 14.7 / 4.6 / 4.3 s. All nine answers correct (workflow / unsupported / clarification), no repairs

## In progress
- Phase 7: dashboard, system design page, polish

## Next steps (ordered)
1. Dashboard: greeting hero, reuse-loop checklist, 4 stat tiles, 14-day stacked run chart (load dataviz skill first), recent runs, permission-filtered activity, System Design teaser
2. `/system-design`: interactive architecture diagram (both / authoring / execution), request lifecycle, versioning diagram, live schema + triggers from /api/system, limits, failure modes, scaling path, trade-offs
3. Nav + palette entries; visual pass in light/dark/mobile

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
| 2026-09-26 | Sample-CSV column checklist unchecks id-like columns (`order_id`) by default | The demo contract ignores order_id; authors can re-check it | All checked |
| 2026-09-26 | After "Make a copy" the app opens the copy in the editor | Demo: copy → change groupBy → save → run | Opening the copy's detail page |
| 2026-09-26 | Editor Save in edit mode = POST versions, then PATCH title/description only if changed | Versions hold definitions; title/description are recipe metadata | Versioning metadata |
| 2026-09-26 | Model reply parsed leniently (nullish fields, extra keys stripped); the built definition is validated strictly | Avoids wasting the single repair on harmless omissions (Anthropic tool input isn't strict-mode) | Strict parse of the reply |
| 2026-09-26 | Literal values are placed by tracked column type (e.g. "100000" as text for an amount becomes 100000) | Fewer needless repairs; still validated | Trusting the model's slot choice |
| 2026-09-26 | OpenAI default model `gpt-5` | Needs a default; override with MODEL_NAME | — |
| 2026-09-26 | OpenRouter default model `anthropic/claude-sonnet-5` | Matches the brief's intended model; correct on all live checks | `openai/gpt-6-luna` (faster/cheaper, offered as the budget option) |
| 2026-09-26 | Tests never load `.env` (skipped under VITEST) | A developer's real key must never reach the test process | Relying on per-test env stubs only |

## Deviations from the brief
- Added optional `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `OPENROUTER_BASE_URL` (defaults: the public APIs) · the browser e2e test needs a local mock model because the model call is server-side · no change when unset
- Added a third provider, OpenRouter (`OPENROUTER_API_KEY`, `MODEL_PROVIDER=openrouter`) · owner asked for it and supplied a key · Anthropic and OpenAI adapters unchanged

## Known issues / bugs
- Fixed in phase 4: the editor's unsaved-changes blocker read stale state and prompted after a successful save (found by the Playwright walkthrough).
- Fixed in phase 4: single-column grids overflowed at 390px (added `grid-cols-1`).
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
DATABASE_PATH, SEED_PASSWORD, MODEL_PROVIDER, MODEL_NAME, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY (+ optional ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL). A local `.env` (git-ignored) currently sets MODEL_PROVIDER=openrouter and OPENROUTER_API_KEY.

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
- `src/lib/workflow/draft.ts`: editor draft model ↔ definition (incl. lenient loader for invalid model drafts) · `src/lib/format.ts`
- `src/components/`: `editor.tsx`, `results.tsx` (Table v9 grid + funnel), `workflow-bits.tsx` (badges, chips, step list, recipe card), `file-drop.tsx`, `share-dialog.tsx`, `fork-dialog.tsx`, `access-panel.tsx`, `command.tsx` (⌘K)
- `src/routes/_app/`: `library.tsx`, `workflows.new.tsx`, `w.$workflowId.index.tsx`, `w.$workflowId.edit.tsx`, `access.tsx`, `runs.tsx`
- `src/server/ai/generate.ts`: prompt, output schema, provider adapters, repair loop · `src/server/api/generate.ts`: endpoint · `scripts/check-model.ts`
- `tests/e2e/mock-model.ts`: stand-in Anthropic endpoint for browser tests only
- `scripts/screenshots.ts`: Playwright screenshot helper

## Demo checklist
- [ ] Asha creates & shares · [ ] Vikram reruns · [ ] Vikram forks · [ ] Asha's original unchanged · [ ] Meera/Olivia blocked

## Open questions for the owner
- Which OpenRouter model to use long-term? Default meanwhile: `anthropic/claude-sonnet-5` (set `MODEL_NAME` to switch; `openai/gpt-6-luna` was fastest and cheapest in the live comparison). The owner should rotate the OpenRouter key after the project, since it was shared in chat.
- Sections 11 (after "Governance: Access") to 19 of the brief were cut off by the paste limit. The default I took meanwhile: follow the system design PDF for those parts, with 8 phases: 1 scaffold · 2 deterministic core · 3 API + access · 4 core UI · 5 AI authoring · 6 sharing/governance UI · 7 dashboard, runs, system design · 8 hardening, e2e, README.
