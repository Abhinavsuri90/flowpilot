import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { canonicalTimeZone, dayIn, isTimeZone, todayIn } from '../src/lib/dates'
import { AS_OF_KEY } from '../src/lib/workflow/describe'
import { MONTHLY_PAID_REVENUE, REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Each workspace keeps its own calendar: "today" for relative dates, the
// dashboard's days and the run panel's default day follow the workspace's time
// zone, not the server's UTC clock.

/** 20:00 UTC on 27 Sep is already 01:30 on 28 Sep in India. */
const LATE_EVENING_UTC = Date.UTC(2026, 8, 27, 20, 0, 0)
const PASSWORD = 'correct horse battery 42'

describe('time zone helpers', () => {
  it('know which day a moment falls on in any zone', () => {
    const moment = new Date(LATE_EVENING_UTC)
    expect(dayIn(moment, 'UTC')).toBe('2026-09-27')
    expect(dayIn(moment, 'Asia/Kolkata')).toBe('2026-09-28')
    expect(dayIn(moment, 'America/Los_Angeles')).toBe('2026-09-27')
    expect(dayIn(Date.UTC(2026, 8, 27, 18, 29), 'Asia/Kolkata')).toBe('2026-09-27')
    expect(dayIn(Date.UTC(2026, 8, 27, 18, 30), 'Asia/Kolkata')).toBe('2026-09-28')
    // Across a daylight-saving change, and from a stored timestamp.
    expect(dayIn('2026-03-08T07:59:00.000Z', 'America/New_York')).toBe('2026-03-08')
    expect(dayIn('2026-11-01T04:30:00.000Z', 'America/New_York')).toBe('2026-11-01')
    expect(todayIn('Asia/Kolkata', LATE_EVENING_UTC)).toBe('2026-09-28')
  })

  it('use the names people know today for zones some browsers still report by their old names', () => {
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(canonicalTimeZone('Europe/Kiev')).toBe('Europe/Kyiv')
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(canonicalTimeZone('Europe/London')).toBe('Europe/London')
    expect(dayIn(LATE_EVENING_UTC, 'Asia/Calcutta')).toBe(dayIn(LATE_EVENING_UTC, 'Asia/Kolkata'))
  })

  it('accept real zone names only', () => {
    for (const ok of ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) expect(isTimeZone(ok), ok).toBe(true)
    for (const bad of ['', 'Mars/Olympus', 'Asia/Kolkata; DROP TABLE', 'x'.repeat(65), ' Asia/Kolkata', 42, null, undefined]) {
      expect(isTimeZone(bad), String(bad)).toBe(false)
    }
  })
})

describe('a workspace’s time zone', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(LATE_EVENING_UTC)
    await freshApp()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function newTeam(email: string, timeZone?: unknown) {
    const client = new Client()
    const res = await client.post('/api/auth/register', { name: 'Sam Patel', email, password: PASSWORD, workspaceName: 'Acme Finance', timeZone })
    expect(res.status, res.text).toBe(201)
    return { client, me: res.body }
  }

  it('comes from the browser at sign-up, falls back to UTC, and only admins change it (with an audit entry)', async () => {
    const { client: sam, me } = await newTeam('sam@acme.test', 'Asia/Kolkata')
    expect(me.workspace).toMatchObject({ workspaceName: 'Acme Finance', timeZone: 'Asia/Kolkata' })
    // Chrome reports India as Asia/Calcutta: it is stored under the name people know.
    expect((await newTeam('chrome@acme.test', 'Asia/Calcutta')).me.workspace.timeZone).toBe('Asia/Kolkata')
    // A browser that sends nothing, or nonsense, still gets its account, on UTC.
    expect((await newTeam('odd@acme.test', 'Mars/Olympus')).me.workspace.timeZone).toBe('UTC')
    expect((await newTeam('none@acme.test')).me.workspace.timeZone).toBe('UTC')

    const changed = await sam.patch('/api/workspace', { timeZone: 'Europe/London' })
    expect(changed.status, changed.text).toBe(200)
    expect(changed.body.workspace).toMatchObject({ name: 'Acme Finance', timeZone: 'Europe/London' })
    expect((await sam.get('/api/workspace')).body.workspace.timeZone).toBe('Europe/London')
    expect((await sam.get('/api/me')).body.workspace.timeZone).toBe('Europe/London')

    const bad = await sam.patch('/api/workspace', { timeZone: 'Mars/Olympus' })
    expect(bad.status).toBe(422)
    expect(bad.body.error.issues).toEqual([{ path: 'timeZone', message: 'Choose a time zone from the list' }])
    expect((await sam.patch('/api/workspace', {})).status).toBe(422)

    const audit = await sam.get('/api/workspace/audit?category=workspace')
    expect(audit.body.entries.map((e: { text: string }) => e.text)).toContain('Sam Patel changed the time zone from Asia/Kolkata to Europe/London')

    // Members can't, and the shared demo workspaces keep theirs.
    expect((await (await signIn('vikram')).patch('/api/workspace', { timeZone: 'UTC' })).status).toBe(403)
    const demo = await (await signIn('asha')).patch('/api/workspace', { timeZone: 'UTC' })
    expect(demo.status).toBe(403)
    expect(demo.body.error.message).toBe('Demo workspaces keep their settings')
  })

  it('decides what “today” means for a run that doesn’t say, and the run records it', async () => {
    const asha = await signIn('asha') // Sales keeps India time
    expect((await asha.get('/api/me')).body.workspace.timeZone).toBe('Asia/Kolkata')
    const created = await asha.post('/api/workflows', { title: 'Months', definition: MONTHLY_PAID_REVENUE })
    const inIndia = await asha.run(created.body.version.id, fixture('orders_dated.csv'))
    expect(inIndia.status, inIndia.text).toBe(201)
    expect(inIndia.body.parameters[AS_OF_KEY]).toBe('2026-09-28')

    const { client: sam } = await newTeam('sam@acme.test')
    const utc = await sam.post('/api/workflows', { title: 'Months', definition: MONTHLY_PAID_REVENUE })
    const onUtc = await sam.run(utc.body.version.id, fixture('orders_dated.csv'))
    expect(onUtc.body.parameters[AS_OF_KEY]).toBe('2026-09-27')
    // The recipe page hands the browser the same day, so a click and a script agree.
    expect((await asha.get(`/api/workflows/${created.body.workflow.id}`)).body.today).toBe('2026-09-28')
    expect((await sam.get(`/api/workflows/${utc.body.workflow.id}`)).body.today).toBe('2026-09-27')
  })

  it('counts the dashboard’s days in the workspace’s zone', async () => {
    const asha = await signIn('asha')
    const created = await asha.post('/api/workflows', { title: 'Late run', definition: ORIGINAL })
    expect((await asha.run(created.body.version.id, fixture('sales_A.csv'))).status).toBe(201)
    const days = (await asha.get('/api/dashboard')).body.runsByDay as Array<{ date: string; succeeded: number }>
    expect(days).toHaveLength(14)
    expect(days.at(-1)).toEqual({ date: '2026-09-28', succeeded: 1, failed: 0 })
    expect(days[0]!.date).toBe('2026-09-15')

    const { client: sam } = await newTeam('sam@acme.test')
    const mine = await sam.post('/api/workflows', { title: 'Late run', definition: ORIGINAL })
    await sam.run(mine.body.version.id, fixture('sales_A.csv'))
    expect(((await sam.get('/api/dashboard')).body.runsByDay as Array<{ date: string; succeeded: number }>).at(-1)).toEqual({ date: '2026-09-27', succeeded: 1, failed: 0 })
  })
})
