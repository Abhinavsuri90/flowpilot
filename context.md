# FlowPilot: context
_Last updated: 2026-09-26 01:40 · Phase 1/8 · Scaffold done; starting deterministic core_

## What this is
FlowPilot turns a one-sentence description of a repetitive CSV report into a saved, versioned recipe that a workspace can run on their own files, share and fork.
Stack: TanStack Start 1.168 (React 19.3, Vite 8, Nitro 3 beta), TanStack Router/Query/Table v9, Tailwind v4, Zod 4, Papa Parse, SQLite (better-sqlite3 13).
Run: `npm install && npm run dev` → http://localhost:3000

## Current status
- Phase: 1 scaffold. Status: done
- Tests: no suites yet (phase 2 adds them). Typecheck: pass. Build: pass (`npm run build`, prod server smoke-tested on :3001)
- App runs with: `npm install && npm run dev` → http://localhost:3000

## Done (with evidence)
- [x] TanStack Start app boots; SSR guard redirects signed-out visitors to /login. Evidence: `curl /` → 307 `/login?redirect=%2F` (dev and prod)
- [x] SQLite schema, 8 tables + 12 invariant triggers, migrations tracked in `schema_migrations`. Evidence: `src/server/migrations.ts`; seed run lists all triggers
- [x] Seed: 4 demo accounts in Sales/Marketing. Evidence: `npm run seed` output
- [x] Auth: scrypt hashes, SHA-256 session tokens, HttpOnly SameSite=Lax cookie, same-origin check on writes. Evidence: curl login 200 + cookie, cross-site login → 403 BAD_ORIGIN
- [x] Login page (split brand panel + one-click demo accounts), app shell, light/dark tokens. Evidence: screenshots reviewed in session (scratchpad), to be regenerated under docs/screenshots in phase 8
- [x] Production build via Nitro, better-sqlite3 traced into `.output/server/node_modules`. Evidence: `node .output/server/index.mjs` served login + /api/me with `private, no-store`

## In progress
- Phase 2 deterministic core: schema/validate/execute/describe/csv + fixtures + engine/csv/validator suites

## Next steps (ordered)
1. `src/lib/workflow/{schema,validate,execute,describe,examples}.ts`, `src/lib/csv.ts`
2. `fixtures/` (sales_A/B + invalid files) and `public/samples/`
3. `tests/engine.test.ts`, `tests/csv.test.ts`, `tests/validator.test.ts`
4. Phase 3: policy, repo, events, remaining 17 endpoints, seed examples, access + demo-loop suites

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

## Deviations from the brief
- (none yet)

## Known issues / bugs
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
- `scripts/screenshots.ts`: Playwright screenshot helper

## Demo checklist
- [ ] Asha creates & shares · [ ] Vikram reruns · [ ] Vikram forks · [ ] Asha's original unchanged · [ ] Meera/Olivia blocked

## Open questions for the owner
- Sections 11 (after "Governance: Access") to 19 of the brief were cut off by the paste limit. The default I took meanwhile: follow the system design PDF for those parts, with 8 phases: 1 scaffold · 2 deterministic core · 3 API + access · 4 core UI · 5 AI authoring · 6 sharing/governance UI · 7 dashboard, runs, system design · 8 hardening, e2e, README.
