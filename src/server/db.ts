import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MIGRATIONS } from './migrations'

export type DB = Database.Database

const DEFAULT_PATH = './data/flowpilot.db'

export function databasePath(): string {
  return process.env.DATABASE_PATH || DEFAULT_PATH
}

/** Opens (and creates if needed) a SQLite database and applies pending migrations. */
export function openDatabase(path: string = databasePath()): DB {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     ) STRICT`,
  )
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').pluck().all() as number[])
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      )
    })()
  }
}

// One connection per process. It is kept on globalThis so Vite's server HMR
// does not open a new connection every time a server module reloads.
const holder = globalThis as typeof globalThis & { __flowpilotDb?: DB }

export function getDb(): DB {
  if (!holder.__flowpilotDb) holder.__flowpilotDb = openDatabase()
  return holder.__flowpilotDb
}

/** Swaps the process-wide connection (tests use an in-memory database). */
export function setDatabase(db: DB): DB {
  holder.__flowpilotDb = db
  return db
}

/** Runs `fn` in one transaction on the current connection. */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}
