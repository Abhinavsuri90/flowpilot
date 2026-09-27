# Contributing to FlowPilot

Thanks for taking a look. Bug reports, fixes and small, focused features are all welcome.

## Set up

You need **Node 22 or newer** and npm. The database is a local SQLite file, so nothing else is required.

```bash
npm install
npm run dev          # seeds ./data/flowpilot.db on the first run, then serves http://localhost:3000
```

Sign in with a demo account from the login page (password `flowpilot-demo`), or create your own at `/signup`. [docs/developer-guide.md](docs/developer-guide.md) explains how the code fits together. AI drafting is optional; see [AI drafting and model choice](README.md#ai-drafting-and-model-choice) to turn it on.

## Before you open a pull request

Run the same checks as CI:

```bash
npm run typecheck
npm run lint
npm test                           # unit and API tests (npm run test:coverage adds coverage; CI enforces its thresholds)
npx playwright install chromium    # once
npm run test:e2e                   # browser tests
```

The browser tests start their own server, database and stand-in model, so they never need or spend an API key. They leave the working tree clean. To refresh the screenshots in the README after a UI change, run `UPDATE_SCREENSHOTS=1 npm run test:e2e` and commit the images.

A change to the API should also update the [API reference](README.md#api-reference) and `scripts/smoke.ts`, which checks every endpoint against a running server (`npm run smoke`).

## Ground rules

These keep the product's promises true. The reasons are in [docs/system-design.md](docs/system-design.md).

- **The model never runs a recipe.** Only `src/server/api/generate.ts` calls a model, and it never writes. Running a saved recipe must keep working with AI switched off.
- **One access policy.** Every permission decision goes through `src/lib/policy.ts`, which is also what the Access page renders. Anything a person can't see answers 404.
- **Versions are immutable.** Saving appends a version, and database triggers reject edits. Schema changes go in a new entry at the end of `MIGRATIONS` in `src/server/migrations.ts`; never edit one that has shipped.
- **Uploaded files are never stored.** Runs keep results, not the file, and a run is visible only to the person who ran it.
- **Secrets are hashed or sealed.** Anything that grants access and only needs checking (sessions, tokens, links, recovery codes) is stored as a hash. Anything the server must read back (authenticator secrets) is sealed with `src/server/secrets.ts`, never stored in plain text.
- **Logs name route patterns, never raw paths.** A path can carry an invite or reset token; `src/server/observability.ts` logs and labels metrics by the matched pattern.
- **Tests stay hermetic.** They never read `.env` and always stub the model.

## Commit messages

Short, in the imperative or descriptive present, with a type and an optional scope:

```
feat(editor): warn when a text value never occurs in the sample
fix(csv): keep line numbers right after a quoted newline
docs: explain the as-of day
test(e2e): cover archiving from the recipe page
```

## Reporting a security problem

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
