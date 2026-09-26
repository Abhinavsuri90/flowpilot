# FlowPilot

**Shareable, versioned CSV report recipes for teams.** Describe a repetitive report in one sentence, review the steps an AI drafts, and save it. Anyone in your workspace can then run it on their own file (no AI involved on reruns) or make an independent copy and adapt it, without ever changing the original.

![A recipe run on sales_A.csv](docs/screenshots/02-asha-runs-file-A.png)

The whole loop works end to end, and a real browser test proves it (`npm run test:e2e`): **describe → review → save → run → share → a second person runs it on their own file → makes a copy → the copy runs independently, and the original is unchanged.**

---

## Quick start

```bash
npm install
npm run dev        # the first run seeds ./data/flowpilot.db, then serves http://localhost:3000
```

Needs Node 22 or newer (built on Node 25.3). No external services are needed: the database is a local SQLite file.

Sign in with one of the synthetic demo accounts. The login page has one-click buttons for each; the password is `flowpilot-demo`.

| Person | Email | Workspace | Role | In the demo |
|---|---|---|---|---|
| Asha Rao | asha@demo.local | Sales | admin | Creates and shares the recipe |
| Vikram Nair | vikram@demo.local | Sales | member | Reruns it on a new file, then makes a copy |
| Meera Iyer | meera@demo.local | Sales | viewer | Can run recipes, cannot copy or create |
| Olivia Chen | olivia@demo.local | Marketing | admin | Outsider to Sales: sees none of it |

Start over at any time with `npm run seed:reset`.

## AI drafting (optional)

Without a key the app is fully usable: you add steps by hand, the sidebar shows **AI drafting: Off**, and every saved recipe runs, because the run path never touches a model. To turn drafting on, create a git-ignored `.env`:

```bash
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
# MODEL_NAME=anthropic/claude-sonnet-5     # optional; this is the default for OpenRouter
```

Anthropic (`ANTHROPIC_API_KEY`, forced `submit_recipe` tool call) and OpenAI (`OPENAI_API_KEY`, strict `json_schema`) work the same way. Run `npm run check:model` to confirm the key works and see the steps the model drafts for the demo sentence.

The model only ever sees column names and types, never rows. Its draft goes through the same strict validator as everything else, gets at most one automatic repair, and is never saved or run until a person saves it.

### Choosing an OpenRouter model

Any model that supports **structured outputs** works. FlowPilot asks OpenRouter to route only to providers that honour a strict `response_format`. Measured through OpenRouter on 26 Sep 2026, one run per prompt, so treat the timings as indicative:

| Model | Demo sentence → recipe | “Email via Gmail every Monday” → unsupported | “Total the amount for each rep” (two rep columns) → question | Price in / out per M tokens |
|---|---|---|---|---|
| `anthropic/claude-sonnet-5` (default) | ✓ 5.7 s | ✓ 2.4 s | ✓ 3.7 s | $2 / $10 |
| `openai/gpt-6-luna` | ✓ 3.1 s | ✓ 2.1 s | ✓ 2.2 s | $0.10 / $0.50 |
| `google/gemini-3.8-flash` | ✓ 14.7 s | ✓ 4.6 s | ✓ 4.3 s | $0.75 / $3.75 |

All nine answers were correct on the first try, with no repairs. A draft is one short call, so it costs well under a cent on any of these. `claude-sonnet-5` is the default for answer quality; `gpt-6-luna` is the fast, low-cost option; `gemini-3.8-flash` worked, but its draft came close to the 20-second limit.

## A five-minute demo

Sample files are in `public/samples/` and can also be downloaded from the editor.

1. **Asha** → *New recipe* → *Use sales_A.csv*. `order_id` stays unchecked, so it isn't required. Paste *“Keep paid orders, sum amount by region, and show regions with total below a configurable threshold, default 100000.”* → *Generate steps*, then review the three step cards, which carry an “AI draft” badge. Title it *Regional revenue exceptions* and save.
   *No key?* Add the steps by hand: filter `status` equals `paid`; group & sum `amount` by `region` as `total`; filter `total` is less than `100000`, then *Make adjustable*.
2. Run it on `sales_A.csv`: **South ₹40,000 · West ₹70,000**.
3. *Share* → *Team*, then copy the version-pinned link.
4. **Vikram** → *Team library* → open it → run `sales_B.csv`: **North ₹70,000 · West ₹20,000**. Set the threshold to 50,000 and you get **West ₹20,000** only. Click *Reset*: the saved recipe never changed.
5. *Make a copy* → set *Group by* to `sales_rep` → *Save as version 2* → run `sales_B.csv`: **Asha ₹90,000**.
6. **Asha**: the dashboard says *“Vikram Nair made a private copy of your Regional revenue exceptions v1”* without revealing the copy. Her recipe is still v1, still grouped by region.
7. **Meera** can run it, but *Make a copy* is disabled. **Olivia** gets *“Nothing here”*: a 404, as if it didn't exist.

| Run | Expected result |
|---|---|
| Original · file A · threshold 100,000 | South 40,000; West 70,000 (North 110,000 excluded) |
| Original · file B · 100,000 | North 70,000; West 20,000 (South 120,000 excluded) |
| Original · file B · 50,000 | West 20,000 only; the saved definition is unchanged |
| Copy grouped by sales_rep · file B · 100,000 | Asha 90,000 only (Vikram 120,000 excluded) |
| Original · file A · 70,000 (boundary) | South 40,000 only; West = 70,000 is excluded by `lt` |
| Original · file B · 20,000 | No rows matched |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Seed if empty, then start the dev server on :3000 |
| `npm run build` / `npm start` | Production build (Nitro) / serve it with `node .output/server/index.mjs` |
| `npm test` | 77 Vitest tests in 6 suites |
| `npm run test:e2e` | The demo in Chromium via Playwright (4 tests; own database and a mock model, so it never uses a real key) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` / `npm run seed:reset` | Seed an empty database / wipe it and seed again |
| `npm run check:model` | Is the model configured and reachable? What does it draft? |
| `npx playwright install chromium` | One-time browser download for the e2e tests |

## How it works

The in-app **System design** page (`/system-design`) walks through all of this, with a live view of the schema, triggers, limits and endpoints of the running server.

- **Two paths, one policy.** Authoring (the editor → AI author → model → validator → new version) and execution (run panel → policy → validator → CSV parser → engine → private run record) share only the API dispatcher, the access policy and the validator. The model is never on the execution path.
- **A small recipe language.** A strict JSON document: a declared input (typed columns), typed parameters, and up to 10 linear steps. Only `filter` and `group_sum` exist; values are literals or declared parameters, and nothing is ever evaluated. The validator tracks the columns step by step, so it can say *“Column "sales_rep" is no longer available: step s2 grouped the rows, which keeps only "region" and "total"”*.
- **A deterministic engine.** Exact integer sums, groups sorted by code point, a 30-second deadline checked between steps and every 1,024 rows, and a step log of rows in and out.
- **Versions, runs and copies.** Saving appends an immutable version; runs pin the exact version they executed; a copy is a new private recipe whose version 1 points back at one source version.
- **The database enforces invariants itself.** SQLite triggers reject edits or deletes of versions; changes to a recipe's owner, workspace or fork source; a current-version pointer into another recipe; updates to finished runs; and edits to the audit log.
- **One access policy.** `src/lib/policy.ts` holds pure functions used by every endpoint and by the Access page's matrix. 404 hides existence; 403 means “visible, but not yours to change”. Runs are private to whoever ran them, even from the owner and admins.

| Action on a team recipe | Owner | Admin | Member | Viewer | Outsider |
|---|---|---|---|---|---|
| See / run it | ✓ | ✓ | ✓ | ✓ | 404 |
| Make a copy | ✓ | ✓ | ✓ | 403 | 404 |
| Save a new version / change sharing | ✓ | 403 | 403 | 403 | 404 |
| See someone else's runs | 404 | 404 | 404 | 404 | 404 |

**Stack:** TanStack Start (React 19, Vite 8, Nitro), TanStack Router, Query and Table v9, Tailwind CSS v4, Zod 4, Papa Parse, SQLite via better-sqlite3, Vitest and Playwright.

**API:** one server route (`/api/$`) fronts 20 REST endpoints through `handleApi(Request)`: auth, workflows, versions, forks, access, generate, runs (plus CSV and delete), workspace roles, dashboard and system. Every response is `Cache-Control: private, no-store`, and every error has the shape `{ "error": { "code", "message", "issues"? } }`.

## Security and privacy

- Passwords use scrypt with a random salt. Sessions are 256-bit tokens in an HttpOnly, SameSite=Lax cookie, and only their SHA-256 is stored. Logins are throttled after 10 failures per email.
- Cross-site writes are rejected (Origin check). Pages send `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy`. Login controls stay disabled until the page is interactive, so a native submit can never put credentials in a URL.
- Identity always comes from the session: an `owner_id` in a request is ignored on create and rejected on update. Definitions are re-validated on save, on copy and before every run.
- Uploaded files are processed inside the request and never stored. Results are visible only to the runner, and anyone can delete their own results. CSV exports escape formula-like cells.
- API keys live only on the server (`.env` is git-ignored). User and model text is always rendered as text, never as HTML.

## Tests

- **`npm test`**: 77 tests. Engine 13, CSV 12, validator 13, access 19, demo loop 12 and AI 8. They call the same `handleApi(Request)` the server uses, with real cookies, against an in-memory SQLite database, so access rules are tested end to end rather than mocked. The model is always stubbed; the tests never read `.env`.
- **`npm run test:e2e`**: the demo above in Chromium. It uses its own database and a stand-in model (`tests/e2e/mock-model.ts`), so it never needs or spends a real key. Screenshots of each stage are saved to `docs/screenshots/`.

## Project layout

```
src/lib/workflow/     schema, validate, execute, describe, draft, examples: the recipe language
src/lib/              csv, policy, api client, shared types, formatting, session server functions
src/server/           db + migrations (triggers), auth, repo, audit events, seed, http helpers
src/server/api/       router (the dispatcher) and one file per resource
src/server/ai/        model config and the generate loop (Anthropic, OpenAI, OpenRouter)
src/routes/           login, _app (guard + shell), dashboard, library, editor, recipe, runs, access, system design, api/$
src/components/       UI kit, shell, editor, results grid, chart, diagrams, dialogs
tests/                unit and API suites · tests/e2e: Playwright spec + mock model
fixtures/             sales_A.csv, sales_B.csv and invalid files used by the tests
scripts/              seed, check-model, screenshots
context.md            project memory: status, decisions, deviations, known issues
```

## Limitations

This is a working prototype, not a production platform:

- **Single node.** SQLite suits one server process. The planned next step is Postgres with row-level security mirroring `lib/policy.ts`.
- **Small, synchronous runs.** Files up to 1 MiB, 5,000 rows and 50 columns run inside the request with a 30-second deadline. There is no queue, no scheduling and no retries.
- **Two operations only.** Filter and group-and-sum: no joins, averages, counts or charts. The AI says so instead of pretending.
- **Accounts are seeded.** There are no sign-ups, invitations, password resets or SSO, and new recipes go to your first workspace.
- **The login throttle is in memory.** It resets when the server restarts, and it counts per email, so someone could deliberately lock out an address for 10 minutes.
- **Recipes can't be deleted.** Versions are immutable by design.
- The model sees column names but not values, so it can't know that a file says “Paid” rather than “paid”. Review the draft.
- Dashboard days are UTC. CSV line numbers count records, so a quoted field containing a newline shifts later line numbers.
- It has only been run locally; nothing is deployed.

Decisions, deviations from the original brief and known issues are logged in [`context.md`](context.md).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `./data/flowpilot.db` | SQLite file |
| `SEED_PASSWORD` | `flowpilot-demo` | Password given to the demo accounts at seed time |
| `MODEL_PROVIDER` | inferred from whichever key is set | `anthropic`, `openai` or `openrouter` |
| `MODEL_NAME` | `claude-sonnet-5` · `gpt-5` · `anthropic/claude-sonnet-5` | Model for the chosen provider |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | none | Turns on AI drafting |
| `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `OPENROUTER_BASE_URL` | the public APIs | Optional override (a proxy, or the e2e mock) |
