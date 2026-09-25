import type { DB } from './db'
import { hashPassword } from './auth'
import { newId } from './ids'
import { DEMO_PEOPLE, type DemoKey } from '../lib/demo'

export const DEFAULT_SEED_PASSWORD = 'flowpilot-demo'

export { DEMO_PEOPLE, type DemoKey } from '../lib/demo'

export type SeedResult = {
  users: Record<DemoKey, string>
  workspaces: Record<'Sales' | 'Marketing', string>
}

export function isSeeded(db: DB): boolean {
  return (db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number) > 0
}

/** Seeds identity and tenancy. Runs in one transaction; call only on an empty database. */
export async function seedDatabase(db: DB, opts: { password?: string } = {}): Promise<SeedResult> {
  const password = opts.password || DEFAULT_SEED_PASSWORD
  // Hash outside the transaction (scrypt is async).
  const hashes = await Promise.all(DEMO_PEOPLE.map(() => hashPassword(password)))

  const result: SeedResult = {
    users: {} as SeedResult['users'],
    workspaces: { Sales: newId('ws'), Marketing: newId('ws') },
  }

  db.transaction(() => {
    const insertWorkspace = db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)')
    for (const [name, id] of Object.entries(result.workspaces)) insertWorkspace.run(id, name)

    const insertUser = db.prepare(
      'INSERT INTO users (id, email, display_name, password_hash, avatar_hue) VALUES (?, ?, ?, ?, ?)',
    )
    const insertMember = db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)')
    DEMO_PEOPLE.forEach((person, i) => {
      const id = newId('usr')
      result.users[person.key] = id
      insertUser.run(id, person.email, person.name, hashes[i], person.hue)
      insertMember.run(result.workspaces[person.workspace], id, person.role)
    })
  })()

  return result
}
