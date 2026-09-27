# FlowPilot developer guide

How the code fits together, for anyone about to change it. The [README](../README.md) says what FlowPilot does, and [system-design.md](system-design.md) says why it is built this way. This guide covers where things live, what happens on a request, and how to make the common kinds of change without breaking a promise the product makes.

## Contents

1. [Run it](#1-run-it)
2. [A map of the code](#2-a-map-of-the-code)
3. [The life of a request: pressing Run](#3-the-life-of-a-request-pressing-run)
4. [The recipe language](#4-the-recipe-language)
5. [Permissions](#5-permissions)
6. [Accounts and security](#6-accounts-and-security)
7. [The database](#7-the-database)
8. [The front end](#8-the-front-end)
9. [AI drafting](#9-ai-drafting)
10. [Observability](#10-observability)
11. [Testing](#11-testing)
12. [Common changes, step by step](#12-common-changes-step-by-step)

## 1. Run it

You need Node 22 or newer. SQLite is a file, so there is nothing else to install.

```bash
npm install
npm run dev            # seeds ./data/flowpilot.db the first time; http://localhost:3000
```

Sign in with a demo account from the buttons on `/login` (password `flowpilot-demo`), or sign up at `/signup`. AI drafting stays off until a key is set in `.env` (see the README); everything else works without it.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload (Vite + TanStack Start) |
| `npm run build` · `npm start` | Production bundle in `.output/`, then serve it |
| `npm test` · `npm run test:coverage` | 213 unit and API tests (Vitest), optionally with coverage |
| `npm run test:e2e` | 35 browser tests (Playwright), with their own server, database and stand-in model |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm run smoke -- --base <url>` | Checks all 52 endpoints against any running server |
| `npm run check:model` · `npm run eval:model` | One real AI draft · the 28-case evaluation |
| `npm run seed:reset` | Delete the local database and seed the demo again |
| `npm run two-factor:off -- <email>` | Turn two-step sign-in off for someone locked out (operators) |

## 2. A map of the code

```
src/
  routes/            pages (file-based routing) and the API route
    _app.tsx         the signed-in layout: session check, then the app shell
    _app/*.tsx       dashboard, library, editor, recipe page, runs, access, audit, account, system design
    api/$.ts         every /api/* request goes to one dispatcher
  components/        the UI kit (ui.tsx), shell, editor, results, charts, run comparison, two-step sign-in, dialogs
  lib/               code shared by the browser and the server
    workflow/        the recipe language: schema, columns, validate, execute, describe, diff, draft, templates
    csv.ts           parsing files against a recipe's input contract (the same code in both places)
    dates.ts         calendar maths, relative dates and time zones
    compare.ts       what changed between two results
    policy.ts        every permission decision
    api.ts           the browser's API client and React Query keys
    types.ts         the shapes the API returns
  server/            server-only code
    api/             the dispatcher (router.ts) and one file per resource
    ai/              model configuration and the drafting loop
    db.ts            the SQLite connection; migrations.ts holds the schema and its triggers
    auth.ts          passwords, sessions, API tokens, the sign-in throttle
    totp.ts, secrets.ts, twofactor.ts    two-step sign-in
    repo.ts, events.ts, accounts.ts      queries, the audit log, people and workspaces
    observability.ts request ids, logs and metrics
tests/               unit and API tests; tests/e2e holds the browser tests and the mock model
scripts/             seed, smoke test, model check and eval, backups, screenshots
deploy/oracle/       the free hosting kit (Docker Compose, Caddy, backups)
```

Two rules explain most of the layout:

- **`src/lib` runs in both places.** The CSV parser, the validator and the dates code run in the browser for instant feedback and again on the server as the real check, so the two can never disagree. The one exception is `lib/session.ts`, which holds the server functions the pages call; nothing else in `src/lib` imports from `src/server`.
- **The model is on one path only.** Only `src/server/api/generate.ts` calls it (`server/ai/generate.ts`); other code only asks whether AI is configured. Running a recipe never touches the model, so saved recipes run with AI switched off.

## 3. The life of a request: pressing Run

Following one request through the code is the fastest way to learn it.

1. **In the browser.** The run panel (`src/routes/_app/w.$workflowId.index.tsx`, `RunPanel`) checks the chosen file with the same parser the server uses (`lib/csv.ts`), so problems show before anything is uploaded. The run sends a multipart form through `api.upload('/api/runs', form)` (`lib/api.ts`).
2. **One entry point.** `src/routes/api/$.ts` hands every `/api/*` request to `handleApi` in `src/server/api/router.ts`. It:
   - gives the request an id (`observability.ts`, `requestIdFor`);
   - makes sure the database is open and migrated (`boot.ts`, `ensureReady`);
   - matches the route, answers `OPTIONS` and `HEAD`, and gives unknown methods 405;
   - rejects cross-site writes (`assertSameOrigin`);
   - finds the caller from the session cookie or an API token (`auth.ts`, `userFromRequest`), and enforces the route's `auth` mode: `false` for anyone, `true` for any signed-in caller, `'session'` for browsers only.
3. **The handler.** `runs.create` (`src/server/api/runs.ts`) does everything in order, cheapest first:
   1. content type, then the body read with a hard byte cap (`http.ts`, `readBodyCapped`);
   2. the version and its recipe (`repo.ts`), then the permission (`lib/policy.ts`, `decide('run', …)`), answering 404 for anything the caller can't see;
   3. the parameters and the as-of day (default: today in the recipe's workspace, `lib/dates.ts`, `todayIn`);
   4. the stored definition re-validated (`lib/workflow/validate.ts`), and the file parsed against its input contract;
   5. a `running` row inserted that pins the version, runner and parameters;
   6. the engine (`lib/workflow/execute.ts`): pure functions, a 30-second deadline, a log of rows in and out per step;
   7. the row finished (a trigger makes finished runs final), an audit event, and the metrics updated.
4. **Errors.** Handlers throw `ApiError` (`http.ts`) with a status and a code. `mapError` turns anything thrown into the standard JSON error with the request id; an unexpected error is logged with its stack and answered as 500 with the id as a reference.
5. **Back in the browser.** The result goes into React Query's cache (`qk.run(id)`), and `ResultCard` shows the table or chart (`components/results.tsx`), the comparison with your previous run (`components/run-comparison.tsx`) and the rows through each step.

## 4. The recipe language

A recipe is a JSON document, validated strictly, and never evaluated as code.

| File | Role |
|---|---|
| `lib/workflow/schema.ts` | Zod schemas and types for the document; the limits (rows, columns, steps) |
| `lib/workflow/columns.ts` | The shape rule: which columns exist after each step. Everything else asks it |
| `lib/workflow/validate.ts` | Checks a definition and explains problems in people's terms; resolves run parameters |
| `lib/workflow/execute.ts` | The engine: one plain function per step type |
| `lib/workflow/describe.ts` | Plain-language step descriptions and the result's summary line |
| `lib/workflow/diff.ts` | "What changed since the previous version", in words |
| `lib/workflow/draft.ts` | Turns the model's flat reply into a definition |
| `components/editor.tsx` | The step cards people edit |

**To add a step type:** add its schema and type (`schema.ts`); its effect on columns (`columns.ts`); its validation rules and messages (`validate.ts`); its function (`execute.ts`); its description (`describe.ts`); a card in the editor (`editor.tsx`); the model's schema and prompt (`server/ai/generate.ts`, `lib/workflow/draft.ts`); then tests in `tests/engine`, `tests/validator` and `tests/language`, and cases in `scripts/eval-model.ts`. Old versions never change, so an existing recipe keeps running exactly as before.

## 5. Permissions

Every decision is a pure function in `lib/policy.ts`. `relationTo` (`server/repo.ts`) works out how the caller relates to a recipe (owner, role in its workspace, or outsider), and `decide(action, relation, visibility)` answers `{ allowed, status, reason }`. The Access page renders its matrix from the same functions (`permissionMatrix`), so the documentation can't drift from the enforcement.

The rule of thumb is **404 hides existence, 403 refuses what you can see.** Runs are private to whoever ran them, even from the recipe's owner and admins.

**To add an action:** add it to `Action` and `decide` in `policy.ts`, call `decide` in the handler, and extend `tests/access.test.ts`. The matrix on the Access page follows.

## 6. Accounts and security

| Concern | Where | Notes |
|---|---|---|
| Passwords | `auth.ts` | scrypt with a random salt; a dummy hash for unknown emails so timing reveals nothing |
| Sessions | `auth.ts` | 256-bit token in an HttpOnly cookie; only its SHA-256 is stored |
| API tokens | `accounts.ts`, `auth.ts` | `fp_` prefix, hash only, expiring, revocable; `'session'` routes refuse them |
| Invites and resets | `accounts.ts`, `api/invites.ts`, `api/account.ts` | Random tokens, hash only, expiring, single or limited use |
| Throttles | `auth.ts`, `ratelimit.ts` | Sign-in per email + address, email and address; sign-ups, resets, drafts, second-step codes |
| Two-step sign-in | `totp.ts`, `secrets.ts`, `twofactor.ts`, `api/two-factor.ts` | See below |

**Two-step sign-in.** `totp.ts` implements RFC 6238 on Node's crypto (tested against the RFC's vectors) plus recovery codes. `secrets.ts` seals the authenticator secret with AES-256-GCM, bound to the account, under a key that lives outside the database. `twofactor.ts` stores and checks them, and holds the short-lived sign-in challenges. On sign-in, `api/auth.ts` answers a correct password with a challenge instead of a session when two-step sign-in is on, and `api/two-factor.ts` finishes it. Spending a code is a conditional update, so two requests racing with the same code can't both win.

## 7. The database

- **One connection** (`db.ts`): WAL mode, foreign keys on, a 5-second busy timeout. Tests swap in an in-memory database with `setDatabase`.
- **Migrations** (`migrations.ts`) are an append-only list, applied in order at start-up and recorded in `schema_migrations`. **Never edit a migration that has shipped;** add a new one at the end.
- **Invariants live in triggers,** so they hold whatever code writes: immutable versions, final runs, an append-only audit log, recipe hand-over rules, and two-step sign-in's consistency and demo-account rules. A handler bug can't break them.
- **Queries** are plain SQL through better-sqlite3 in `repo.ts`, `accounts.ts`, `twofactor.ts` and `events.ts`, always with bound parameters.

**To add a migration:** append `{ id, name, sql }` to `MIGRATIONS`; update the counts that tests pin (`tests/hardening.test.ts` checks the migration and trigger counts, and a browser test reads the trigger count on the System design page); and mention the change in the data model in `docs/system-design.md`.

## 8. The front end

- **Routing:** TanStack Router's file routes in `src/routes` (`routeTree.gen.ts` is generated). `_app.tsx` checks the session on the server (`lib/session.ts`, `getSessionFn`) and puts `me` in the route context; signed-out visitors go to `/login` (or `/welcome` from `/`).
- **Data:** TanStack Query. Keys are defined once in `lib/api.ts` (`qk`), and mutations invalidate the keys they affect. The API client throws the server's structured error as `ApiError`, so pages can show its message and field issues.
- **UI kit:** `components/ui.tsx` has the buttons, cards, dialogs, fields, callouts and menus; `components/toast.tsx` has toasts. Colours are CSS variables in `src/styles/app.css` with light and dark values, used through Tailwind v4 classes such as `text-ink` and `bg-surface`.
- **Accessibility:** every page is scanned with axe-core in both themes (`tests/e2e/a11y.spec.ts`). Give every control a label, and add a new page to that spec's list.
- **Hydration:** controls that act stay disabled until React has hydrated (`useHydrated`), so a click before then can't be lost, and a native form submit can't put a password in a URL.

## 9. AI drafting

`server/ai/config.ts` picks the provider from the environment. `server/ai/generate.ts` builds the prompt from the sentence and the column names and types (never rows), asks for structured output, validates the reply with the same validator as everything else, and allows one repair. `api/generate.ts` applies the per-person budget and records metrics. The browser tests talk to `tests/e2e/mock-model.ts` instead of a real provider, and `scripts/eval-model.ts` measures a real model against 28 fixed cases.

## 10. Observability

`server/observability.ts` has the three pieces, with no dependencies:

- `requestIdFor(request)` and the `X-Request-Id` header, added by `handleApi` to every response;
- `log(level, msg, fields)`: JSON lines in production, short text in development (`LOG_FORMAT`); warnings and errors always print;
- `metrics`: counters and histograms rendered in the Prometheus text format by `renderMetrics`, plus gauges read from the database at scrape time.

**To add a metric:** declare it in `metrics`, increment or observe it where the event happens, and assert it in a test with `metrics.yourMetric.value({...})`. Keep labels to a small, fixed set of values (never ids or paths).

## 11. Testing

- **Unit and API tests** (`tests/*.test.ts`) call the real dispatcher with real cookies against an in-memory database:

  ```ts
  import { Client, freshApp, signIn } from './helpers/app'

  beforeEach(async () => {
    await freshApp() // a fresh in-memory database with the demo seed
  })

  it('lets a member run a team recipe', async () => {
    const vikram = await signIn('vikram')
    const res = await vikram.get('/api/workflows?scope=team')
    expect(res.status).toBe(200)
  })
  ```

  To control time, fake only the clock: `vi.useFakeTimers({ toFake: ['Date'] })`, then `vi.setSystemTime(...)`. The model is always stubbed and `.env` is never read.
- **Browser tests** (`tests/e2e/*.spec.ts`) start the stand-in model on port 4010 and a dev server on port 3100 with its own `data/e2e.db`. They leave the working tree clean; `UPDATE_SCREENSHOTS=1` refreshes the README's screenshots.
- **Smoke test** (`scripts/smoke.ts`) drives every endpoint of any running server, including production, with throwaway accounts.
- **CI** (`.github/workflows/ci.yml`) runs all of it on every push, plus the production Docker image with the smoke test; CodeQL scans for security problems.

## 12. Common changes, step by step

**Add an API endpoint**

1. Write the handler in `src/server/api/<resource>.ts`. Parse the body with a strict Zod schema, check permissions with `lib/policy.ts`, and throw `ApiError` for failures.
2. Register it in `ROUTES` in `src/server/api/router.ts` with the right `auth` mode.
3. Add its response type to `lib/types.ts` and call it from the page through `api` and a `qk` key.
4. Test it through `Client` in `tests/`, including the 401, 403, 404 and 422 cases.
5. Add a check to `scripts/smoke.ts` and a row to the README's API reference.

**Add a page**

1. Create `src/routes/_app/<name>.tsx` with `createFileRoute`; the route tree regenerates.
2. Link it from the sidebar in `components/shell.tsx` if it belongs there.
3. Add it to the page lists in `tests/e2e/a11y.spec.ts`.

**Add a setting**

1. Read it in `appConfig()` in `src/server/config.ts`, with a safe default.
2. Document it in `.env.example` and in the README's Configuration table.
3. If it matters in production, add it to the deployment kits in `deploy/` and `fly.toml`.

Before opening a pull request, run the checks listed in [CONTRIBUTING.md](../CONTRIBUTING.md).
