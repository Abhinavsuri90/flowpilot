# Changelog

Notable changes to FlowPilot. Versions follow [semantic versioning](https://semver.org/), and a running server reports its version at `GET /api/health`.

## 1.1.0 · 2026-09-28

### Added

- **Two-step sign-in** with any authenticator app (TOTP, RFC 6238) and ten single-use recovery codes. Codes can't be replayed, wrong ones are throttled per person, and a password reset still asks for one. Secrets are encrypted at rest (AES-256-GCM) under a key kept outside the database. Operators can unlock someone with `npm run two-factor:off`.
- **What changed since last time:** a result opens with a comparison with your earlier run of the same recipe, row by row, with exact differences.
- **Workspace time zones:** "today" for relative dates, the run panel's default day and the dashboard's days follow the workspace's calendar. It is set from the browser at sign-up, and admins change it in Workspace settings.
- **Observability:** `X-Request-Id` on every response and in error bodies; one structured log line per request (`LOG_FORMAT`); Prometheus metrics at `/api/metrics` behind `METRICS_TOKEN`.
- CodeQL security scanning, and unit test coverage with thresholds, in CI.
- `docs/developer-guide.md`, an Operations and monitoring section in the README, `CONTRIBUTING.md`, `SECURITY.md` and this changelog.

### Changed

- A run that doesn't name its as-of day counts from today in the recipe's workspace, not the server's UTC day, and the dashboard counts days in the workspace's time zone.
- `PATCH /api/workspace` takes `timeZone` as well as `name`; demo workspaces keep both.
- CI runs on current GitHub Actions (Node 24) and a pinned Ubuntu 24.04 with a read-only token.
- Browser tests keep their screenshots in `test-results/`, so a test run leaves the working tree clean.

### Fixed

- Stale facts in the design document: seven step types, 28/28 on the model evaluation, and dates are supported.
- Chrome reports India's time zone by its old name (Asia/Calcutta); workspaces store the name people know (Asia/Kolkata).

## 1.0.0 · 2026-09-27

The first public release: report recipes drafted by AI from one sentence and reviewed by people; a deterministic engine with no AI on reruns; CSV and Excel in and out; immutable versions, sharing and independent copies; roles, workspaces, invitations, one access policy and an audit log; personal API tokens; templates, dates and charts; and deployment kits for Oracle Cloud (free) and Fly.io.
