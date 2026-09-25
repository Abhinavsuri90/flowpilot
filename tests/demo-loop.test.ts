import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, freshApp, pairs, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL, groupedBy } from '../src/lib/workflow/examples'

// The demo script, end to end through handleApi: describe → review → save → run
// → share → a second person runs it on their own file → forks it → the fork
// runs independently, and the original stays unchanged.

let app: Awaited<ReturnType<typeof freshApp>>
let asha: Client
let vikram: Client
let recipeId = ''
let v1 = ''
let copyId = ''
const fetchSpy = vi.fn(async () => {
  throw new Error('the run path must never call the network')
})

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy)
  app = await freshApp()
  asha = await signIn('asha')
  vikram = await signIn('vikram')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe.sequential('the demo loop', () => {
  it('1 · Asha saves the reviewed recipe as private version 1', async () => {
    const res = await asha.post('/api/workflows', {
      title: 'Regional revenue exceptions',
      description: 'Paid orders totalled by region; shows regions below a threshold.',
      definition: ORIGINAL,
    })
    expect(res.status).toBe(201)
    expect(res.body.workflow).toMatchObject({ visibility: 'private', isMine: true, currentVersion: { number: 1 }, stepCount: 3 })
    expect(res.body.workflow.requiredColumns.map((c: { name: string }) => c.name)).toEqual(['status', 'region', 'sales_rep', 'amount'])
    recipeId = res.body.workflow.id
    v1 = res.body.version.id
    expect((await vikram.get('/api/workflows?scope=team')).body.items.map((w: { id: string }) => w.id)).not.toContain(recipeId)
  })

  it('2 · Asha runs it on file A with the default threshold', async () => {
    const res = await asha.run(v1, fixture('sales_A.csv'), undefined, { fileName: 'sales_A.csv' })
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(pairs(res.body.rows)).toEqual([
      ['South', 40000],
      ['West', 70000],
    ])
    expect(res.body).toMatchObject({
      status: 'succeeded',
      versionNumber: 1,
      parameters: { threshold: 100000 },
      summary: '2 rows · status = "paid" · grouped by region · total < ₹1,00,000',
      inputName: 'sales_A.csv',
      inputRows: 6,
      ignoredColumns: ['order_id'],
    })
    expect(res.body.stepLog.map((s: { rowsOut: number }) => s.rowsOut)).toEqual([4, 3, 2])
  })

  it('3 · Asha shares it with the team; it appears in the team library', async () => {
    const res = await asha.patch(`/api/workflows/${recipeId}`, { visibility: 'team' })
    expect(res.status).toBe(200)
    const team = (await vikram.get('/api/workflows?scope=team')).body
    const card = team.items.find((w: { id: string }) => w.id === recipeId)
    expect(card).toMatchObject({ title: 'Regional revenue exceptions', owner: { name: 'Asha Rao' }, canFork: true, forkedFrom: null })
    expect(card.parameterNames).toEqual(['threshold'])
    expect(team.counts.team).toBe(2)
  })

  it('4 · Vikram opens the version-pinned share link', async () => {
    const res = await vikram.get(`/api/workflows/${recipeId}?v=${v1}`)
    expect(res.status).toBe(200)
    expect(res.body.version).toMatchObject({ id: v1, number: 1, isLatest: true })
    expect(res.body.permissions).toMatchObject({
      run: { allowed: true },
      fork: { allowed: true },
      edit: { allowed: false, status: 403 },
      share: { allowed: false, status: 403 },
    })
  })

  it('5 · Vikram runs it on his own file B with no model call', async () => {
    const res = await vikram.run(v1, fixture('sales_B.csv'), undefined, { fileName: 'sales_B.csv' })
    expect(res.status).toBe(201)
    expect(pairs(res.body.rows)).toEqual([
      ['North', 70000],
      ['West', 20000],
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('6 · A run parameter changes only that run, never the recipe', async () => {
    const res = await vikram.run(v1, fixture('sales_B.csv'), { threshold: 50000 })
    expect(pairs(res.body.rows)).toEqual([['West', 20000]])
    expect(res.body.parameters).toEqual({ threshold: 50000 })
    const detail = (await vikram.get(`/api/workflows/${recipeId}`)).body
    expect(detail.version.definition.parameters.threshold.default).toBe(100000)
    expect(detail.latestVersionNumber).toBe(1)
  })

  it('7 · Each person sees only their own runs', async () => {
    const mine = (await vikram.get(`/api/runs?workflowId=${recipeId}`)).body.runs
    expect(mine).toHaveLength(2)
    expect(mine.every((r: { recipeAvailable: boolean }) => r.recipeAvailable)).toBe(true)
    const hers = (await asha.get(`/api/runs?workflowId=${recipeId}`)).body.runs
    expect(hers).toHaveLength(1)
    expect(hers[0].inputName).toBe('sales_A.csv')
  })

  it('8 · Vikram makes a private copy of v1 that remembers where it came from', async () => {
    const res = await vikram.post(`/api/workflows/${recipeId}/fork`, { versionId: v1, title: 'Rep revenue exceptions' })
    expect(res.status).toBe(201)
    copyId = res.body.workflow.id
    expect(res.body.workflow).toMatchObject({
      visibility: 'private',
      owner: { name: 'Vikram Nair' },
      forkedFrom: { kind: 'visible', workflowId: recipeId, title: 'Regional revenue exceptions', versionNumber: 1 },
    })
  })

  it('9 · The copy groups by sales_rep and runs independently', async () => {
    const saved = await vikram.post(`/api/workflows/${copyId}/versions`, { definition: groupedBy(ORIGINAL, 'sales_rep') })
    expect(saved.status).toBe(201)
    expect(saved.body.version.number).toBe(2)
    const run = await vikram.run(saved.body.version.id, fixture('sales_B.csv'))
    expect(run.body.rows).toEqual([{ sales_rep: 'Asha', total: 90000 }])
    expect(run.body.summary).toBe('1 row · status = "paid" · grouped by sales_rep · total < ₹1,00,000')
  })

  it("10 · Asha's original is unchanged", async () => {
    const detail = (await asha.get(`/api/workflows/${recipeId}`)).body
    expect(detail.latestVersionNumber).toBe(1)
    expect(detail.version.definition).toEqual(ORIGINAL)
    expect(detail.forkCount).toBe(1)
    const rerun = await asha.run(v1, fixture('sales_A.csv'))
    expect(pairs(rerun.body.rows)).toEqual([
      ['South', 40000],
      ['West', 70000],
    ])
  })

  it('11 · The activity feed tells Asha a copy was made without revealing it', async () => {
    const dashboard = (await asha.get('/api/dashboard')).body
    const texts = dashboard.activity.map((a: { text: string }) => a.text)
    expect(texts).toContain('Vikram Nair made a private copy of your Regional revenue exceptions v1')
    expect(JSON.stringify(dashboard)).not.toContain('Rep revenue exceptions')
    expect(JSON.stringify(dashboard)).not.toContain(copyId)
    expect(texts.some((t: string) => t.startsWith('Vikram Nair ran'))).toBe(false)
    expect(dashboard.stats).toMatchObject({ myRecipes: 1, sharedByMe: 1, copiesOfMine: 1, myRuns7d: 2, succeeded7d: 2 })
    expect(dashboard.checklist).toEqual({ created: true, ran: true, shared: true, copied: true })

    const vikramFeed = (await vikram.get('/api/dashboard')).body.activity.map((a: { text: string }) => a.text)
    expect(vikramFeed).toContain('You made a private copy of Regional revenue exceptions v1 as Rep revenue exceptions')
    expect(vikramFeed.filter((t: string) => t.startsWith('You ran')).length).toBeGreaterThanOrEqual(3)
  })

  it('12 · Boundary and empty runs behave as designed, and results download as CSV', async () => {
    const boundary = await asha.run(v1, fixture('sales_A.csv'), { threshold: '70000' })
    expect(pairs(boundary.body.rows)).toEqual([['South', 40000]])

    const empty = await asha.run(v1, fixture('sales_B.csv'), { threshold: 20000 })
    expect(empty.status).toBe(201)
    expect(empty.body.rows).toEqual([])
    expect(empty.body.summary).toBe('No rows matched')
    const emptyCsv = await asha.get(`/api/runs/${empty.body.id}/csv`)
    expect(emptyCsv.text).toBe('region,total')

    const deleted = await asha.del(`/api/runs?workflowId=${recipeId}`)
    expect(deleted.body.deleted).toBe(4)
    expect((await asha.get(`/api/runs?workflowId=${recipeId}`)).body.runs).toEqual([])
    expect((await vikram.get(`/api/runs?workflowId=${recipeId}`)).body.runs).toHaveLength(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
