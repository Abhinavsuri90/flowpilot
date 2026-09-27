import type { DB } from './db'
import { hashPassword } from './auth'
import { newId } from './ids'
import { createWorkflow } from './repo'
import { recordEvent } from './events'
import { DEMO_PEOPLE, type DemoKey } from '../lib/demo'
import { SEED_EXAMPLES } from '../lib/workflow/examples'

export const DEFAULT_SEED_PASSWORD = 'flowpilot-demo'

export { DEMO_PEOPLE, type DemoKey } from '../lib/demo'

export type SeedResult = {
  users: Record<DemoKey, string>
  workspaces: Record<'Sales' | 'Marketing', string>
  examples: Record<(typeof SEED_EXAMPLES)[number]['key'], string>
}

export function isSeeded(db: DB): boolean {
  return (db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number) > 0
}

/**
 * Seeds identity, tenancy and two labelled examples in one transaction; call
 * only on an empty database. "Regional revenue exceptions" is not seeded: Asha
 * creates it live in the demo.
 */
export async function seedDatabase(db: DB, opts: { password?: string } = {}): Promise<SeedResult> {
  const password = opts.password || DEFAULT_SEED_PASSWORD
  // Hash outside the transaction (scrypt is async).
  const hashes = await Promise.all(DEMO_PEOPLE.map(() => hashPassword(password)))

  const result: SeedResult = {
    users: {} as SeedResult['users'],
    workspaces: { Sales: newId('ws'), Marketing: newId('ws') },
    examples: {} as SeedResult['examples'],
  }

  db.transaction(() => {
    // The demo teams work in India, like the rupee amounts in their files.
    const insertWorkspace = db.prepare(`INSERT INTO workspaces (id, name, time_zone) VALUES (?, ?, 'Asia/Kolkata')`)
    for (const [name, id] of Object.entries(result.workspaces)) insertWorkspace.run(id, name)

    // Demo accounts are shared, so they can't change their password, name or memberships.
    const insertUser = db.prepare(
      'INSERT INTO users (id, email, display_name, password_hash, avatar_hue, is_demo) VALUES (?, ?, ?, ?, ?, 1)',
    )
    const insertMember = db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)')
    DEMO_PEOPLE.forEach((person, i) => {
      const id = newId('usr')
      result.users[person.key] = id
      insertUser.run(id, person.email, person.name, hashes[i], person.hue)
      insertMember.run(result.workspaces[person.workspace], id, person.role)
    })

    for (const example of SEED_EXAMPLES) {
      const ownerId = result.users[example.owner]
      const workspaceId = result.workspaces[example.workspace]
      const { workflow } = createWorkflow(db, {
        ownerId,
        workspaceId,
        title: example.title,
        description: example.description,
        definition: example.definition,
        visibility: 'team',
        isExample: true,
      })
      result.examples[example.key] = workflow.id
      recordEvent(db, { workspaceId, actorId: ownerId, type: 'workflow.created', workflowId: workflow.id, detail: { versionNumber: 1 } })
      recordEvent(db, { workspaceId, actorId: ownerId, type: 'workflow.shared', workflowId: workflow.id })
    }
  })()

  return result
}
