# FlowPilot

**Turn a repetitive CSV report into a recipe your whole team can run.**

Describe the report in one sentence. FlowPilot drafts the steps with AI, and you review and save them as a versioned recipe. Anyone in your workspace can then run it on their own file, with no AI involved and the same result every time, or make an independent copy and adapt it. The original never changes.

![A recipe run on sales_A.csv: summary, sortable result, rows through each step](docs/screenshots/02-asha-runs-file-A.png)

The full loop works end to end, and a real browser test proves it: **describe → review → save → run → share → a teammate runs it on their own file → makes a copy → the copy runs independently, and the original is unchanged.**

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [AI drafting and model choice](#ai-drafting-and-model-choice)
- [A five-minute demo](#a-five-minute-demo)
- [How it works](#how-it-works)
- [API reference](#api-reference)
- [Security and privacy](#security-and-privacy)
- [Testing](#testing)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Limitations and next steps](#limitations-and-next-steps)

## Features

**Authoring**
- Read a sample CSV in the browser (it is never uploaded) to declare the input columns and their types: text, or amount in whole rupees.
- Describe the report in plain language, in English or Hinglish, and get editable step cards. AI drafts carry a badge until you save them.
- Edit steps by hand: filter rows, or group and sum. Each dropdown offers only the columns available at that step, and a sidebar shows the columns flowing through the pipeline.
- Checks run as you type: every rule is validated live and problems are pinned to the step card they belong to.
- The editor warns when a text value never occurs in your sample (for example "Paid" when the data says "paid") and fixes it in one click.
- *Make adjustable* turns a fixed value into a run parameter, such as a threshold with a default and bounds.
- Advanced JSON view: paste or read the recipe, validated before it is applied.

**Running**
- Run on any file with the declared columns; extra columns are ignored and never stored.
- The file is checked in the browser before anything is sent, so bad amounts, missing columns and ragged rows show with line numbers. Near-miss headers are named (“the file has "Status"”), and files that aren't UTF-8 or that use semicolons or tabs get a plain fix instead of a wall of errors. Switching versions re-checks the chosen file.
- Per-run parameters with *Reset*, and a hint when a filter can never match the chosen file.
- Results show a summary line, a sortable table (large results render 100 rows at a time), the rows remaining after each step, and a formula-safe CSV download.
- Private run history with exact counts per status, filtered on the server, and *Delete my results*.

**Sharing and copies**
- Share with your workspace in one click, and copy a link pinned to one version.
- *Make a copy* creates a private recipe you own that remembers where it came from, and it keeps working even if the original changes or becomes private.
- Every save is an immutable version. Old versions stay runnable and show a “latest is vN” banner.

**Governance**
- Roles: admin, member and viewer, plus outsiders from other workspaces. One policy module decides every permission.
- The Access page renders the permission matrix from that same code; admins change roles there.
- Anything you can't see answers 404, as if it didn't exist. Runs are private even from recipe owners and admins.
- The library pages 60 recipes at a time, and the ⌘K search asks only for the 7 it shows.

**Around it**
- A dashboard with a checklist of the reuse loop, stats, a 14-day run chart, recent runs and a permission-filtered activity feed.
- A System design page with interactive diagrams and the live schema, triggers, limits and endpoints of the running server.
- ⌘K / Ctrl K search, light and dark themes, a phone-width layout, and pages that pass an automated WCAG 2.1 AA scan.

## Quick start

```bash
npm install
npm run dev        # the first run seeds ./data/flowpilot.db, then serves http://localhost:3000
```

This needs **Node 22 or newer**; it was built on Node 25.3. Nothing else is required, because the database is a local SQLite file. Sign in with one of the synthetic demo accounts: the login page has one-click buttons, and the password is `flowpilot-demo`.

| Person | Email | Workspace | Role | In the demo |
|---|---|---|---|---|
| Asha Rao | asha@demo.local | Sales | admin | Creates and shares the recipe |
| Vikram Nair | vikram@demo.local | Sales | member | Reruns it on a new file, then makes a copy |
| Meera Iyer | meera@demo.local | Sales | viewer | Can run recipes, but not copy or create them |
| Olivia Chen | olivia@demo.local | Marketing | admin | An outsider to Sales, who sees none of it |

`npm run seed:reset` wipes the database and starts over.

## AI drafting and model choice

AI drafting is optional. Without a key the sidebar shows **AI drafting: Off**: you add steps by hand, and every saved recipe runs, because the run path never touches a model. To turn drafting on, create a git-ignored `.env`:

```bash
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
MODEL_NAME=openai/gpt-6-luna      # the default for OpenRouter
```

Then check it:

```bash
npm run check:model     # is the model reachable, and what does it draft for the demo sentence?
npm run eval:model      # the 14-case eval set below, against the configured model
```

Anthropic (`ANTHROPIC_API_KEY`, which uses a forced tool call) and OpenAI (`OPENAI_API_KEY`, which uses strict `json_schema`) work the same way. With OpenRouter, FlowPilot asks to be routed only to providers that honour a strict `response_format`.

**What the model sees:** your sentence and the declared column names and types, never data rows. Its draft is wrapped with your own input contract, checked by the same strict validator as everything else, repaired at most once, and never saved or run until you save it. Because the model can't see values, the editor checks text values against your sample file locally.

### Why `openai/gpt-6-luna`

`npm run eval:model` sends 14 fixed requests and checks the drafts structurally. It covers drafts, adjustable thresholds, exclusions, a different file layout and a Hinglish request, plus things a recipe can't do (averages, counts, Gmail on a schedule, joins, charts) and an ambiguous column that should get a clarifying question. Measured through OpenRouter on 26 Sep 2026:

| Model | Eval result | Median | Slowest | Price in / out per M tokens |
|---|---|---|---|---|
| **`openai/gpt-6-luna`** (chosen) | **14 / 14** (two runs) | **3.0 s** | 4.4 s | **$0.10 / $0.50** |
| `anthropic/claude-sonnet-5` | 14 / 14 | 5.3 s | 6.8 s | $2 / $10 |
| `google/gemini-3.8-flash` | 14 / 14 | 5.0 s | 8.0 s | $0.75 / $3.75 |

All three are accurate. `gpt-6-luna` is the fastest and costs about a twentieth as much, and a draft is one short call, so each draft costs well under a cent. The eval also found two prompt weaknesses, both since fixed: copying a sentence-initial capital ("Paid orders…" became `"Paid"`), and filtering raw amounts before grouping when the request meant a per-group total. To switch models, change `MODEL_NAME` and re-run `npm run eval:model`.

Each person can generate 10 drafts per minute and 200 per day (`429` with `Retry-After`), so a paid key can't be run up by accident.

## A five-minute demo

Sample files are in `public/samples/`. The editor and the run panel also offer them as one-click buttons.

1. **Asha** → *New recipe* → *Use sales_A.csv*. `order_id` stays unchecked, so it isn't required. Paste *“Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000.”*, then *Generate steps* and review the three cards. Title the recipe *Regional revenue exceptions* and save it.
   *No key?* Add the steps by hand: filter `status` equals `paid`; group and sum `amount` by `region` as `total`; filter `total` is less than `100000`, then *Make adjustable*.
2. Run it on `sales_A.csv`: **South ₹40,000 · West ₹70,000**.
3. *Share* → *Team*, and copy the version-pinned link.
4. **Vikram** → *Team library* → open the recipe → run it on `sales_B.csv`: **North ₹70,000 · West ₹20,000**. Set the threshold to 50,000 to get **West ₹20,000** only, then *Reset*; the saved recipe never changed.
5. *Make a copy* → set *Group by* to `sales_rep` → *Save as version 2* → run on `sales_B.csv`: **Asha ₹90,000**.
6. **Asha**: the dashboard says *“Vikram Nair made a private copy of your Regional revenue exceptions v1”*, without revealing the copy. Her recipe is still v1 and still grouped by region.
7. **Meera** can run the recipe, but *Make a copy* is disabled. **Olivia** gets *“Nothing here”*: a 404, as if the recipe didn't exist.

| Run | Expected result |
|---|---|
| Original · file A · threshold 100,000 | South 40,000; West 70,000 (North 110,000 excluded) |
| Original · file B · 100,000 | North 70,000; West 20,000 (South 120,000 excluded) |
| Original · file B · 50,000 | West 20,000 only; the saved definition is unchanged |
| Copy grouped by sales_rep · file B · 100,000 | Asha 90,000 only (Vikram 120,000 excluded) |
| Original · file A · 70,000 (boundary) | South 40,000 only; West = 70,000 is excluded by `lt` |
| Original · file B · 20,000 | No rows matched |

## How it works

The in-app **System design** page (`/system-design`) walks through all of this, including a live view of the running server's schema, triggers, limits and endpoints.

```mermaid
flowchart LR
  subgraph Browser
    ED[Recipe editor]
    LB[Library and recipe page]
    RP[Run panel]
  end
  subgraph Server[TanStack Start server]
    DP[API dispatcher: origin, session, errors]
    AI[AI author: columns, never rows]
    PO[Access policy]
    VA[Validator: strict schema]
    CS[CSV parser]
    EN[Engine: filter, group_sum]
  end
  MP[(Model provider)]
  DB[(SQLite: versions immutable, runs private)]
  ED --> DP
  LB --> DP
  RP --> DP
  DP --> AI
  AI -- draft request --> MP
  AI --> VA
  DP --> PO --> VA
  VA -- save version --> DB
  VA -- re-check stored version --> CS --> EN -- run record --> DB
```

- **Two paths, one policy.** Authoring (editor → AI author → model → validator → new version) and execution (run panel → policy → validator → CSV parser → engine → private run record) share only the dispatcher, the access policy and the validator. The model is never on the execution path, so saved recipes run even when AI is down.
- **A small recipe language.** A strict JSON document with a declared input, typed parameters and up to 10 linear steps. Only `filter` and `group_sum` exist, values are literals or declared parameters, and nothing is ever evaluated. The validator tracks the available columns step by step, so it can explain problems precisely, e.g. *“Column "sales_rep" is no longer available: step s2 grouped the rows, which keeps only "region" and "total"”*.
- **A deterministic engine.** Integer sums are exact, groups are sorted by code point, a 30-second deadline is checked between steps and every 1,024 rows, and a step log records rows in and out.
- **Versions, runs and copies.** Saving appends an immutable version, and title or description edits don't create one. Each run pins the exact version it executed. A copy is a new private recipe whose version 1 points back at one source version.
- **The database enforces invariants itself.** Triggers reject editing or deleting a version; changing a recipe's owner, workspace or copy source; pointing a recipe at another recipe's version; updating a finished run; and editing the audit log.
- **One access policy.** Pure functions in `src/lib/policy.ts` are used by every endpoint and by the Access page's matrix.

<details>
<summary>The recipe format</summary>

```json
{
  "schemaVersion": 1,
  "input": { "format": "csv", "columns": { "status": "string", "region": "string", "sales_rep": "string", "amount": "integer_inr" } },
  "parameters": { "threshold": { "type": "integer", "default": 100000, "min": 0, "max": 1000000000 } },
  "steps": [
    { "id": "s1", "type": "filter", "column": "status", "operator": "eq", "value": { "literal": "paid" } },
    { "id": "s2", "type": "group_sum", "groupBy": "region", "valueColumn": "amount", "as": "total" },
    { "id": "s3", "type": "filter", "column": "total", "operator": "lt", "value": { "parameter": "threshold" } }
  ],
  "output": { "format": "table" }
}
```

`eq` and `neq` work on text or amounts; `lt`, `lte`, `gt` and `gte` work only on amounts. Text matching is exact and case-sensitive. After a `group_sum`, only the group column and the new total remain.
</details>

| Action on a team recipe | Owner | Admin | Member | Viewer | Outsider |
|---|---|---|---|---|---|
| See it, run it | ✓ | ✓ | ✓ | ✓ | 404 |
| Make a copy | ✓ | ✓ | ✓ | 403 | 404 |
| Save a new version / change sharing | ✓ | 403 | 403 | 403 | 404 |
| See someone else's runs | 404 | 404 | 404 | 404 | 404 |

**Stack:** TanStack Start (React 19, Vite 8, Nitro), TanStack Router, Query and Table v9, Tailwind CSS v4, Zod 4, Papa Parse, SQLite via better-sqlite3, Vitest, Playwright and axe-core.

## API reference

One server route (`/api/$`) fronts 21 REST endpoints through a single dispatcher, `handleApi(Request)`. The dispatcher matches the route, blocks cross-site writes, reads the session, runs the handler and maps errors. Every response is `Cache-Control: private, no-store`. Every error has the shape `{ "error": { "code", "message", "issues"? , "draft"?, "runId"? } }`. Every path also answers `HEAD` (as `GET`, without a body) and `OPTIONS` (204 with `Allow`); any other method gets 405.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | `{email, password}` → session cookie. 401 is the same for unknown emails and wrong passwords; 10 failures in 10 minutes → 429 |
| POST | `/api/auth/logout` | anyone | Ends the session |
| GET | `/api/health` | anyone | `{"status":"ok"}` when the database answers |
| GET | `/api/me` | signed in | User, memberships, AI status |
| GET | `/api/dashboard` | signed in | Stats, 14-day runs, recent runs, filtered activity, checklist |
| GET | `/api/workflows?scope=mine\|team\|all&q=&limit=&offset=` | signed in | One page of recipes you can read (60 by default, at most 200), newest first, with `total`, `nextOffset` and the count for each tab |
| POST | `/api/workflows` | admin, member | `{title, description, definition}` → private v1 |
| GET | `/api/workflows/:id?v=` | can view | A version, the version list and your permissions |
| PATCH | `/api/workflows/:id` | owner | `{title?, description?, visibility?}` (unknown keys → 422) |
| POST | `/api/workflows/:id/versions` | owner | `{definition}` → the next immutable version |
| POST | `/api/workflows/:id/fork` | admin, member who can view | `{versionId, title}` → a private copy |
| GET | `/api/workflows/:id/access` | can view | Workspace members and what each can do |
| POST | `/api/generate` | signed in | `{request, columns}` → a draft, “unsupported” or a question; never writes |
| POST | `/api/runs` | can view | Multipart `{versionId, file, parameters}` → result, summary and step log |
| GET | `/api/runs?workflowId=&status=&limit=` | signed in | Your own runs only, newest first (at most 500), with exact `counts` per status |
| DELETE | `/api/runs?workflowId=` | signed in | Delete your finished runs |
| GET | `/api/runs/:id` | the runner | The full result and step log |
| GET | `/api/runs/:id/csv` | the runner | A formula-escaped CSV attachment (409 if the run has no result) |
| GET | `/api/workspace` | member | Members and roles |
| PATCH | `/api/workspace/members/:userId` | admin | `{role}`; not your own, and never the last admin |
| GET | `/api/system` | signed in | Schema, triggers, limits and endpoints: structure only, never rows |

Status codes: 401 not signed in · 403 visible but not yours, or a cross-site write · 404 not visible to you · 409 nothing to download · 413 over 1 MiB · 415 wrong content type · 422 validation failed, with `issues` · 429 too many attempts · 500 run failed (`TIMEOUT`, `EXECUTION_ERROR`) · 503 AI unavailable.

## Security and privacy

- Passwords are hashed with scrypt and a random salt. Sessions are 256-bit tokens in an HttpOnly, SameSite=Lax cookie (Secure on HTTPS), and only a SHA-256 hash of each token is stored. Signing in replaces the browser's previous session and purges expired ones. Sign-in is throttled after 10 failures per email, and after signing in you are only ever sent to a path on this site.
- Cross-site writes are rejected by an Origin check, and server functions have Start's CSRF middleware. Responses send `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy`. Login controls stay disabled until the page is interactive, so a native form submit can never put credentials in a URL.
- Identity always comes from the session: an `owner_id` sent by a client is ignored on create and rejected on update. Recipe definitions are re-validated on save, on copy and before every run.
- Uploaded files are processed inside the request and never stored. Results are visible only to the person who ran them, and anyone can delete their own. CSV exports escape formula-like cells.
- AI keys live only on the server, and `.env` is git-ignored. Drafting is rate-limited per person. Text from users or the model is always rendered as text, never as HTML.

## Testing

```bash
npm test                          # 97 unit and API tests
npx playwright install chromium   # once
npm run test:e2e                  # 19 browser tests
npm run typecheck
```

- **Unit and API tests (Vitest), 97 in total:** engine 13, CSV 18, validator 13, access 20, demo loop 12, AI 9, hardening 12 (HTTP methods, redirects, sessions, no-op edits, the activity feed on a busy team, list paging and run counts). They call the same `handleApi(Request)` the server uses, with real session cookies, against an in-memory SQLite database, so access rules are tested end to end rather than mocked. The model is always stubbed, and the tests never read `.env`.
- **Browser tests (Playwright), 19 in total:**
  - `demo.spec.ts` (4) is the demo above.
  - `features.spec.ts` (13) covers the rest: the editor's value warning, an invalid AI draft and a clarifying question, Advanced JSON, in-browser file checks, samples and parameters, details-only saves and versions, runs from another recipe, large results, CSV escaping, the command palette, theme, roles, *Delete my results*, the mobile drawer, re-checking a file when the version changes, refusing a non-UTF-8 file, the in-app 404, wide tables at phone width, and library paging.
  - `a11y.spec.ts` (2) runs an axe-core WCAG 2.1 AA scan of every page in light and dark mode.
- The browser tests use their own database and a stand-in model (`tests/e2e/mock-model.ts`), so they never spend real credits. Screenshots of each demo stage are saved to `docs/screenshots/`.
- **Model quality:** `npm run eval:model`, described above.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `./data/flowpilot.db` | SQLite file |
| `SEED_PASSWORD` | `flowpilot-demo` | Password for the demo accounts, set at seed time |
| `MODEL_PROVIDER` | inferred from whichever key is set | `anthropic`, `openai` or `openrouter` |
| `MODEL_NAME` | `claude-sonnet-5` · `gpt-5` · `openai/gpt-6-luna` | Model for the chosen provider |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | none | Turns on AI drafting |
| `OPENROUTER_BASE_URL` / `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` | the public APIs | Optional override, e.g. a proxy or the e2e mock |

`.env.example` lists all of them. `.env` is loaded by the server and scripts; real environment variables win over it.

## Deployment

```bash
npm run build        # Nitro output in .output/
npm start            # node .output/server/index.mjs (PORT defaults to 3000)
```

- Serve it over **HTTPS**; session cookies become `Secure` automatically.
- Keep `DATABASE_PATH` on a **persistent disk**. The server is a single process, because SQLite has a single writer.
- Seed once with a private `SEED_PASSWORD`, or replace the demo accounts; there are no sign-ups yet.
- Point your platform's health check at **`/api/health`**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install` fails building `better-sqlite3` | Use Node 22 or newer. If no prebuilt binary exists for your platform, install build tools (Xcode Command Line Tools, or `build-essential` + Python 3) |
| Port 3000 is in use | `PORT=3100 npm run dev` |
| AI drafting shows Off | Check the `.env` key and `MODEL_PROVIDER`, then restart the dev server and run `npm run check:model` |
| “AI generation is unavailable (… out of credits, HTTP 402)” | Top up the provider account; saved recipes keep running meanwhile |
| A run says “No rows matched” | Look for the amber hint in the run panel. Text matching is case-sensitive (“Paid” is not “paid”) |
| “This file isn't saved as UTF-8 text” | Excel's plain *CSV* uses Windows-1252. Use File → Save As → *CSV UTF-8 (Comma delimited)*, or download a CSV from Google Sheets |
| “This file separates values with semicolons” (or tabs) | Excel in many locales saves with semicolons. Save as *CSV UTF-8 (Comma delimited)* |
| “Missing required column: status (the file has "Status")” | Column names must match exactly, including capitals: rename the header in the file |
| E2E tests can't find a browser | `npx playwright install chromium` |
| You want a clean slate | `npm run seed:reset` |

## Project structure

```
src/lib/workflow/     the recipe language: schema, validate, execute, describe, draft, examples
src/lib/              csv, policy, samples, api client, shared types, formatting, session server functions
src/server/           db + migrations (triggers), auth, repo, audit events, rate limits, seed, http helpers
src/server/api/       the dispatcher (router.ts) and one file per resource
src/server/ai/        model config and the generate loop (Anthropic, OpenAI, OpenRouter)
src/routes/           login, _app (guard + shell), dashboard, library, editor, recipe, runs, access, system design, api/$
src/components/       UI kit, shell, command palette, editor, results grid, run chart, diagrams, dialogs
src/start.ts          global middleware: security headers, server-function CSRF
tests/                Vitest suites · tests/e2e: Playwright specs and the mock model
scripts/              seed, check-model, eval-model, screenshots
fixtures/             demo and invalid CSVs used by the tests · public/samples: downloadable demo files
context.md            project memory: status, decisions, deviations, known issues
```

## Limitations and next steps

This is a working prototype, not a production platform:

- **Single node.** SQLite suits one server process. The next step is Postgres with row-level security mirroring `lib/policy.ts`.
- **Small, synchronous runs.** Up to 1 MiB, 5,000 rows and 50 columns per file, run inside the request with a 30-second deadline. There is no queue, scheduling or retry.
- **Two operations.** Filter and group-and-sum only: no joins, averages, counts or charts. The AI says so instead of pretending.
- **Seeded accounts.** There are no sign-ups, invitations, password resets or SSO, and new recipes go to your first workspace.
- **In-memory limits.** The login throttle and drafting limits reset on restart. The login throttle counts per email, so someone could lock an address out for 10 minutes.
- **No deleting recipes.** Versions are immutable by design.
- **Other small gaps:**
  - Dashboard days are in UTC.
  - CSV line numbers count records, the way a spreadsheet numbers rows; in a text editor, a quoted field containing a newline shifts the numbers after it.
  - Lists show one page at a time: 60 recipes in the library (with *Show more*) and your latest 500 runs (the counts are always exact).
  - The model can't see values, so rely on the editor's sample check for text casing.
- **Local only.** Everything has been run locally; nothing is deployed.

Decisions, deviations from the original brief and known issues are logged in [`context.md`](context.md).
