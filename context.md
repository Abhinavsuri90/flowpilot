# FlowPilot: context
_Last updated: 2026-09-27 · Phase 20 (senior pass) done: lint clean, CI workflow, error boundary, screenshots reviewed, production image re-verified (smoke 78/78 in the container) · Ready for the owner to test and to deploy on Oracle Cloud Always Free (kit in `deploy/oracle/`)_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork. AI drafts; a deterministic server executes; one access policy guards every request.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000 (demo password `flowpilot-demo`)

## Current status
- Phase: 20 done. Nothing in progress; the owner tests next, then deploys (`deploy/oracle/README.md`)
- Tests: 164/164 (`npm test`: engine 13, csv 18, validator 13, access 20, demo-loop 12, ai 12, hardening 15, accounts 17, language 14, governance 4, spreadsheet 8, dates 11, templates 3, tokens 4) · Browser 31/31 (`npm run test:e2e`: demo 4, features 19, accounts 6, a11y 2) · Smoke 78/78 checks over all 45 endpoints (`npm run smoke`, local dev and the production container) · Lint: clean (`npm run lint`) · `npm audit`: 0 vulnerabilities · Model eval 28/28 (median 3.6 s) · Typecheck: pass (strict unused) · Build: pass
- App runs with: `npm install && npm run dev` → http://localhost:3000

## Done (with evidence)
Phase 20: senior pass (evidence: `npm run lint` clean; `npm audit` 0 vulnerabilities (prod and dev); typecheck; 164/164; 31/31 browser incl. palette, theme, drawer, share/fork/JSON dialogs and invite sign-up after the hook refactors; `docker build` + container on :3456 → 5 migrations, `/` → 307 `/welcome`, smoke 78/78; six screenshots taken by `scripts/screenshots-features.ts` and looked at; an overflow probe of the editor with relative-date filters at 1440/1024/390 px: page width = viewport)
- [x] ESLint flat config (`eslint.config.js`: `@eslint/js` recommended, typescript-eslint recommended, `eslint-plugin-react-hooks` recommended) + `npm run lint`; 19 findings fixed properly: `useHydrated`, `useTheme` and the ⌘/Ctrl label now use `useSyncExternalStore` (SSR snapshot + client snapshot) instead of set-state-in-effect; the palette reset, drawer close, JSON/share/fork dialog resets and the invite email fill use React's adjust-state-during-render pattern; the editor's dirty ref is copied in an effect; `useDatabase` → `setDatabase` (it isn't a hook); two `no-control-regex` exceptions documented inline
- [x] `.github/workflows/ci.yml`: typecheck + lint + unit + build, the browser suite with artifacts on failure, and the production image built, started and smoke-tested. Not yet run on GitHub (the repo isn't pushed): written to mirror the local commands exactly
- [x] Root `errorComponent` (`ErrorState` with retry) so a render error never leaves a blank page
- [x] The result card shows the run day as "as of 27 Sep 2026" instead of `as_of = "2026-09-27"`
- [x] `scripts/screenshots-features.ts` (landing, templates, date filter editor, chart, Excel sheet picker, API token dialog) → `docs/screenshots/11–16`, embedded in a README "Screenshots" section
- [x] Probed, not a bug: the Run button looked disabled in a screenshot after switching workbook sheets; it is enabled from 0 ms (hover styling)

Phase 19: personal API tokens (evidence: `tests/tokens.test.ts` 4; browser test "API tokens: minted once in account settings…"; smoke +7 checks incl. a bearer request with no cookie and no Origin, `403 SESSION_REQUIRED`, revocation → 401; the dev server had to be restarted for migration 5, which the 500s in its log showed)
- [x] Migration 5 `api_tokens` (id, user, name, SHA-256 `token_hash`, `fp_xxxxxxxx` prefix, created/expires/last_used/revoked); `createApiToken` (secret `fp_` + 43 URL-safe chars, returned once), `listApiTokens`, `countActiveApiTokens`, `revokeApiToken`
- [x] `userFromRequest` accepts `Authorization: Bearer fp_…` (unrevoked, unexpired, hash match; `last_used_at` refreshed at most every 5 min; `X-Workspace-Id` picks another workspace you belong to); `SessionUser.via: 'session' | 'token'`
- [x] Routes carry `auth: true | false | 'session'`; 14 account/security/membership routes are session-only (`403 SESSION_REQUIRED` for tokens): me PATCH, password, sessions, workspace switch/create/leave/rename, members, invites, tokens
- [x] `GET/POST /api/me/tokens`, `DELETE /api/me/tokens/:id` (45 endpoints now); demo accounts can't mint; at most 10 active; names ≤ 60; expiry 30/90/365 days
- [x] Account page "API tokens" card: dialog (name, expiry) → secret shown once with Copy and a ready curl line; list with prefix, created/last used/expires, Expired badge, two-click revoke
- [x] README "Automation" section (curl for me, list, run with parameters + asOf, CSV download; X-Workspace-Id; no Origin needed), API rows, security-model rows

Phase 18: templates, result charts, landing page (evidence: `tests/templates.test.ts` 3 (every template validates, matches its sample, runs to hand-computed rows as of 2026-09-27); browser tests "the front door…" and "templates: pick one in the gallery…"; a11y scans incl. `/welcome`; the phone-width test now includes `/welcome`; smoke 71/71)
- [x] `src/lib/workflow/templates.ts`: 10 hand-written templates (regional exceptions, monthly revenue, top reps, large orders since a date with a date parameter, refunds last quarter, weekly orders, average deal by region, paid by rep, lost orders by rep with an `in` list, live spend), each with tags, a request sentence and a sample file
- [x] New recipe page: `TemplateGallery` (tag filter, cards with the first three step descriptions, "Use this template"); loading a template also reads its sample file in the browser so column sample values and hints come along; `?template=<key>` links (library empty state, landing page) load one once (ref guard: React StrictMode ran the effect twice → two toasts)
- [x] Results: `ResultView` = table or a direct-labelled horizontal bar chart (`ResultChart`, brand colour, first 30 rows in the result's own order, figure picker when several number columns, table one click away)
- [x] `/welcome` public landing page (hero, example pipeline, the Describe/Check/Run loop, six feature cards, six template links, sign-in/sign-up CTAs by `REGISTRATION`/`DEMO_MODE`, dashboard link when signed in); signed-out visitors to `/` are redirected there, deeper links still go to `/login?redirect=`
- [x] Fixed while testing: template cards (grid items) could not shrink below their longest step line → New recipe was 722 px wide on a phone (`min-w-0`)

Phase 17: dates in the recipe language (evidence: `tests/dates.test.ts` 11, `tests/ai.test.ts` +2, browser test "dates: the monthly example runs as of a chosen day…", `npm run eval:model` 28/28 incl. 7 date cases on the first run, smoke 71/71)
- [x] Column type `date`: cells read strictly by `src/lib/dates.ts` `checkDate` (ISO with optional time, `3 Apr 2026`, `03-Apr-2026`, `April 3, 2026`, `2026/04/03`, and day/month/year digits only when exactly one reading is a real date; `03/04/2026` is reported with both readings; two-digit years refused); stored as `YYYY-MM-DD` text so text order is calendar order; inferred from samples
- [x] Calendar maths on day numbers (Hinnant's civil algorithms), never on Date objects: `relativeDate` (day / week from Monday / month / quarter / year, start or end, offset), `datePart` (`2026`, `2026-Q3`, `2026-09`, ISO `2026-W39`), leap years and month ends tested
- [x] Filters on dates: fixed literal (`YYYY-MM-DD`), `date` parameters (chosen per run), or `{ relative: { unit, offset, edge } }` counted from the run day; operators read "is before / on or after…"; `contains`/`in` refused; earliest/latest (`min`/`max`) of a date column in summaries; sum/avg refused with a hint
- [x] New step `date_part` (editor label "Period from a date"): adds a text period column beside the others; validator hints ("Add a period from it first, then group by that") when grouping by a raw date
- [x] "As of" day: the run panel sends `asOf` (browser's local day by default, editable); the server validates it, passes it to the engine and the summary (`ordered_on ≥ 30 days ago (28 Aug 2026)`), and stores it as `as_of` beside the run's parameters only when the recipe uses relative dates (`parametersText` → "as of 27 Sep 2026")
- [x] Editor: date column type, date inputs, "Relative to run day" value mode with `[start of] [this|last|next|N ago|N from now] [unit]` and a live "run today, that is 1 Apr 2026" preview, date parameters with date defaults, the period step card
- [x] AI: schema and prompt for date literals, relative dates, date parameters and `date_part`; "dates" removed from the unsupported list, but date requests on a file without a date column are refused ("say the column must be declared as a date"); lenient parse + repair path tested
- [x] Sample `orders_dated.csv` (22 orders Jan–Sep 2026) and seed example "Monthly paid revenue, last six months" (Vikram, Sales); tests that counted seed recipes updated (team count 4, audit CSV 1+6, Sales titles)

Phase 16: Excel in, Excel out (evidence: `tests/spreadsheet.test.ts` 8 on xlsx/xls/xlsb/ods files written by SheetJS; browser test "Excel files: the browser converts the chosen sheet…" incl. the download read back with SheetJS; `npm run build` → `xlsx-*.js` 480 KB is its own chunk, 0 references in the main bundle)
- [x] `src/lib/spreadsheet.ts`: workbooks (`.xlsx .xlsm .xlsb .xls .ods`) become CSV **in the browser** (SheetJS 0.20.3 from the SheetJS CDN tarball, since npm's 0.18.5 has known CVEs; imported lazily): raw numbers (15 significant digits, no separators), ISO dates from the Date's UTC fields (a probe showed SheetJS puts the sheet's own date/time there), TRUE/FALSE, blank rows and empty trailing columns dropped; 4 MB cap; only zip/CFB magic bytes accepted (a CSV renamed .xlsx is refused, SheetJS would otherwise read it as text); reading stops at 10,002 rows; sheet-named errors (empty, over 5,000 rows, over 1 MiB as CSV, password-protected)
- [x] `FileDrop` opens workbooks itself: "Reading the workbook…", sheet picker when there are several (re-converts and re-checks), "converted in your browser; never uploaded" note, inline errors; callers still only ever get a CSV `File` (named after the workbook, so run history shows `sales.xlsx`); server untouched
- [x] Results → **Excel**: `resultWorkbook()` writes real numbers (amounts in Indian grouping `[>=10000000]##\,##\,##\,##0;…`, counts `#,##0`), column widths, an autofilter, text cells never formulas, plus an "About this run" sheet (recipe, version, run time, input file, parameters, summary, rows, link); file name `<slug>-v<N>-<day>.xlsx`
- [x] Fixtures `fixtures/sales_A.xlsx` and `fixtures/sales_two_sheets.xlsx` (cover sheet first) from `scripts/make-fixtures.mjs`; README features/testing, system design page + doc (hostile workbooks row, stack row, integrations)

Phase 15: free hosting kit (evidence: `deploy/oracle` stack built and run on this laptop with `docker compose up --build`; `npm run smoke -- --base https://localhost:8443` 71/71 through Caddy over HTTP/2 with HSTS; 10 failed sign-ins with forged X-Forwarded-For/Fly-Client-IP headers → 429; `backup.sh` produced integrity-checked single-file copies; a recipe created after a backup vanished after the documented restore; hardening tests "client address behind a proxy" ×2, both fail on the old code)
- [x] Hosting research: Fly.io needs a card and bills after a trial of 2 h machine time / 7 days; Render free has no disk; Koyeb free has no volumes; Oracle Cloud Always Free = card for verification only ("will not be charged unless you upgrade"), 2 OCPU / 12 GB Arm, 200 GB disk, 10 TB egress; idle 7-day rule may *stop* (not delete) the VM
- [x] `deploy/oracle/`: `docker-compose.yml` (app + Caddy automatic HTTPS, data in a plain folder), `Caddyfile` (h1/h2, no Server header), `setup.sh` (idempotent: Docker from Ubuntu's archive, iptables/ufw 80+443 persisted in rules.v4, swap on small VMs, first-run settings file with hidden key prompt, build, health wait, cron backup; domain change on rerun), `backup.sh`, `push.sh` (rsync excluding secrets/data + remote setup), `README.md` (console walkthrough, day-to-day table, keeping it free, troubleshooting)
- [x] `scripts/backup-db.mjs`: SQLite online backup API → journal_mode DELETE → integrity_check → keep newest N; shipped in the image and run as `node` inside the container
- [x] `TRUST_PROXY` is now a mode: `true` = last X-Forwarded-For hop (what Caddy/nginx appended), `fly` = Fly-Client-IP, else socket address. Found while building: the old code believed the *first* XFF entry and Fly-Client-IP from anyone, so a client could forge addresses and dodge every rate limit behind a proxy
- [x] `.dockerignore` excludes `deploy/`, `fly.toml` and any nested `.env`; README deployment section rewritten (cost/card table with sources, Oracle first, Fly paid, any Docker host); system design page/doc updated

Foundation
- [x] TanStack Start app; SSR guard redirects signed-out visitors to /login (since phase 18: `/` itself goes to the public `/welcome` page). Evidence: browser test "the front door"
- [x] SQLite schema: 9 tables (incl. `api_tokens`), 13 invariant triggers, 5 migrations in `schema_migrations`. Evidence: `src/server/migrations.ts`; access "enforces the invariants in the database itself"
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

Phase 14: deployment, prepared and verified locally (evidence: `docker build` + `docker run` of the production image; `npm run smoke -- --base http://localhost:3456` 71/71; restart kept all rows; hardening "HSTS" test)
- [x] `Dockerfile` (node:22-bookworm-slim, two stages, `npm ci --ignore-scripts`, 377 MB), `docker-entrypoint.sh` (chowns the volume, drops to uid 1000 via setpriv), `.dockerignore` (no .env, data or .git)
- [x] `fly.toml`: region bom, volume `flowpilot_data` at /data, force_https, /api/health check, auto stop/start, 1 shared CPU / 512 MB, DEMO_MODE + REGISTRATION=open + TRUST_PROXY
- [x] HSTS on HTTPS responses (pages via start.ts middleware, API via the dispatcher); DEMO_MODE seeds an empty production database on first request
- [x] Git history (13 commits) scanned: no key-shaped strings; only README placeholders `sk-or-...`
- [x] Found while testing: npm 10 (Node 22 image) ran `node-gyp rebuild` for better-sqlite3 despite `gypfile: false` → `--ignore-scripts` (prebuilt binaries load at runtime)

Phase 13: governance, smoke test, system design (evidence: `tests/governance.test.ts` 4, features "archives and restores…", a11y scans incl. /audit and archived tab, `npm run smoke` 71/71)
- [x] Archive/restore (owner; `PATCH archived`): out of lists (Archived tab + count), 409 RECIPE_ARCHIVED on run/fork/save, permissions say why, banner + Restore; migration 4 (`archived_at`, indexes)
- [x] Admin audit log (`/audit`, `GET /api/workspace/audit`, `.csv`): categories, actor filter, keyset paging; never lists runs; private recipes the admin can't see stay unnamed; copies never named; admin-only nav item
- [x] `scripts/smoke.ts` (`npm run smoke -- --base <url>`): two throwaway accounts, 71 checks, all 42 endpoints, errors 401/403/404/405/409/413/415/422, security headers; exit code for CI
- [x] System design: new sections (recipe language, identity & teams with flow switcher, security model with evidence, deployment) + refreshed failures/scaling/stack; `docs/system-design.md` with 5 Mermaid diagrams (validated with Mermaid's parser)
- [x] Fixed while testing: tab strips widened the page at 390 px once "Archived" was added (Segmented now scrolls within itself)

Phase 12: recipe language v2 (evidence: `tests/language.test.ts` 14, `tests/ai.test.ts` new-shapes test, `tests/e2e/features.spec.ts` "AI drafts a top-N summary", eval 21/21)
- [x] New steps: `aggregate` (0–3 group columns, 1–5 figures: count/sum/avg/min/max; empty group = one summary row; avg rounded half up with BigInt maths), `sort` (≤3 keys, stable, code-point text), `limit` (literal or parameter, min 1), `select` (order + display-name headers); `group_sum` unchanged (old versions run as before)
- [x] Filter operators `contains` (ignores capitals) and `in` (`{"list": [...]}`); column type `integer` (whole numbers: counts, quantities; CSV-checked like amounts; suggested for qty/units/count-like names)
- [x] One shape rule `lib/workflow/columns.ts` (columnsAfter) shared by engine, descriptions, draft model and AI adapter; validator explains removed/renamed columns ("step s2 summarized the rows…", "step s5 renamed it to…")
- [x] Editor: six step kinds with dedicated cards (figures, sort keys, top N with Make adjustable, column picker with headers/order/Keep all), casing check also for "is one of" lists, pipeline sidebar labels
- [x] AI: strict schema with six step shapes, lenient parse, typed conversion via columnsAfter, prompt rules (group_sum vs aggregate, top N = sort desc + limit, unsupported: dates, percentages); eval set 14 → 21 cases (average/count now supported)
- [x] Parameters show their unit (rupees vs plain number) from how steps use them; runs carry a server-formatted `parametersText`
- [x] Seed example "Top sales reps by paid revenue" (Vikram, Sales) showcasing the new steps

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
- Nothing. The owner tests the app next (`npm install && npm run dev`, or the Docker image), then deploys with `deploy/oracle/push.sh`

## Next steps (ordered)
1. Owner: Oracle Cloud account (card for verification only) → Ubuntu 24.04 A1.Flex VM → security list TCP 80/443 → `deploy/oracle/push.sh ubuntu@<ip>` → `npm run smoke -- --base https://<ip-dashes>.sslip.io` (steps in `deploy/oracle/README.md`)
2. Owner: rotate the OpenRouter key that was shared in chat (enter the new one when `push.sh` asks, or later in the server's `deploy/oracle/.env`)
3. After deploying: `npm run smoke -- --base https://<domain>` and, optionally, `npm run eval:model` with the new key
4. Ideas not built (documented in README limitations): CSP with nonces, SSO/2FA/email verification, scheduled runs with stored inputs, Postgres for many servers
4. Optional, for the resume: a public GitHub repo (`brew install gh`, `gh auth login`, then `gh repo create flowpilot --public --source . --push`)

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
| 2026-09-26 | Keep `group_sum`; add `aggregate` beside it | Saved versions are immutable and must keep running; the model and demo stay stable | Migrating group_sum away |
| 2026-09-26 | Averages rounded half up to whole numbers (exact BigInt maths), stated in the step text | Keeps the integer-only type system and "nothing silently rounded" honest | Decimal column type |
| 2026-09-26 | `contains` ignores capitals; eq/neq/in stay case-sensitive | "Contains" is a search; equality must stay exact and deterministic | Case-insensitive everything |
| 2026-09-26 | Empty summary input gives zero rows (not a row of zeros) | No blanks exist for avg/min/max; "No rows matched" is honest | SQL-style NULL row |
| 2026-09-26 | `select` headers may use spaces and capitals (display names) | Output is for people and spreadsheets | snake_case only |
| 2026-09-26 | Integer parameter unit inferred from use (amount filter → ₹, limit/whole-number filter → plain) | No schema change; old recipes read as before | A unit field on parameters |
| 2026-09-26 | Archive instead of delete; archived = visible but not runnable/copyable/editable; owner-only | Versions and runs must stay reproducible; a mistaken archive is one click to undo | Hard delete; admin archive |
| 2026-09-26 | Audit log excludes runs and hides private titles from admins | Keeps "runs are private" and "private means owner only" true for admins too | Full event dump |
| 2026-09-26 | Smoke test signs up its own throwaway accounts | Works on any deployment without demo data or secrets | Relying on demo accounts |
| 2026-09-26 | Deploy target: Fly.io, region bom (Mumbai), one machine + volume | SQLite needs a persistent disk and a single writer; users are in India; cheap with auto-stop | Render (disk needs a paid plan), Vercel (no persistent disk), Railway (no India region) |
| 2026-09-26 | Container runs as uid 1000; entrypoint chowns the volume then drops privileges | Volumes mount as root; least privilege at runtime | Running as root |
| 2026-09-26 | `npm ci --ignore-scripts` in the image | npm 10 forced a node-gyp build; no dependency needs a script; hermetic builds | Installing python/g++ into the build stage |
| 2026-09-27 | Recommended host: Oracle Cloud Always Free VM + Caddy (kit in `deploy/oracle/`); Fly.io kept as the paid route | Owner: card for verification only, never a charge; Oracle's docs say exactly that; Fly bills after its trial | Render free (no disk), Koyeb free (no volumes), a hosted Postgres refactor |
| 2026-09-27 | `TRUST_PROXY` names the proxy (`true` = last XFF hop, `fly` = Fly-Client-IP) instead of believing any forwarded header | Behind Caddy, a client could forge the first XFF entry or Fly-Client-IP and dodge rate limits | Trusting a list of proxy addresses |
| 2026-09-27 | Backups via SQLite's online backup API into `<data>/backups`, daily by cron, 14 kept, integrity-checked | Copying a live WAL database file can produce a torn copy; the VM has no snapshots | Platform snapshots (none on the free VM), `cp` |
| 2026-09-27 | sslip.io name for the first HTTPS certificate; own domain optional | Let's Encrypt needs a hostname; the IP-based name works without buying anything | IP-address certificates, self-signed |
| 2026-09-27 | Workbooks converted to CSV in the browser; the server stays CSV-only | One input contract, no archive parsing on the server, the workbook never leaves the browser | Server-side xlsx parsing; a hand-written xlsx reader (no .xls, more risk) |
| 2026-09-27 | SheetJS 0.20.3 from cdn.sheetjs.com (URL dependency), loaded lazily | npm's `xlsx` is 0.18.5 with CVE-2023-30533 / CVE-2024-22363; the chunk (480 KB) only loads when a workbook is picked | `xlsx@0.18.5`, exceljs (Node-oriented, heavier) |
| 2026-09-27 | Excel export keeps numbers as numbers and writes text cells only | So Excel can total the results; text is never evaluated as a formula, so no `'` prefix needed | Formatted strings; CSV-only |
| 2026-09-27 | Dates are `YYYY-MM-DD` text in rows; maths on day numbers | Text order = calendar order for sort/min/max; no time zones anywhere; results and CSV/Excel exports stay readable | Day-number integers (needs formatting everywhere); Date objects (time zone drift, as the SheetJS probe showed) |
| 2026-09-27 | Numeric day/month/year cells read only when exactly one reading is a real date; ambiguous cells reported with both readings | "Nothing is guessed": a US file must not be silently read as Indian dates or vice versa; the Excel upload path carries exact dates anyway | Assuming day-first (Indian convention); a per-column format setting |
| 2026-09-27 | Relative dates = `{unit, offset, edge}` resolved from an "as of" day the runner can set; stored as `as_of` in the run's parameters | Reproducible reruns ("as of 27 Sep 2026" is visible), and "this month" / "last 30 days" / "year to date" all reduce to one shape | Named presets only; server-only "today" (not reproducible, wrong day near midnight in IST) |
| 2026-09-27 | `date_part` appends the period column (keeps every column) | Group by month while still summarizing amounts or taking the last order date; matches how analysts add a helper column | Replacing the date column in place |
| 2026-09-27 | Templates are code (`templates.ts`), tested like recipes, not database rows | Can't go stale silently; no admin UI needed; load as ordinary drafts with origin `blank` (no AI badge) | Seeding templates as example recipes per workspace |
| 2026-09-27 | Result chart: single-series bars in the brand colour, table default | Grouped results are the common case; one hue needs no legend; the table stays one click away | Multi-series charts, a charting library |
| 2026-09-27 | `/` for a signed-out visitor → `/welcome`; every other path → `/login?redirect=` | A public front door for the showcase without moving the dashboard | A separate marketing site; landing at `/` with the dashboard elsewhere |
| 2026-09-27 | API tokens: hashed, `fp_`-prefixed, expiring, capped at 10, session-only endpoints for account/security/membership | A leaked token must not become account takeover; scripts need only recipes and runs | Long-lived unhashed keys; tokens with full account power; OAuth (too much for one server) |
| 2026-09-27 | Tokens work in the first workspace unless `X-Workspace-Id` says otherwise | Scripts have no session row to remember a workspace | A per-token workspace at creation |
| 2026-09-27 | Hook lint findings fixed with `useSyncExternalStore` / adjust-during-render, not disabled | The rules point at real hydration and reset patterns; the fixes remove a render each | `eslint-disable` per site |
| 2026-09-27 | ESLint checks correctness only (no formatting rules); no Prettier config | The code is consistently formatted already; formatting churn would hide real diffs | Prettier + lint-staged |
| 2026-09-27 | CI workflow committed although it can't be run here | It mirrors the local commands exactly; it is the natural next step once the repo is public | Waiting until the repo is pushed |

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
- Fixed in phase 20: the react-hooks lint findings (hydration flag, theme, platform label, dialog resets) are gone; ESLint is now part of the repo and clean

## How to run
- Install: `npm install` (Node 22+; built on Node 25.3) · E2E browser once: `npx playwright install chromium`
- Dev: `npm run dev` (predev seeds `./data/flowpilot.db` if empty) → http://localhost:3000
- Seed / reset: `npm run seed` / `npm run seed:reset`
- Test: `npm test` · E2E: `npm run test:e2e` · Typecheck: `npm run typecheck` · Lint: `npm run lint`
- Build / start: `npm run build` → `npm start`
- AI: put keys in `.env` (see `.env.example`), then `npm run check:model` and `npm run eval:model`
- Screenshots: `npx tsx scripts/screenshots.ts --as asha --theme both / /library` (dev server running)

## Environment variables (names only)
DATABASE_PATH, SEED_PASSWORD, DEMO_MODE, REGISTRATION, APP_URL, TRUST_PROXY (`true` behind Caddy/nginx, `fly` on Fly.io), RESEND_API_KEY, MAIL_FROM, MODEL_PROVIDER, MODEL_NAME, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY (+ optional ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL). The local git-ignored `.env` sets MODEL_PROVIDER=openrouter and OPENROUTER_API_KEY.

## File map
- `src/lib/workflow/`: `schema.ts` (contract, LIMITS, 7 step types, 4 column types) · `templates.ts` (10 templates) · `columns.ts` (shape rule) · `validate.ts` (validateDefinition, analyze, resolveParameters) · `execute.ts` (engine) · `describe.ts` (INR, steps, summary, parameter units) · `draft.ts` (editor model) · `examples.ts`
- `src/lib/`: `csv.ts` · `dates.ts` (strict date reading, day-number calendar maths, relative dates, periods) · `spreadsheet.ts` (workbook → CSV in the browser, results → .xlsx) · `policy.ts` (pure access policy + matrix) · `account.ts` (name/email/password rules) · `api.ts` (client + query keys) · `types.ts` · `format.ts` · `session.ts` (server fns) · `demo.ts` · `redirect.ts` (safe post-login paths)
- `src/server/`: `migrations.ts` (schema + triggers, 3 migrations) · `db.ts` · `auth.ts` (sessions, throttle) · `accounts.ts` (users, workspaces, invites, resets) · `repo.ts` (access-aware queries, stale reaper) · `events.ts` (audit + feed) · `config.ts` (env settings, client address) · `mail.ts` · `boot.ts` (first-request setup) · `seed.ts` · `http.ts` · `env.ts` · `ids.ts`
- `src/server/api/`: `router.ts` (dispatcher, 45 routes, `auth: true | false | 'session'`) · `auth.ts` · `account.ts` (register, resets, me, workspaces) · `invites.ts` · `workflows.ts` · `runs.ts` · `generate.ts` · `workspace.ts` · `dashboard.ts` · `system.ts`
- `src/server/ai/`: `config.ts` (providers, env) · `generate.ts` (prompt, schema, adapters, repair loop)
- `src/routes/`: `__root.tsx` · `welcome.tsx` (public landing) · `login.tsx` · `signup.tsx` · `invite.$token.tsx` · `forgot-password.tsx` · `reset-password.$token.tsx` · `_app.tsx` (guard + shell) · `_app/{index,library,runs,access,account,system-design,workflows.new,w.$workflowId.index,w.$workflowId.edit}.tsx` · `_app/$.tsx` (in-app 404) · `api/$.ts`
- `src/components/`: `ui.tsx` (incl. `Menu`) · `templates.tsx` (gallery) · `charts.tsx` (run chart + `ResultChart`) · `shell.tsx` (workspace switcher, create-workspace dialog) · `auth-layout.tsx` (sign-in pages layout, password input) · `command.tsx` · `editor.tsx` · `results.tsx` · `charts.tsx` · `workflow-bits.tsx` · `file-drop.tsx` · `share-dialog.tsx` · `fork-dialog.tsx` · `access-panel.tsx` · `states.tsx` · `toast.tsx` · `logo.tsx` · `theme.ts` · `diagrams/{architecture,versioning}.tsx`
- `src/start.ts`: global request middleware (security headers, server-fn CSRF) · `eslint.config.js` · `.github/workflows/ci.yml`
- `tests/`: 14 Vitest suites (incl. `hardening`, `accounts`, `language`, `governance`, `spreadsheet`, `dates`, `templates`, `tokens`) + `helpers/` · `tests/e2e/`: `demo.spec.ts`, `features.spec.ts`, `accounts.spec.ts`, `a11y.spec.ts`, `mock-model.ts` · `playwright.config.ts`
- `scripts/`: `seed.ts`, `check-model.ts`, `eval-model.ts`, `smoke.ts`, `screenshots.ts`, `screenshots-features.ts` (clicks through the newer features), `backup-db.mjs` (also in the image), `make-fixtures.mjs` (xlsx fixtures) · `fixtures/`, `public/samples/`, `docs/system-design.md`, `docs/screenshots/`
- `deploy/oracle/`: `README.md` (console walkthrough) · `docker-compose.yml` · `Caddyfile` · `setup.sh` · `backup.sh` · `push.sh` · `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore`, `fly.toml` at the root
- `src/lib/samples.ts` (sample catalogue) · `src/server/ratelimit.ts` (drafting limits)

## Demo checklist
- [x] Asha creates & shares (e2e test 1) · [x] Vikram reruns (e2e test 2) · [x] Vikram forks (e2e test 2) · [x] Asha's original unchanged (e2e test 3) · [x] Meera/Olivia blocked (e2e test 4)

## Open questions for the owner
- Please rotate the OpenRouter key that was shared in chat (the local `.env` needs the new value afterwards).
- The brief was cut off after section 11 ("Governance: Access"). If sections 12–19 hold requirements beyond the system design PDF, share them and they can be checked against this build.
