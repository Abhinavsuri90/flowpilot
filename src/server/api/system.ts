import { json } from '../http'
import { modelStatus } from '../ai/config'
import { LIMITS } from '../../lib/workflow/schema'
import type { SystemInfo } from '../../lib/types'
import type { AuthedContext } from './context'

const TABLES = ['users', 'sessions', 'workspaces', 'workspace_members', 'workflows', 'workflow_versions', 'runs', 'events'] as const

/** Live structure of the running system for the System design page. Structure only, never rows. */
export function get({ db }: AuthedContext, endpoints: SystemInfo['endpoints']): Response {
  const tables = TABLES.map((name) => ({
    name,
    columns: (
      db.prepare(`SELECT name, type, "notnull" AS not_null, pk, dflt_value FROM pragma_table_info(?)`).all(name) as Array<{
        name: string
        type: string
        not_null: number
        pk: number
        dflt_value: string | null
      }>
    ).map((c) => ({ name: c.name, type: c.type, notNull: c.not_null === 1, primaryKey: c.pk > 0, defaultValue: c.dflt_value })),
  }))
  const triggers = db
    .prepare(`SELECT name, tbl_name AS "table" FROM sqlite_master WHERE type = 'trigger' ORDER BY tbl_name, name`)
    .all() as Array<{ name: string; table: string }>
  const indexes = db
    .prepare(`SELECT name, tbl_name AS "table" FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name`)
    .all() as Array<{ name: string; table: string }>
  const migrations = (db.prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id').all() as Array<{
    id: number
    name: string
    applied_at: string
  }>).map((m) => ({ id: m.id, name: m.name, appliedAt: m.applied_at }))

  const body: SystemInfo = {
    tables,
    triggers,
    indexes,
    migrations,
    limits: { ...LIMITS },
    model: modelStatus(),
    runtime: {
      node: process.version,
      sqlite: db.prepare('SELECT sqlite_version()').pluck().get() as string,
      journalMode: String(db.pragma('journal_mode', { simple: true })),
      foreignKeys: db.pragma('foreign_keys', { simple: true }) === 1,
    },
    endpoints,
  }
  return json(body)
}
