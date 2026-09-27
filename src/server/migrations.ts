// Schema migrations, applied in order when the database is opened and tracked in
// `schema_migrations`. Invariants that must hold no matter which code path writes
// (immutable versions, final runs, append-only audit log) live here as triggers.

export type Migration = { id: number; name: string; sql: string }

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: /* sql */ `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash TEXT NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  avatar_hue    INTEGER NOT NULL DEFAULT 230 CHECK (avatar_hue BETWEEN 0 AND 359),
  created_at    TEXT NOT NULL DEFAULT ${NOW}
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT ${NOW}
) STRICT;

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  joined_at    TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (workspace_id, user_id)
) STRICT;
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE workflows (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL REFERENCES users(id),
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id),
  title                  TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description            TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  visibility             TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team')),
  is_example             INTEGER NOT NULL DEFAULT 0 CHECK (is_example IN (0,1)),
  current_version_id     TEXT REFERENCES workflow_versions(id),
  forked_from_version_id TEXT REFERENCES workflow_versions(id),
  created_at             TEXT NOT NULL DEFAULT ${NOW},
  updated_at             TEXT NOT NULL DEFAULT ${NOW}
) STRICT;
CREATE INDEX workflows_owner_idx ON workflows(owner_id);
CREATE INDEX workflows_workspace_idx ON workflows(workspace_id, visibility);
CREATE INDEX workflows_fork_idx ON workflows(forked_from_version_id);

CREATE TABLE workflow_versions (
  id             TEXT PRIMARY KEY,
  workflow_id    TEXT NOT NULL REFERENCES workflows(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  definition     TEXT NOT NULL CHECK (json_valid(definition)),
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (workflow_id, version_number)
) STRICT;

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES workflow_versions(id),
  workflow_id   TEXT NOT NULL REFERENCES workflows(id),
  runner_id     TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  parameters    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(parameters)),
  input_name    TEXT CHECK (input_name IS NULL OR length(input_name) <= 255),
  input_rows    INTEGER CHECK (input_rows IS NULL OR input_rows >= 0),
  result        TEXT CHECK (result IS NULL OR json_valid(result)),
  step_log      TEXT CHECK (step_log IS NULL OR json_valid(step_log)),
  summary       TEXT,
  row_count     INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  duration_ms   REAL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code    TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  finished_at   TEXT,
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'failed' OR error_code IS NOT NULL),
  CHECK (status <> 'succeeded' OR result IS NOT NULL)
) STRICT;
CREATE INDEX runs_runner_idx ON runs(runner_id, created_at);
CREATE INDEX runs_workflow_runner_idx ON runs(workflow_id, runner_id);
CREATE INDEX runs_running_idx ON runs(created_at) WHERE status = 'running';

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_id     TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,
  workflow_id  TEXT REFERENCES workflows(id),
  detail       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  created_at   TEXT NOT NULL DEFAULT ${NOW}
) STRICT;
CREATE INDEX events_workspace_idx ON events(workspace_id, id);
CREATE INDEX events_workflow_idx ON events(workflow_id);

-- A version can never be changed or deleted.
CREATE TRIGGER workflow_versions_immutable
BEFORE UPDATE ON workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'workflow versions are immutable');
END;

CREATE TRIGGER workflow_versions_no_delete
BEFORE DELETE ON workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'workflow versions cannot be deleted');
END;

-- Versions are numbered 1, 2, 3... per recipe and only its owner can append one.
CREATE TRIGGER workflow_versions_sequential
BEFORE INSERT ON workflow_versions
WHEN NEW.version_number <> COALESCE((SELECT MAX(version_number) FROM workflow_versions WHERE workflow_id = NEW.workflow_id), 0) + 1
BEGIN
  SELECT RAISE(ABORT, 'versions must be numbered sequentially');
END;

CREATE TRIGGER workflow_versions_owner_only
BEFORE INSERT ON workflow_versions
WHEN NEW.created_by IS NOT (SELECT owner_id FROM workflows WHERE id = NEW.workflow_id)
BEGIN
  SELECT RAISE(ABORT, 'only the recipe owner can save a version');
END;

-- Owner, workspace and fork source never change.
CREATE TRIGGER workflows_identity_immutable
BEFORE UPDATE ON workflows
WHEN NEW.owner_id IS NOT OLD.owner_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.forked_from_version_id IS NOT OLD.forked_from_version_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'owner, workspace and fork source of a recipe cannot change');
END;

-- The current pointer must be a version of the same recipe.
CREATE TRIGGER workflows_current_version_insert
BEFORE INSERT ON workflows
WHEN NEW.current_version_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'current_version_id must be a version of this recipe');
END;

CREATE TRIGGER workflows_current_version_update
BEFORE UPDATE OF current_version_id ON workflows
WHEN NEW.current_version_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workflow_versions v WHERE v.id = NEW.current_version_id AND v.workflow_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'current_version_id must be a version of this recipe');
END;

-- A run starts as running, pins a version of its own recipe, and is final once finished.
CREATE TRIGGER runs_start_running
BEFORE INSERT ON runs
WHEN NEW.status <> 'running'
  OR NOT EXISTS (SELECT 1 FROM workflow_versions v WHERE v.id = NEW.version_id AND v.workflow_id = NEW.workflow_id)
BEGIN
  SELECT RAISE(ABORT, 'a run must start as running and pin a version of its recipe');
END;

CREATE TRIGGER runs_final
BEFORE UPDATE ON runs
WHEN OLD.status <> 'running'
BEGIN
  SELECT RAISE(ABORT, 'a finished run is final');
END;

CREATE TRIGGER runs_pinned
BEFORE UPDATE ON runs
WHEN NEW.version_id IS NOT OLD.version_id
  OR NEW.workflow_id IS NOT OLD.workflow_id
  OR NEW.runner_id IS NOT OLD.runner_id
  OR NEW.parameters IS NOT OLD.parameters
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'a run keeps its version, runner and parameters');
END;

-- The audit log is append-only.
CREATE TRIGGER events_append_only_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'the audit log is append-only');
END;

CREATE TRIGGER events_append_only_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'the audit log is append-only');
END;
`,
  },
  {
    id: 2,
    name: 'session_expiry_index',
    // Expired sessions are purged on every sign-in.
    sql: `CREATE INDEX sessions_expiry_idx ON sessions(expires_at);`,
  },
  {
    id: 3,
    name: 'accounts_and_teams',
    sql: /* sql */ `
-- The workspace a signed-in browser is working in, plus what the account page shows.
ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300);
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

-- Shared demo accounts can't have their password, name or membership changed.
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1));
UPDATE users SET is_demo = 1 WHERE email LIKE '%@demo.local';

-- Invitations. Only a hash of the link's token is stored, like sessions.
CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  role         TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  email        TEXT COLLATE NOCASE CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  expires_at   TEXT NOT NULL,
  max_uses     INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 1000),
  uses         INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at   TEXT,
  CHECK (uses <= max_uses),
  CHECK (email IS NULL OR max_uses = 1)
) STRICT;
CREATE INDEX invites_workspace_idx ON invites(workspace_id, created_at);

-- Password reset links: single use, short-lived, hash only.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL,
  used_at    TEXT
) STRICT;
CREATE INDEX password_resets_user_idx ON password_resets(user_id);

-- A recipe's workspace and fork source never change. Ownership may move, but
-- only to an admin or member of the same workspace (when someone leaves, their
-- recipes stay with the team).
DROP TRIGGER workflows_identity_immutable;
CREATE TRIGGER workflows_identity_immutable
BEFORE UPDATE ON workflows
WHEN NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.forked_from_version_id IS NOT OLD.forked_from_version_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'workspace and fork source of a recipe cannot change');
END;

CREATE TRIGGER workflows_owner_transfer
BEFORE UPDATE OF owner_id ON workflows
WHEN NEW.owner_id IS NOT OLD.owner_id
  AND NOT EXISTS (
    SELECT 1 FROM workspace_members m
     WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.owner_id AND m.role IN ('admin','member')
  )
BEGIN
  SELECT RAISE(ABORT, 'a recipe can only be transferred to an admin or member of its workspace');
END;
`,
  },
  {
    id: 4,
    name: 'archive_and_audit',
    sql: /* sql */ `
-- A retired recipe: out of the library, not runnable until restored; history kept.
ALTER TABLE workflows ADD COLUMN archived_at TEXT;
CREATE INDEX workflows_active_idx ON workflows(workspace_id, archived_at, updated_at);
-- The audit log is read newest first per workspace and type.
CREATE INDEX events_workspace_type_idx ON events(workspace_id, type, id);
`,
  },
  {
    id: 5,
    name: 'api_tokens',
    sql: /* sql */ `
-- Personal API tokens for scripts: shown once, only their hash is stored, revocable, and they expire.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id, created_at);
`,
  },
  {
    id: 6,
    name: 'two_step_sign_in',
    sql: /* sql */ `
-- Two-step sign-in with an authenticator app (TOTP). Secrets are encrypted with a
-- key kept outside the database (see src/server/secrets.ts); pending holds the
-- secret between showing the QR code and the first correct code.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
-- The last time step accepted: a code works once, and never an older one after it.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

-- Turned on means a secret and a start time, together.
CREATE TRIGGER users_totp_consistent
BEFORE UPDATE OF totp_secret, totp_enabled_at ON users
WHEN (NEW.totp_secret IS NULL) <> (NEW.totp_enabled_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'two-step sign-in needs both a secret and a start time');
END;

-- Shared demo accounts can't turn it on: one visitor could lock everyone else out.
CREATE TRIGGER users_demo_no_totp
BEFORE UPDATE OF totp_secret, totp_pending_secret ON users
WHEN NEW.is_demo = 1 AND (NEW.totp_secret IS NOT NULL OR NEW.totp_pending_secret IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'demo accounts can''t use two-step sign-in');
END;

-- Single-use recovery codes for a lost phone. Only a hash is stored.
CREATE TABLE recovery_codes (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL CHECK (length(code_hash) = 64),
  created_at TEXT NOT NULL,
  used_at    TEXT,
  UNIQUE (user_id, code_hash)
) STRICT;

-- The password was right and a code is still owed: five minutes, five tries, hash only.
CREATE TABLE sign_in_challenges (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
) STRICT;
CREATE INDEX sign_in_challenges_user_idx ON sign_in_challenges(user_id);
CREATE INDEX sign_in_challenges_expiry_idx ON sign_in_challenges(expires_at);
`,
  },
  {
    id: 7,
    name: 'workspace_time_zone',
    sql: /* sql */ `
-- Each workspace keeps its own calendar: "today" for relative dates and the
-- dashboard's days. An IANA name, checked by the app (SQLite has no zone list).
ALTER TABLE workspaces ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 64);
`,
  },
]
