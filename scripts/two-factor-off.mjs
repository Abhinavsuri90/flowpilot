// Turns two-step sign-in off for one account, for someone who lost both their
// phone and their recovery codes. Check who is asking some other way first (a
// call, a colleague): this removes the second step from their sign-in.
//
//   npm run two-factor:off -- person@company.com
//   docker compose exec -u node app node scripts/two-factor-off.mjs person@company.com
//
// Plain JavaScript on purpose: the production image carries only the server
// bundle, so this runs there with the same SQLite build as the app.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const bundled = '/app/.output/server/node_modules/better-sqlite3'
const Database = require(existsSync(bundled) ? bundled : 'better-sqlite3')

const email = (process.argv[2] ?? '').trim()
if (!email.includes('@')) {
  console.error('Usage: npm run two-factor:off -- person@company.com')
  process.exit(2)
}
const path = resolve(process.env.DATABASE_PATH ?? './data/flowpilot.db')
if (!existsSync(path)) {
  console.error(`No database at ${path}`)
  process.exit(1)
}

const db = new Database(path, { fileMustExist: true })
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
try {
  // Emails compare case-insensitively (the column is COLLATE NOCASE).
  const user = db.prepare('SELECT id, totp_enabled_at FROM users WHERE email = ?').get(email)
  if (!user) {
    console.error(`No account for ${email} in ${path}.`)
    process.exitCode = 1
  } else if (!user.totp_enabled_at) {
    console.log(`Two-step sign-in is already off for ${email}.`)
  } else {
    // The same change as turning it off in Account settings (src/server/twofactor.ts, turnOff).
    db.transaction(() => {
      db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?').run(user.id)
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id)
      db.prepare('DELETE FROM sign_in_challenges WHERE user_id = ?').run(user.id)
    })()
    console.log(`Two-step sign-in is now off for ${email}. They sign in with their password and can turn it on again with a new phone.`)
  }
} finally {
  db.close()
}
