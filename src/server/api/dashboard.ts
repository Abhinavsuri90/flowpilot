import { json } from '../http'
import { countWorkflows, listRuns, reapStaleRuns, toRunSummary } from '../repo'
import { listActivity } from '../events'
import { modelStatus } from '../ai/config'
import type { Dashboard } from '../../lib/types'
import type { AuthedContext } from './context'

const DAY = 24 * 60 * 60 * 1000

/** Every number is computed from the caller's own permitted data; nothing is invented. */
export function get({ db, user }: AuthedContext): Response {
  reapStaleRuns(db)
  const now = Date.now()
  const since7 = new Date(now - 7 * DAY).toISOString()

  const myRuns7d = db.prepare('SELECT COUNT(*) FROM runs WHERE runner_id = ? AND created_at >= ?').pluck().get(user.id, since7) as number
  const succeeded7d = db
    .prepare(`SELECT COUNT(*) FROM runs WHERE runner_id = ? AND created_at >= ? AND status = 'succeeded'`)
    .pluck()
    .get(user.id, since7) as number
  const sharedByMe = db.prepare(`SELECT COUNT(*) FROM workflows WHERE owner_id = ? AND visibility = 'team'`).pluck().get(user.id) as number
  // Copies other people made of my recipes: a count only, never who or what.
  const copiesOfMine = db
    .prepare(
      `SELECT COUNT(*) FROM workflows f
         JOIN workflow_versions v ON v.id = f.forked_from_version_id
         JOIN workflows src ON src.id = v.workflow_id
        WHERE src.owner_id = @me AND f.owner_id <> @me`,
    )
    .pluck()
    .get({ me: user.id }) as number
  const createdAny = (db.prepare('SELECT COUNT(*) FROM workflows WHERE owner_id = ? AND is_example = 0').pluck().get(user.id) as number) > 0
  const ranAny = (db.prepare('SELECT COUNT(*) FROM runs WHERE runner_id = ?').pluck().get(user.id) as number) > 0

  // 14 UTC days, oldest first.
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() - (13 - i) * DAY).toISOString().slice(0, 10))
  const counts = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, status, COUNT(*) AS n FROM runs
        WHERE runner_id = ? AND created_at >= ? AND status <> 'running'
        GROUP BY day, status`,
    )
    .all(user.id, `${days[0]}T00:00:00.000Z`) as Array<{ day: string; status: 'succeeded' | 'failed'; n: number }>
  const runsByDay = days.map((date) => ({
    date,
    succeeded: counts.find((c) => c.day === date && c.status === 'succeeded')?.n ?? 0,
    failed: counts.find((c) => c.day === date && c.status === 'failed')?.n ?? 0,
  }))

  const body: Dashboard = {
    stats: {
      myRecipes: countWorkflows(db, user, 'mine'),
      sharedByMe,
      teamRecipes: countWorkflows(db, user, 'team'),
      myRuns7d,
      succeeded7d,
      copiesOfMine,
    },
    runsByDay,
    recentRuns: listRuns(db, user.id, { limit: 6 }).map((run) => toRunSummary(db, user, run)),
    activity: listActivity(db, user, 12),
    model: modelStatus(),
    checklist: { created: createdAny, ran: ranAny, shared: sharedByMe > 0, copied: copiesOfMine > 0 },
  }
  return json(body)
}
