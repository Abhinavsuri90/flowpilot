// Seeds the demo database.
//   npm run seed         seed an empty database (refuses to touch existing data)
//   npm run seed:reset   delete the database file and seed from scratch
//   predev (--if-empty)  seed only when the database has no users yet
import { rmSync } from 'node:fs'
import { loadEnv } from '../src/server/env'
import { databasePath, openDatabase } from '../src/server/db'
import { isSeeded, seedDatabase } from '../src/server/seed'

loadEnv()
const args = new Set(process.argv.slice(2))
const path = databasePath()

if (args.has('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
  console.log(`[seed] removed ${path}`)
}

const db = openDatabase(path)

if (isSeeded(db)) {
  console.log(
    args.has('--if-empty')
      ? `[seed] ${path} already has data; leaving it as is`
      : `[seed] ${path} already has data. Run "npm run seed:reset" to start over.`,
  )
} else {
  const password = process.env.SEED_PASSWORD
  const result = await seedDatabase(db, { password })
  console.log(
    `[seed] seeded ${path}: ${Object.keys(result.users).length} demo accounts in Sales and Marketing` +
      (password ? ' (password from SEED_PASSWORD)' : ' (password: flowpilot-demo)'),
  )
}
db.close()
