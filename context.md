# FlowPilot: context
_Last updated: 2026-09-26 17:40 · Phase 11 (accounts and teams) · Complete: sign-up, invites, resets, account settings, workspaces; 114 unit + 24 browser tests green. Next: phase 12 (recipe language v2, archive, audit log)_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork. AI drafts; a deterministic server executes; one access policy guards every request.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000 (demo password `flowpilot-demo`)

## Current status
- Phase: 11 accounts and teams (owner: "not MVP/demo: add login, sign-in, register; make it useful for companies; then deploy"). Status: done
- Tests: 114/114 (`npm test`: engine 13, csv 18, validator 13, access 20, demo-loop 12, ai 9, hardening 12, accounts 17) · Browser 24/24 (`npm run test:e2e`: demo 4, features 13, accounts 5, a11y 2) · Model eval 14/14 (phase 9; AI code unchanged since) · Typecheck: pass (also --noUnusedLocals/--noUnusedParameters)
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
- [x] All 21 REST endpoints behind one dispatcher `handleApi(Request)` (route → origin → session → handler → errors); HEAD/OPTIONS/405 on every path. Evidence: access (20) + demo-loop (12) + ai (9) + hardening (12) suites
- [x] 404 hides existence; 403 only for visible-but-not-yours; runs private to the runner; unshare → 404 while copies keep running with hidden attribution. Evidence: access suite
- [x] Activity feed tells a source owner about a copy without revealing it. Evidence: demo-loop 11; e2e test 3
- [x] AI authoring: flat strict schema, Anthropic forced tool call / OpenAI + OpenRouter strict json_schema, one repair, 422 DRAFT_INVALID with draft, 503 MODEL_UNAVAILABLE, never writes; run path never imports the model client. Evidence: `tests/ai.test.ts` (9)
- [x] OpenRouter live: `npm run check:model` and the production server both produced a valid demo recipe from `anthropic/claude-sonnet-5` on the first try (7.6 s through prod), then saved and ran it (South ₹40,000 · West ₹70,000). Model comparison in README

UI (evidence screenshots in `docs/screenshots/`)
- [x] Login with one-click demo accounts; controls disabled until hydrated; form is POST. Evidence: `00-login.png`, e2e sign-ins
- [x] Shell: sidebar (workspace + role, New recipe, nav, AI status pill, user), top bar (⌘K palette, theme, New recipe), mobile drawer
- [x] Editor: sample CSV read in the browser, column checklist, AI draft with badges, step cards with per-step columns, Make adjustable, parameters, live validity, columns through the pipeline, Advanced JSON, unsaved-changes guard. Evidence: `01-editor-ai-draft.png`
- [x] Recipe page: version picker + "latest is M" banner, run panel with header pre-check and parameter reset, results (summary chips, Table v9 sorting, funnel, CSV), my runs + delete, who has access, share + copy dialogs. Evidence: `02`–`05`
- [x] Library, My runs, Access (matrix from `policy.ts`, roles, one-click sharing, principles), Dashboard (checklist, stats, validated run chart with table view, activity), System design (interactive diagrams, live schema). Evidence: `06`, `08`, `09`, `10-dashboard-dark.png`
- [x] No horizontal overflow at 390px on the main pages; light and dark themes

Phase 11: accounts and teams (evidence: `tests/accounts.test.ts` 17, `tests/e2e/accounts.spec.ts` 5, a11y scans of the new pages)
- [x] Sign-up (`/signup`): account + workspace (you're admin), or join through an invite; `REGISTRATION` open / invite-only / closed; shared password rules (≥10 chars, not common, not your email) with a strength meter; 20 sign-ups/hour/address
- [x] Invitations: admins create links (role, optional email lock → single use; else 25 uses), 7-day expiry, revoke, hash-only storage, emailed when mail is configured; `/invite/$token` landing (sign up, sign in, join, wrong-account and already-member states)
- [x] Password reset: `/forgot-password` (same answer for every email, mail sent without awaiting so timing can't tell), single-use 1-hour links, signs out every device; Resend or server-log mailer (`src/server/mail.ts`)
- [x] Account settings (`/account`): name, password change (needs current; signs out other devices; throttled like sign-in), signed-in devices + "sign out everywhere else", workspaces (switch, create, leave)
- [x] Workspaces: per-session current workspace (switcher in the sidebar; create from there); lists, dashboard, activity, Access page and new recipes follow it
- [x] People: admins rename the workspace and remove members; leaving/removal hands recipes to an admin (migration 3 trigger allows owner changes only to an admin/member of the workspace); owners can transfer a recipe (`POST /api/workflows/:id/transfer`)
- [x] Login throttle per email+address (10), per email (50), per address (100): one attacker can't lock someone out
- [x] Demo mode: demo accounts only when `DEMO_MODE` (default on in dev, off in prod; prod seeds an empty DB on first request); demo accounts can't change password/name, invite, join or leave (`users.is_demo`)
- [x] New-workspace onboarding: "Invite your team" step for admins, no-workspace dashboard with "Create a workspace"
- [x] Fixed while testing: version switch to an uncached version remounted the run panel and dropped the chosen file (now keeps the page via placeholderData, Run disabled mid-switch); the greeting flickered "Welcome back"→"Welcome" (now a steady "Welcome, name")

Phase 10: second evaluation, 17 findings fixed (evidence: `tests/hardening.test.ts`, `tests/csv.test.ts`, last 5 tests of `tests/e2e/features.spec.ts`; each unit test was checked to fail against the old code)
- [x] Run panel kept a stale header check after a version switch ("region found" for a file without it; server then 422) → check tagged with its version, re-run on switch, file kept
- [x] CSV: non-UTF-8 files (Windows Excel "CSV") silently became "Montr�al" → rejected with line + Save-As fix; UTF-16 named; semicolon/tab files named instead of "missing every column"; empty trailing header explained; near-miss headers ("the file has "Status"") in server + browser messages
- [x] Activity feed went empty once 400 newer events were teammates' private runs → privacy rules in SQL + batched scan (≤2,000 rows); deleted runs no longer linked ("(result deleted)")
- [x] Library returned every recipe (919 KiB, 6,009 statements at 1,500 recipes) → `limit/offset/total/nextOffset`, 60 per page + Show more; palette asks for 7 (now 37 KiB, 2.9 ms)
- [x] My runs capped at 500 with counts from the capped list → server-side `status` filter + exact `counts`; note when capped
- [x] PUT/OPTIONS on /api/* returned the HTML app (200); HEAD returned 405 → `ANY` handler; HEAD = GET without body, OPTIONS 204 + Allow, others 405
- [x] Malformed %-encoding in an id threw (500 via handleApi) → 404
- [x] Login redirect with a tab/newline ("/%09/evil") crashed the page (500) → control characters refused (`src/lib/redirect.ts`)
- [x] Phone width: recipe page scrolled sideways (525 px): sr-only cell labels escaped `overflow-x-auto` (containing block was body) → `relative` on every table scroller
- [x] Unknown URL while signed in lost the app shell → `_app/$` splat route is its own not-found boundary (404, sidebar kept)
- [x] Expired sessions never purged; re-login kept the old session → purge on sign-in (+ index, migration 2), previous session deleted
- [x] No-op PATCH bumped updated_at (reordered the library) → only real changes written/logged
- [x] Library search box could overwrite typing when its own URL update landed → tracks the last pushed value
- [x] Dead code (2 unused React imports, an unused variable, an unused test binding) → removed; strict unused check passes
- Checked and fine: console clean on every page in both themes; session end mid-use and Back after sign-out; email lookup is case-insensitive (COLLATE NOCASE); no 5xx in a 70-case hostile-input probe; prod 400 bodies carry no stack traces

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
- Nothing mid-change. Owner's remaining asks: company-grade features, every endpoint and error smoke-tested, a stronger system design, then deployment.

## Next steps (ordered)
1. Phase 12: recipe language v2 (count/avg/min/max, sort, top N, column select/rename, more filter operators), archive recipes, admin audit log
2. Phase 13: `npm run smoke` against any URL (every endpoint and error code); system design page + docs upgrade
3. Phase 14: deploy (recommended: Fly.io, Mumbai region, SQLite on a volume); needs the owner's account login
4. Owner: rotate the OpenRouter key that was shared in chat

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
| 2026-09-26 | Defaults: `claude-sonnet-5` (Anthropic), `gpt-5` (OpenAI); OpenRouter later changed to `openai/gpt-6-luna` (row below) | Brief's intended model; overridable with MODEL_NAME | — |
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
| 2026-09-26 | Reject non-UTF-8 CSV bytes (fatal decoding) with a Save-As fix | Silent "�" breaks filters and grouping; "nothing is guessed" like amounts | Guessing Windows-1252 |
| 2026-09-26 | Headers still match exactly; near misses are only named in the message | Column names may legally differ by case; no silent renaming | Case-insensitive matching |
| 2026-09-26 | Empty headers stay rejected (brief), but a trailing one explains the stray comma | Brief: "reject empty or duplicate headers" | Dropping empty trailing columns |
| 2026-09-26 | Lists page: recipes 60 (max 200) with offset; runs ≤500 with exact per-status counts | Payload and render cost grew with every recipe | Returning everything |
| 2026-09-26 | Activity privacy rules in SQL, then batched per-row checks (≤2,000 rows) | A fixed 400-row window starved busy workspaces | Bigger fixed window |
| 2026-09-26 | `/api/$` uses one `ANY` handler; dispatcher answers HEAD/OPTIONS/405 | Unlisted methods fell through to the SSR page | Listing every method |
| 2026-09-26 | Unknown app URLs: `_app/$` splat is its own not-found boundary | A boundary on `_app` replaces the shell itself | Root-only 404 |
| 2026-09-26 | Tables scroll inside a `relative` wrapper | sr-only labels are absolutely positioned; without a containing block they widen the page | `min-w-0` on grid items (tested: not the cause) |
| 2026-09-26 | Commits end with a Co-Authored-By trailer from phase 10 on | Current tool guidance; the brief fixes only the subject format | — |
| 2026-09-26 | Current workspace stored per session (`sessions.workspace_id`); new recipes go there | Brief: workspace from the session, never the body; per-device choice | `workspaceId` in request bodies; per-user setting |
| 2026-09-26 | Lists, dashboard, activity and Access scoped to the current workspace; recipe URLs still open across your workspaces | Company tools separate teams; links keep working | Mixing all workspaces in one library |
| 2026-09-26 | Recipes change owner only to an admin/member of their workspace (trigger); leaving/removal hands them to an admin | Company data must outlive employees; triggers still block everything else | Orphaned private recipes |
| 2026-09-26 | Invite/reset tokens hashed like sessions; invite links shown once | A database leak must not let anyone join or take over accounts | Plaintext tokens (re-copyable) |
| 2026-09-26 | Email through Resend's HTTP API, else logged to the server | No SDK or SMTP dependency; self-hosting still works | SMTP |
| 2026-09-26 | Sign-up reveals a taken email (409); forgot-password never does | Standard trade-off; the throttles bound enumeration | Silent sign-up failure |
| 2026-09-26 | Login throttle keyed three ways (email+address, email, address) | Per-email only let anyone lock an account for 10 minutes | Per-address only (distributed guessing) |
| 2026-09-26 | `DEMO_MODE` default on in dev, off in prod; demo users flagged `is_demo` and locked | A public demo must not be hijackable; production has no demo accounts by default | Removing demo accounts |
| 2026-09-26 | Admin-issued password resets not offered | An admin of one workspace could take over a member's other workspaces | Admin reset links |

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
- Fixed in phase 10: see "Phase 10" under Done (17 items)
- Open (low): sign-in, sign-up, reset and drafting limits are in memory (reset on restart, not shared across servers) · documented
- Open (low): no SSO, 2FA or email verification; accounts can't be deleted from the UI · documented
- By design: CSV line numbers count records (= spreadsheet row numbers); only in a text editor does a quoted newline shift them · documented
- Open (cosmetic): build prints rolldown "use client" warnings from lucide-react; npm warns that Vitest's engines omit Node 25 (tests pass)
- Open (cosmetic): react-hooks lint (not installed in the repo) flags 10 intentional client-only effects (hydration flag, theme, platform, dialog resets); reviewed, no bug (the fork dialog reset was probed in a browser: no reset on refetch)

## How to run
- Install: `npm install` (Node 22+; built on Node 25.3) · E2E browser once: `npx playwright install chromium`
- Dev: `npm run dev` (predev seeds `./data/flowpilot.db` if empty) → http://localhost:3000
- Seed / reset: `npm run seed` / `npm run seed:reset`
- Test: `npm test` · E2E: `npm run test:e2e` · Typecheck: `npm run typecheck`
- Build / start: `npm run build` → `npm start`
- AI: put keys in `.env` (see `.env.example`), then `npm run check:model` and `npm run eval:model`
- Screenshots: `npx tsx scripts/screenshots.ts --as asha --theme both / /library` (dev server running)

## Environment variables (names only)
DATABASE_PATH, SEED_PASSWORD, DEMO_MODE, REGISTRATION, APP_URL, TRUST_PROXY, RESEND_API_KEY, MAIL_FROM, MODEL_PROVIDER, MODEL_NAME, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY (+ optional ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL). The local git-ignored `.env` sets MODEL_PROVIDER=openrouter and OPENROUTER_API_KEY.

## File map
- `src/lib/workflow/`: `schema.ts` (contract, LIMITS) · `validate.ts` (validateDefinition, analyze, resolveParameters) · `execute.ts` (engine) · `describe.ts` (INR, steps, summary) · `draft.ts` (editor model) · `examples.ts`
- `src/lib/`: `csv.ts` · `policy.ts` (pure access policy + matrix) · `account.ts` (name/email/password rules) · `api.ts` (client + query keys) · `types.ts` · `format.ts` · `session.ts` (server fns) · `demo.ts` · `redirect.ts` (safe post-login paths)
- `src/server/`: `migrations.ts` (schema + triggers, 3 migrations) · `db.ts` · `auth.ts` (sessions, throttle) · `accounts.ts` (users, workspaces, invites, resets) · `repo.ts` (access-aware queries, stale reaper) · `events.ts` (audit + feed) · `config.ts` (env settings, client address) · `mail.ts` · `boot.ts` (first-request setup) · `seed.ts` · `http.ts` · `env.ts` · `ids.ts`
- `src/server/api/`: `router.ts` (dispatcher, 40 routes) · `auth.ts` · `account.ts` (register, resets, me, workspaces) · `invites.ts` · `workflows.ts` · `runs.ts` · `generate.ts` · `workspace.ts` · `dashboard.ts` · `system.ts`
- `src/server/ai/`: `config.ts` (providers, env) · `generate.ts` (prompt, schema, adapters, repair loop)
- `src/routes/`: `__root.tsx` · `login.tsx` · `signup.tsx` · `invite.$token.tsx` · `forgot-password.tsx` · `reset-password.$token.tsx` · `_app.tsx` (guard + shell) · `_app/{index,library,runs,access,account,system-design,workflows.new,w.$workflowId.index,w.$workflowId.edit}.tsx` · `_app/$.tsx` (in-app 404) · `api/$.ts`
- `src/components/`: `ui.tsx` (incl. `Menu`) · `shell.tsx` (workspace switcher, create-workspace dialog) · `auth-layout.tsx` (sign-in pages layout, password input) · `command.tsx` · `editor.tsx` · `results.tsx` · `charts.tsx` · `workflow-bits.tsx` · `file-drop.tsx` · `share-dialog.tsx` · `fork-dialog.tsx` · `access-panel.tsx` · `states.tsx` · `toast.tsx` · `logo.tsx` · `theme.ts` · `diagrams/{architecture,versioning}.tsx`
- `src/start.ts`: global request middleware (security headers, server-fn CSRF)
- `tests/`: 8 Vitest suites (incl. `hardening.test.ts`, `accounts.test.ts`) + `helpers/` · `tests/e2e/`: `demo.spec.ts`, `features.spec.ts`, `accounts.spec.ts`, `a11y.spec.ts`, `mock-model.ts` · `playwright.config.ts`
- `scripts/`: `seed.ts`, `check-model.ts`, `eval-model.ts`, `screenshots.ts` · `fixtures/`, `public/samples/`, `docs/screenshots/`
- `src/lib/samples.ts` (sample catalogue) · `src/server/ratelimit.ts` (drafting limits)

## Demo checklist
- [x] Asha creates & shares (e2e test 1) · [x] Vikram reruns (e2e test 2) · [x] Vikram forks (e2e test 2) · [x] Asha's original unchanged (e2e test 3) · [x] Meera/Olivia blocked (e2e test 4)

## Open questions for the owner
- Please rotate the OpenRouter key that was shared in chat (the local `.env` needs the new value afterwards).
- The brief was cut off after section 11 ("Governance: Access"). If sections 12–19 hold requirements beyond the system design PDF, share them and they can be checked against this build.
