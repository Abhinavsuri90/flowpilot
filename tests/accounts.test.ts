import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client, PASSWORD, freshApp, signIn } from './helpers/app'
import { fixture } from './helpers/fixtures'
import { mailOutbox } from '../src/server/mail'
import { passwordProblem, passwordStrength } from '../src/lib/account'
import { REGIONAL_REVENUE_EXCEPTIONS as ORIGINAL } from '../src/lib/workflow/examples'

// Accounts and teams: sign-up, invitations, password resets, account settings,
// switching workspaces, and people leaving (their recipes stay with the team).

let app: Awaited<ReturnType<typeof freshApp>>
beforeEach(async () => {
  app = await freshApp()
})
afterEach(() => {
  delete process.env.REGISTRATION
})

const GOOD_PASSWORD = 'correct horse battery 42'

async function register(body: Record<string, unknown>) {
  const client = new Client()
  const res = await client.post('/api/auth/register', body)
  return { client, res }
}

async function newTeam(name = 'Sam Patel', email = 'sam@acme.test', workspaceName = 'Acme Finance') {
  const { client, res } = await register({ name, email, password: GOOD_PASSWORD, workspaceName })
  expect(res.status, res.text).toBe(201)
  return client
}

function lastLink(kind: 'invite' | 'reset-password'): string {
  const mail = [...mailOutbox()].reverse().find((m) => m.text.includes(`/${kind}/`))
  const match = mail?.text.match(new RegExp(`/${kind}/([A-Za-z0-9_-]+)`))
  if (!match) throw new Error(`no ${kind} link in the outbox`)
  return match[1]!
}

describe('sign up', () => {
  it('creates an account and a workspace with you as its admin, signed in', async () => {
    const { client, res } = await register({ name: '  Sam Patel ', email: ' Sam@Acme.TEST ', password: GOOD_PASSWORD, workspaceName: 'Acme Finance' })
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ name: 'Sam Patel', email: 'sam@acme.test', isDemo: false })
    expect(res.body.workspace).toMatchObject({ workspaceName: 'Acme Finance', role: 'admin' })
    expect(res.headers.get('set-cookie')).toMatch(/^fp_session=.+HttpOnly/)
    // Signed in, able to create, and the new workspace starts empty.
    expect((await client.get('/api/me')).body.user.email).toBe('sam@acme.test')
    expect((await client.get('/api/workflows?scope=team')).body.total).toBe(0)
    expect((await client.post('/api/workflows', { title: 'Month end', definition: ORIGINAL })).status).toBe(201)
    // And can sign in again with the same password, whatever the email's case.
    const again = await new Client().post('/api/auth/login', { email: 'SAM@acme.test', password: GOOD_PASSWORD })
    expect(again.status).toBe(200)
  })

  it('rejects missing or weak details field by field', async () => {
    const { res } = await register({ name: '', email: 'not-an-email', password: '1234567890', workspaceName: 'x' })
    expect(res.status).toBe(422)
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toEqual(['name', 'email', 'password', 'workspaceName'])
    expect(passwordProblem('short')).toBe('Use at least 10 characters')
    expect(passwordProblem('password123')).toMatch(/too common/)
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/more than one or two/)
    expect(passwordProblem('samsamsam-2026', { email: 'sam@acme.test' })).toBeNull()
    expect(passwordProblem('patel-is-great', { email: 'patel@acme.test' })).toMatch(/email address/)
    expect(passwordStrength(GOOD_PASSWORD)).toBeGreaterThanOrEqual(3)
  })

  it("refuses an email that's taken (409) and honours REGISTRATION=invite-only / closed", async () => {
    await newTeam()
    const { res } = await register({ name: 'Other', email: 'sam@acme.test', password: GOOD_PASSWORD, workspaceName: 'Other Co' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')

    process.env.REGISTRATION = 'invite-only'
    const noInvite = await register({ name: 'Ann', email: 'ann@acme.test', password: GOOD_PASSWORD, workspaceName: 'Ann Co' })
    expect(noInvite.res.status).toBe(403)
    process.env.REGISTRATION = 'closed'
    expect((await register({ name: 'Ann', email: 'ann@acme.test', password: GOOD_PASSWORD, workspaceName: 'Ann Co' })).res.status).toBe(403)
  })

  it('limits sign-ups from one address', async () => {
    let last = 0
    for (let i = 0; i < 21; i++) {
      last = (await register({ name: `P${i}`, email: `p${i}@acme.test`, password: GOOD_PASSWORD, workspaceName: `Team ${i}` })).res.status
    }
    expect(last).toBe(429)
  })
})

describe('invitations', () => {
  it('an admin invites by link; a new person signs up through it and joins in that role', async () => {
    const sam = await newTeam()
    const created = await sam.post('/api/workspace/invites', { role: 'member' })
    expect(created.status).toBe(201)
    const token = created.body.link.split('/invite/')[1]
    expect(created.body.invite).toMatchObject({ role: 'member', email: null, uses: 0, maxUses: 25 })

    const landing = await new Client().get(`/api/invites/${token}`)
    expect(landing.body).toMatchObject({ workspace: { name: 'Acme Finance' }, invitedBy: 'Sam Patel', role: 'member', viewer: null })

    const { client: ria, res } = await register({ name: 'Ria Shah', email: 'ria@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    expect(res.status).toBe(201)
    expect(res.body.workspace).toMatchObject({ workspaceName: 'Acme Finance', role: 'member' })
    expect(res.body.memberships).toHaveLength(1) // no extra workspace was created

    // Ria sees what Sam shares.
    const recipe = await sam.post('/api/workflows', { title: 'Month end', definition: ORIGINAL })
    await sam.patch(`/api/workflows/${recipe.body.workflow.id}`, { visibility: 'team' })
    expect((await ria.get('/api/workflows?scope=team')).body.items.map((w: { title: string }) => w.title)).toEqual(['Month end'])
    expect((await sam.get('/api/workspace/invites')).body.invites[0].uses).toBe(1)
  })

  it('email invites work once, only for that address, and are emailed', async () => {
    const sam = await newTeam()
    const created = await sam.post('/api/workspace/invites', { role: 'viewer', email: 'Dev@Acme.test' })
    expect(created.body.invite).toMatchObject({ email: 'dev@acme.test', maxUses: 1 })
    const token = lastLink('invite')
    expect(created.body.link.endsWith(token)).toBe(true)
    expect(mailOutbox().at(-1)).toMatchObject({ to: 'dev@acme.test', subject: 'Sam Patel invited you to Acme Finance on FlowPilot' })

    const wrong = await register({ name: 'Eve', email: 'eve@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    expect(wrong.res.status).toBe(403)
    const right = await register({ name: 'Dev', email: 'dev@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    expect(right.res.body.workspace.role).toBe('viewer')
    // Used up: the same link no longer works.
    expect((await new Client().get(`/api/invites/${token}`)).body.error.code).toBe('INVITE_INVALID')
  })

  it('an existing account accepts and switches to the new workspace; revoked and expired links stop working', async () => {
    const sam = await newTeam()
    const vikram = await signIn('vikram')
    // Demo accounts can't join other workspaces; real accounts can.
    const token = (await sam.post('/api/workspace/invites', { role: 'member' })).body.link.split('/invite/')[1]
    expect((await vikram.post(`/api/invites/${token}/accept`)).status).toBe(403)

    const ann = await newTeam('Ann Rao', 'ann@acme.test', 'Ann Co')
    const accepted = await ann.post(`/api/invites/${token}/accept`)
    expect(accepted.status).toBe(200)
    expect(accepted.body.me.workspace).toMatchObject({ workspaceName: 'Acme Finance', role: 'member' })
    expect(accepted.body.me.memberships).toHaveLength(2)
    expect((await ann.post(`/api/invites/${token}/accept`)).body.alreadyMember).toBe(true)

    const revokeMe = await sam.post('/api/workspace/invites', { role: 'viewer' })
    expect((await sam.del(`/api/workspace/invites/${revokeMe.body.invite.id}`)).status).toBe(200)
    expect((await new Client().get(`/api/invites/${revokeMe.body.link.split('/invite/')[1]}`)).status).toBe(404)

    const stale = await sam.post('/api/workspace/invites', { role: 'viewer' })
    app.db.prepare("UPDATE invites SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(stale.body.invite.id)
    expect((await new Client().get(`/api/invites/${stale.body.link.split('/invite/')[1]}`)).status).toBe(404)
  })

  it('only admins invite; members and viewers get 403, outsiders never see the invites', async () => {
    const sam = await newTeam()
    const token = (await sam.post('/api/workspace/invites', { role: 'member' })).body.link.split('/invite/')[1]
    const { client: ria } = await register({ name: 'Ria', email: 'ria@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    expect((await ria.post('/api/workspace/invites', { role: 'viewer' })).status).toBe(403)
    expect((await ria.get('/api/workspace/invites')).status).toBe(403)
    // A demo admin can't invite either (shared accounts stay shared).
    expect((await (await signIn('asha')).post('/api/workspace/invites', { role: 'viewer' })).status).toBe(403)
    expect((await sam.post('/api/workspace/invites', { role: 'owner' })).status).toBe(422)
    expect((await sam.post('/api/workspace/invites', { role: 'member', email: 'sam@acme.test' })).body.error.code).toBe('ALREADY_MEMBER')
  })
})

describe('password reset', () => {
  it('emails a one-hour, single-use link, signs out everywhere, and answers the same for unknown emails', async () => {
    const sam = await newTeam()
    const other = new Client()
    expect((await other.post('/api/auth/login', { email: 'sam@acme.test', password: GOOD_PASSWORD })).status).toBe(200)

    const known = await new Client().post('/api/auth/forgot', { email: 'sam@acme.test' })
    const unknown = await new Client().post('/api/auth/forgot', { email: 'nobody@acme.test' })
    expect(known.status).toBe(200)
    expect(unknown.body).toEqual(known.body)
    await new Promise((r) => setTimeout(r, 0)) // the email is sent without delaying the answer
    expect(mailOutbox().filter((m) => m.to === 'nobody@acme.test')).toHaveLength(0)
    const token = lastLink('reset-password')

    const browser = new Client()
    expect((await browser.get(`/api/auth/reset/${token}`)).body).toEqual({ email: 's•••@acme.test' })
    expect((await browser.post('/api/auth/reset', { token, password: 'short' })).status).toBe(422)
    const done = await browser.post('/api/auth/reset', { token, password: 'a brand new passphrase' })
    expect(done.status).toBe(200)
    expect(done.body.user.email).toBe('sam@acme.test')

    // Old sessions are gone, the link is spent, and only the new password works.
    expect((await sam.get('/api/me')).status).toBe(401)
    expect((await other.get('/api/me')).status).toBe(401)
    expect((await browser.get('/api/me')).status).toBe(200)
    expect((await new Client().post('/api/auth/reset', { token, password: 'another one entirely' })).body.error.code).toBe('RESET_INVALID')
    expect((await new Client().post('/api/auth/login', { email: 'sam@acme.test', password: GOOD_PASSWORD })).status).toBe(401)
    expect((await new Client().post('/api/auth/login', { email: 'sam@acme.test', password: 'a brand new passphrase' })).status).toBe(200)
  })

  it('never resets a demo account and limits requests per email', async () => {
    await new Client().post('/api/auth/forgot', { email: 'asha@demo.local' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mailOutbox()).toHaveLength(0)
    let status = 0
    for (let i = 0; i < 4; i++) status = (await new Client().post('/api/auth/forgot', { email: 'someone@acme.test' })).status
    expect(status).toBe(429)
  })
})

describe('your account', () => {
  it('renames you, and changing the password needs the old one and signs out other devices', async () => {
    const sam = await newTeam()
    const laptop = new Client()
    await laptop.post('/api/auth/login', { email: 'sam@acme.test', password: GOOD_PASSWORD })

    expect((await sam.patch('/api/me', { name: 'Samir Patel' })).body.user.name).toBe('Samir Patel')
    expect((await sam.patch('/api/me', { name: '' })).status).toBe(422)

    const sessions = (await sam.get('/api/me/sessions')).body.sessions
    expect(sessions).toHaveLength(2)
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)

    const wrong = await sam.post('/api/me/password', { currentPassword: 'nope nope nope', newPassword: 'another passphrase 7' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.issues[0].path).toBe('currentPassword')
    const same = await sam.post('/api/me/password', { currentPassword: GOOD_PASSWORD, newPassword: GOOD_PASSWORD })
    expect(same.status).toBe(422)
    const changed = await sam.post('/api/me/password', { currentPassword: GOOD_PASSWORD, newPassword: 'another passphrase 7' })
    expect(changed.body).toEqual({ ok: true, signedOutOtherDevices: 1 })
    expect((await laptop.get('/api/me')).status).toBe(401)
    expect((await sam.get('/api/me')).status).toBe(200)
  })

  it('signs out every other device on request', async () => {
    await newTeam()
    const a = new Client()
    const b = new Client()
    await a.post('/api/auth/login', { email: 'sam@acme.test', password: GOOD_PASSWORD })
    await b.post('/api/auth/login', { email: 'sam@acme.test', password: GOOD_PASSWORD })
    expect((await a.del('/api/me/sessions')).body.signedOut).toBe(2)
    expect((await a.get('/api/me')).status).toBe(200)
    expect((await b.get('/api/me')).status).toBe(401)
  })

  it("keeps shared demo accounts' password and name fixed", async () => {
    const asha = await signIn('asha')
    expect((await asha.patch('/api/me', { name: 'Hacked' })).status).toBe(403)
    expect((await asha.post('/api/me/password', { currentPassword: PASSWORD, newPassword: 'another passphrase 7' })).status).toBe(403)
  })
})

describe('workspaces', () => {
  it('lists, creates and dashboards follow the workspace this browser is working in', async () => {
    const sam = await newTeam()
    await sam.post('/api/workflows', { title: 'Acme report', definition: ORIGINAL })
    const second = await sam.post('/api/workspaces', { name: 'Side project' })
    expect(second.status).toBe(201)
    expect(second.body.workspace).toMatchObject({ workspaceName: 'Side project', role: 'admin' })
    expect((await sam.get('/api/workflows?scope=mine')).body.total).toBe(0)
    await sam.post('/api/workflows', { title: 'Side report', definition: ORIGINAL })
    expect((await sam.get('/api/dashboard')).body.stats.myRecipes).toBe(1)

    const acme = second.body.memberships.find((m: { workspaceName: string }) => m.workspaceName === 'Acme Finance')
    const switched = await sam.post('/api/me/workspace', { workspaceId: acme.workspaceId })
    expect(switched.body.workspace.workspaceName).toBe('Acme Finance')
    expect((await sam.get('/api/workflows?scope=mine')).body.items.map((w: { title: string }) => w.title)).toEqual(['Acme report'])
    // Someone else's workspace can't be switched to.
    const olivia = await signIn('olivia')
    expect((await olivia.post('/api/me/workspace', { workspaceId: acme.workspaceId })).status).toBe(404)
  })

  it('admins rename the workspace and remove people, whose recipes stay with the team', async () => {
    const sam = await newTeam()
    const token = (await sam.post('/api/workspace/invites', { role: 'member' })).body.link.split('/invite/')[1]
    const { client: ria, res } = await register({ name: 'Ria Shah', email: 'ria@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    const riaId = res.body.user.id
    const privateRecipe = await ria.post('/api/workflows', { title: "Ria's draft", definition: ORIGINAL })
    await ria.run(privateRecipe.body.version.id, fixture('sales_A.csv'))

    expect((await ria.patch('/api/workspace', { name: 'Taken over' })).status).toBe(403)
    expect((await sam.patch('/api/workspace', { name: 'Acme Finance & Ops' })).status).toBe(200)
    expect((await ria.del(`/api/workspace/members/${riaId}`)).status).toBe(403)

    const info = (await sam.get('/api/workspace')).body
    expect(info.members.find((m: { user: { id: string } }) => m.user.id === riaId)).toMatchObject({ recipeCount: 1, isDemo: false })
    const removed = await sam.del(`/api/workspace/members/${riaId}`)
    expect(removed.body).toEqual({ removed: riaId, transferred: 1 })

    // Ria is out (and her own runs stay hers); the recipe now belongs to Sam.
    expect((await ria.get('/api/me')).body.memberships).toHaveLength(0)
    expect((await ria.get(`/api/workflows/${privateRecipe.body.workflow.id}`)).status).toBe(404)
    expect((await ria.get('/api/runs')).body.runs).toHaveLength(1)
    const owned = await sam.get(`/api/workflows/${privateRecipe.body.workflow.id}`)
    expect(owned.body.workflow.isMine).toBe(true)
    expect((await sam.get('/api/dashboard')).body.activity[0].text).toBe('You removed Ria Shah from Acme Finance & Ops')
  })

  it("leaving hands your recipes to an admin; the last admin can't leave", async () => {
    const sam = await newTeam()
    expect((await sam.post('/api/workspace/leave')).status).toBe(403)
    const token = (await sam.post('/api/workspace/invites', { role: 'member' })).body.link.split('/invite/')[1]
    const { client: ria } = await register({ name: 'Ria Shah', email: 'ria@acme.test', password: GOOD_PASSWORD, inviteToken: token })
    const recipe = await ria.post('/api/workflows', { title: 'Shared by Ria', definition: ORIGINAL })
    await ria.patch(`/api/workflows/${recipe.body.workflow.id}`, { visibility: 'team' })
    const left = await ria.post('/api/workspace/leave')
    expect(left.body.transferred).toBe(1)
    expect(left.body.me.workspace).toBeNull()
    expect((await sam.get(`/api/workflows/${recipe.body.workflow.id}`)).body.workflow.owner.name).toBe('Sam Patel')
    // Demo accounts stay put.
    expect((await (await signIn('meera')).post('/api/workspace/leave')).status).toBe(403)
  })

  it('an owner hands a recipe to a member, never to a viewer or an outsider', async () => {
    const asha = await signIn('asha')
    const recipe = await asha.post('/api/workflows', { title: 'Handover', definition: ORIGINAL })
    const id = recipe.body.workflow.id
    const { vikram, meera, olivia } = app.seed.users
    expect((await asha.post(`/api/workflows/${id}/transfer`, { userId: meera })).status).toBe(422)
    expect((await asha.post(`/api/workflows/${id}/transfer`, { userId: olivia })).status).toBe(422)
    expect((await (await signIn('vikram')).post(`/api/workflows/${id}/transfer`, { userId: vikram })).status).toBe(404)
    const moved = await asha.post(`/api/workflows/${id}/transfer`, { userId: vikram })
    expect(moved.status).toBe(200)
    expect(moved.body.workflow.owner.name).toBe('Vikram Nair')
    // It was private: the former owner can no longer see it; the new owner can edit it.
    expect((await asha.get(`/api/workflows/${id}`)).status).toBe(404)
    const vikramClient = await signIn('vikram')
    expect((await vikramClient.post(`/api/workflows/${id}/versions`, { definition: ORIGINAL })).status).toBe(201)
  })
})
