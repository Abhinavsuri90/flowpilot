// Online backup of the SQLite database: safe while the app is serving requests,
// because SQLite's backup API copies a consistent snapshot. Each copy is
// integrity-checked, and only the newest ones are kept.
//
//   node scripts/backup-db.mjs [target-dir] [keep]
//
// In the production image (see deploy/oracle/backup.sh) it runs next to the
// server bundle and uses the same SQLite build as the app.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const bundled = '/app/.output/server/node_modules/better-sqlite3'
const Database = require(existsSync(bundled) ? bundled : 'better-sqlite3')

const source = resolve(process.env.DATABASE_PATH ?? './data/flowpilot.db')
const targetDir = resolve(process.argv[2] ?? join(dirname(source), 'backups'))
const keep = Number.parseInt(process.argv[3] ?? '14', 10)
if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a whole number of at least 1')
if (!existsSync(source)) throw new Error(`No database at ${source}`)

mkdirSync(targetDir, { recursive: true })
// 2026-09-26T21-40-05Z: sorts by time, and is a valid file name everywhere.
const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-') + 'Z'
const target = join(targetDir, `flowpilot-${stamp}.db`)

const db = new Database(source, { fileMustExist: true })
try {
  await db.backup(target)
} finally {
  db.close()
}

// The copy inherits WAL mode; switch it to a single self-contained file.
const copy = new Database(target)
copy.pragma('journal_mode = DELETE')
const check = copy.pragma('integrity_check', { simple: true })
copy.close()
if (check !== 'ok') {
  rmSync(target, { force: true })
  throw new Error(`The backup failed its integrity check (${check}); nothing was kept.`)
}

const backups = readdirSync(targetDir)
  .filter((name) => /^flowpilot-.+\.db$/.test(name))
  .sort()
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(targetDir, old + suffix), { force: true })
}

const kib = Math.max(1, Math.round(statSync(target).size / 1024))
console.log(`Backed up ${source} to ${target} (${kib} KiB, integrity ok); keeping the newest ${keep}.`)
