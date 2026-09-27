import { json } from '../http'
import { currentMembership } from '../auth'
import { countWorkflows, listRuns, reapStaleRuns, toRunSummary } from '../repo'
import { listActivity } from '../events'
import { modelStatus } from '../ai/config'
import { addDays, dayIn, todayIn } from '../../lib/dates'
import type { Dashboard } from '../../lib/types'
import type { AuthedContext } from './context'

const DAY = 24 * 60 * 60 * 1000

/** Every number is computed from the caller's own permitted data; nothing is invented. */
export function get({ db, user }: AuthedContext): Response {
  reapStaleRuns(db)
  const now = Date.now()
  const since7 = new Date(now - 7 * DAY).toISOString()
  // Recipe numbers and activity are for the workspace in use; runs are personal.
  const membership = currentMembership(user)
  const workspaceId = membership?.workspaceId ?? null

  const myRuns7d = db.prepare('SELECT COUNT(*) FROM runs WHERE runner_id = ? AND created_at >= ?').pluck().get(user.id, since7) as number
  const succeeded7d = db
    .prepare(`SELECT COUNT(*) FROM runs WHERE runner_id = ? AND created_at >= ? AND status = 'succeeded'`)
    .pluck()
    .get(user.id, since7) as number
  const sharedByMe = db
    .prepare(`SELECT COUNT(*) FROM workflows WHERE owner_id = ? AND workspace_id IS ? AND visibility = 'team'`)
    .pluck()
    .get(user.id, workspaceId) as number
  // Copies other people made of my recipes: a count only, never who or what.
  const copiesOfMine = db
    .prepare(
      `SELECT COUNT(*) FROM workflows f
         JOIN workflow_versions v ON v.id = f.forked_from_version_id
         JOIN workflows src ON src.id = v.workflow_id
        WHERE src.owner_id = @me AND f.owner_id <> @me AND src.workspace_id IS @ws`,
    )
    .pluck()
    .get({ me: user.id, ws: workspaceId }) as number
  const createdAny =
    (db.prepare('SELECT COUNT(*) FROM workflows WHERE owner_id = ? AND workspace_id IS ? AND is_example = 0').pluck().get(user.id, workspaceId) as number) > 0
  const ranAny = (db.prepare('SELECT COUNT(*) FROM runs WHERE runner_id = ?').pluck().get(user.id) as number) > 0
  const teamSize = workspaceId ? (db.prepare('SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?').pluck().get(workspaceId) as number) : 0

  // 14 days of the workspace's calendar, oldest first: a run at 01:30 in India counts
  // on that Indian day, not on the previous UTC one. Runs are bucketed here rather than
  // in SQL, which has no time zones; 15 UTC days back safely covers any zone's 14.
  const timeZone = membership?.timeZone ?? 'UTC'
  const today = todayIn(timeZone, now)
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13))
  const recent = db
    .prepare(`SELECT created_at, status FROM runs WHERE runner_id = ? AND created_at >= ? AND status <> 'running'`)
    .all(user.id, new Date(now - 15 * DAY).toISOString()) as Array<{ created_at: string; status: 'succeeded' | 'failed' }>
  const tally = new Map<string, { succeeded: number; failed: number }>(days.map((date) => [date, { succeeded: 0, failed: 0 }]))
  for (const run of recent) {
    const day = tally.get(dayIn(run.created_at, timeZone))
    if (day) day[run.status] += 1
  }
  const runsByDay = days.map((date) => ({ date, ...tally.get(date)! }))

  const body: Dashboard = {
    stats: {
      myRecipes: workspaceId ? countWorkflows(db, user, { scope: 'mine', workspaceId }) : 0,
      sharedByMe,
      teamRecipes: workspaceId ? countWorkflows(db, user, { scope: 'team', workspaceId }) : 0,
      myRuns7d,
      succeeded7d,
      copiesOfMine,
    },
    runsByDay,
    recentRuns: listRuns(db, user.id, { limit: 6 }).map((run) => toRunSummary(db, user, run)),
    activity: listActivity(db, user, workspaceId, 12),
    model: modelStatus(),
    checklist: { created: createdAny, ran: ranAny, shared: sharedByMe > 0, copied: copiesOfMine > 0, invited: teamSize > 1 },
  }
  return json(body)
}
