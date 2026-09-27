import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, freshApp, signIn } from './helpers/app'
import { mailOutbox } from '../src/server/mail'
import { metrics, resetMetrics, setLogSink } from '../src/server/observability'
import { base32Decode, totp } from '../src/server/totp'
import { openDatabase } from '../src/server/db'
import { createUser } from '../src/server/accounts'
import { hashPassword } from '../src/server/auth'
import { beginSetup, confirmSetup, isTwoFactorOn } from '../src/server/twofactor'
import type { TwoFactorStatus } from '../src/lib/types'

// Two-step sign-in: turning it on with the password and a first code, signing in
// in two steps, recovery codes, replay protection, throttling, password resets
// that still ask for the code, and the accounts that can never use it.

const PASSWORD = 'correct horse battery 42'
const START = Date.UTC(2026, 8, 27, 9, 0, 5)
let app: Awaited<ReturnType<typeof freshApp>>

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  app = await freshApp()
  resetMetrics()
})

afterEach(() => {
  vi.useRealTimers()
  setLogSink(null)
})

/** Moves the clock on by whole 30-second steps (each code is good for one step, ±1 for drift). */
const later = (steps = 1) => vi.setSystemTime(Date.now() + steps * 30_000)

async function newAccount(email = 'sam@acme.test') {
  const client = new Client()
  const res = await client.post('/api/auth/register', { name: 'Sam Patel', email, password: PASSWORD, workspaceName: 'Acme Finance' })
  expect(res.status, res.text).toBe(201)
  return client
}

/** Setup + enable; returns the secret (as the app holds it) and the recovery codes. */
async function turnOn(client: Client) {
  const setup = await client.post('/api/me/two-factor/setup')
  expect(setup.status, setup.text).toBe(200)
  const secret = base32Decode(setup.body.secret)
  const enabled = await client.post('/api/me/two-factor/enable', { password: PASSWORD, code: totp(secret) })
  expect(enabled.status, enabled.text).toBe(200)
  return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] }
}

async function passwordStep(email = 'sam@acme.test', password = PASSWORD) {
  const client = new Client()
  const res = await client.post('/api/auth/login', { email, password })
  expect(res.status, res.text).toBe(200)
  return { client, res, challenge: res.body.twoFactor?.challenge as string }
}

describe('turning two-step sign-in on', () => {
  it('needs the password and a first code from the app, then issues recovery codes once and signs out other devices', async () => {
    const sam = await newAccount()
    const laptop = new Client()
    expect((await laptop.post('/api/auth/login', { email: 'sam@acme.test', password: PASSWORD })).status).toBe(200)

    expect((await sam.get('/api/me/two-factor')).body).toEqual({ enabled: false, enabledAt: null, recoveryCodesLeft: 0, available: true } satisfies TwoFactorStatus)
    expect((await sam.post('/api/me/two-factor/enable', { password: PASSWORD, code: '123456' })).body.error.code).toBe('SETUP_NOT_STARTED')

    const setup = await sam.post('/api/me/two-factor/setup')
    expect(setup.status).toBe(200)
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.body.uri).toBe(`otpauth://totp/FlowPilot:sam%40acme.test?secret=${setup.body.secret}&issuer=FlowPilot&algorithm=SHA1&digits=6&period=30`)
    // Stored encrypted, and not yet on.
    const pending = app.db.prepare('SELECT totp_pending_secret, totp_secret FROM users WHERE email = ?').get('sam@acme.test') as Record<string, string | null>
    expect(pending.totp_pending_secret).toMatch(/^v1\./)
    expect(pending.totp_pending_secret).not.toContain(setup.body.secret)
    expect(pending.totp_secret).toBeNull()

    const secret = base32Decode(setup.body.secret)
    const wrongPassword = await sam.post('/api/me/two-factor/enable', { password: 'not my password', code: totp(secret) })
    expect(wrongPassword.status).toBe(422)
    expect(wrongPassword.body.error.issues).toEqual([{ path: 'password', message: 'Your password is incorrect' }])
    const wrongCode = await sam.post('/api/me/two-factor/enable', { password: PASSWORD, code: totp(secret, Date.now() - 5 * 60_000) })
    expect(wrongCode.status).toBe(422)
    expect(wrongCode.body.error.code).toBe('INVALID_CODE')

    const enabled = await sam.post('/api/me/two-factor/enable', { password: PASSWORD, code: totp(secret) })
    expect(enabled.status, enabled.text).toBe(200)
    expect(enabled.body).toMatchObject({ enabled: true, signedOutOtherDevices: 1 })
    expect(enabled.body.recoveryCodes).toHaveLength(10)
    expect((await laptop.get('/api/me')).status).toBe(401)
    expect((await sam.get('/api/me')).status).toBe(200)

    expect((await sam.get('/api/me/two-factor')).body).toEqual({ enabled: true, enabledAt: new Date(START).toISOString(), recoveryCodesLeft: 10, available: true })
    const stored = app.db.prepare('SELECT code_hash FROM recovery_codes').pluck().all() as string[]
    expect(stored).toHaveLength(10)
    for (const code of enabled.body.recoveryCodes as string[]) expect(stored.join()).not.toContain(code.replace('-', ''))
    expect((await sam.post('/api/me/two-factor/setup')).body.error.code).toBe('ALREADY_ON')
    expect(mailOutbox().at(-1)).toMatchObject({ to: 'sam@acme.test', subject: 'Two-step sign-in is on for your FlowPilot account' })
  })
})

describe('signing in with two steps', () => {
  it('answers a correct password with a challenge, never a session, and a code finishes signing in', async () => {
    const { secret } = await turnOn(await newAccount())
    later()
    const { client, res, challenge } = await passwordStep()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.body).toEqual({ twoFactor: { challenge: expect.any(String), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } })
    expect((await client.get('/api/me')).status).toBe(401)

    const wrong = await client.post('/api/auth/two-factor', { challenge, code: '000000' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CODE', message: expect.stringContaining('4 tries left') })

    const done = await client.post('/api/auth/two-factor', { challenge, code: totp(secret) })
    expect(done.status, done.text).toBe(200)
    expect(done.body.user.email).toBe('sam@acme.test')
    expect(done.body).not.toHaveProperty('recoveryCodesLeft')
    expect((await client.get('/api/me')).status).toBe(200)
    // The challenge is spent.
    expect((await new Client().post('/api/auth/two-factor', { challenge, code: totp(secret) })).body.error.code).toBe('CHALLENGE_EXPIRED')
    expect(metrics.signIns.value({ outcome: 'second_step' })).toBe(1)
    expect(metrics.secondFactor.value({ outcome: 'totp' })).toBe(1)
    expect(metrics.secondFactor.value({ outcome: 'invalid' })).toBe(1)
  })

  it('never accepts the same code twice, even in a new sign-in', async () => {
    const { secret } = await turnOn(await newAccount())
    later()
    const code = totp(secret)
    const first = await passwordStep()
    expect((await first.client.post('/api/auth/two-factor', { challenge: first.challenge, code })).status).toBe(200)
    const second = await passwordStep()
    const replay = await second.client.post('/api/auth/two-factor', { challenge: second.challenge, code })
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('INVALID_CODE')
    later()
    expect((await second.client.post('/api/auth/two-factor', { challenge: second.challenge, code: totp(secret) })).status).toBe(200)
  })

  it('takes a recovery code once, however it is typed, and says how many are left', async () => {
    const { recoveryCodes } = await turnOn(await newAccount())
    const code = recoveryCodes[3]!
    const first = await passwordStep()
    const used = await first.client.post('/api/auth/two-factor', { challenge: first.challenge, code: ` ${code.toUpperCase().replace('-', ' ')} ` })
    expect(used.status, used.text).toBe(200)
    expect(used.body.recoveryCodesLeft).toBe(9)
    const again = await passwordStep()
    expect((await again.client.post('/api/auth/two-factor', { challenge: again.challenge, code })).body.error.code).toBe('INVALID_CODE')
    expect(metrics.secondFactor.value({ outcome: 'recovery' })).toBe(1)
  })

  it('drops a challenge after five wrong codes or five minutes, and a new sign-in replaces the old one', async () => {
    const { secret } = await turnOn(await newAccount())
    later()
    const tries = await passwordStep()
    for (let i = 0; i < 4; i++) expect((await tries.client.post('/api/auth/two-factor', { challenge: tries.challenge, code: '000000' })).body.error.code).toBe('INVALID_CODE')
    const fifth = await tries.client.post('/api/auth/two-factor', { challenge: tries.challenge, code: '000000' })
    expect(fifth.status).toBe(401)
    expect(fifth.body.error.code).toBe('CHALLENGE_EXPIRED')
    expect((await tries.client.post('/api/auth/two-factor', { challenge: tries.challenge, code: totp(secret) })).body.error.code).toBe('CHALLENGE_EXPIRED')

    const slow = await passwordStep()
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    expect((await slow.client.post('/api/auth/two-factor', { challenge: slow.challenge, code: totp(secret) })).body.error.code).toBe('CHALLENGE_EXPIRED')

    const older = await passwordStep()
    const newer = await passwordStep()
    expect((await older.client.post('/api/auth/two-factor', { challenge: older.challenge, code: totp(secret) })).body.error.code).toBe('CHALLENGE_EXPIRED')
    expect((await newer.client.post('/api/auth/two-factor', { challenge: newer.challenge, code: totp(secret) })).status).toBe(200)
  })

  it('throttles wrong codes per person across challenges, so knowing the password is not enough to guess', async () => {
    const { secret } = await turnOn(await newAccount())
    later()
    for (let round = 0; round < 2; round++) {
      const { client, challenge } = await passwordStep()
      for (let i = 0; i < 5; i++) await client.post('/api/auth/two-factor', { challenge, code: '000000' })
    }
    const { client, challenge } = await passwordStep()
    const blocked = await client.post('/api/auth/two-factor', { challenge, code: totp(secret) })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    const retry = await passwordStep()
    expect((await retry.client.post('/api/auth/two-factor', { challenge: retry.challenge, code: totp(secret) })).status).toBe(200)
  })

  it('still asks for a code after a password reset: a reset link proves the inbox, not the phone', async () => {
    const { secret } = await turnOn(await newAccount())
    later()
    expect((await new Client().post('/api/auth/forgot', { email: 'sam@acme.test' })).status).toBe(200)
    const mail = [...mailOutbox()].reverse().find((m) => m.text.includes('/reset-password/'))!
    const token = mail.text.match(/\/reset-password\/([A-Za-z0-9_-]+)/)![1]!
    const browser = new Client()
    const reset = await browser.post('/api/auth/reset', { token, password: 'a brand new passphrase 7' })
    expect(reset.status, reset.text).toBe(200)
    expect(reset.body.twoFactor.challenge).toEqual(expect.any(String))
    expect(reset.headers.get('set-cookie')).toBeNull()
    expect((await browser.get('/api/me')).status).toBe(401)
    expect((await browser.post('/api/auth/two-factor', { challenge: reset.body.twoFactor.challenge, code: totp(secret) })).status).toBe(200)
    expect((await browser.get('/api/me')).status).toBe(200)
  })
})

describe('managing two-step sign-in', () => {
  it('turns off only with the password and a code, and the recovery codes go with it', async () => {
    const sam = await newAccount()
    const { secret, recoveryCodes } = await turnOn(sam)
    later()
    expect((await sam.post('/api/me/two-factor/disable', { password: PASSWORD, code: '000000' })).body.error.code).toBe('INVALID_CODE')
    expect((await sam.post('/api/me/two-factor/disable', { password: 'wrong password!', code: totp(secret) })).status).toBe(422)
    const off = await sam.post('/api/me/two-factor/disable', { password: PASSWORD, code: recoveryCodes[0] })
    expect(off.status, off.text).toBe(200)
    expect((await sam.get('/api/me/two-factor')).body).toMatchObject({ enabled: false, recoveryCodesLeft: 0 })
    expect(app.db.prepare('SELECT COUNT(*) FROM recovery_codes').pluck().get()).toBe(0)
    expect(app.db.prepare('SELECT totp_secret FROM users WHERE email = ?').pluck().get('sam@acme.test')).toBeNull()
    // Signing in is one step again.
    const login = await new Client().post('/api/auth/login', { email: 'sam@acme.test', password: PASSWORD })
    expect(login.body.user.email).toBe('sam@acme.test')
    expect(mailOutbox().at(-1)).toMatchObject({ subject: 'Two-step sign-in was turned off' })
    expect((await sam.post('/api/me/two-factor/disable', { password: PASSWORD, code: '123456' })).body.error.code).toBe('NOT_ON')
  })

  it('replaces recovery codes with the password, and the old ones stop working', async () => {
    const sam = await newAccount()
    const { recoveryCodes: old } = await turnOn(sam)
    expect((await sam.post('/api/me/two-factor/recovery-codes', { password: 'wrong password!' })).status).toBe(422)
    const fresh = await sam.post('/api/me/two-factor/recovery-codes', { password: PASSWORD })
    expect(fresh.status).toBe(200)
    expect(fresh.body.recoveryCodes).toHaveLength(10)
    expect(fresh.body.recoveryCodes).not.toContain(old[0])
    const { client, challenge } = await passwordStep()
    expect((await client.post('/api/auth/two-factor', { challenge, code: old[0] })).body.error.code).toBe('INVALID_CODE')
    expect((await client.post('/api/auth/two-factor', { challenge, code: fresh.body.recoveryCodes[0] })).status).toBe(200)
  })

  it('is never available to shared demo accounts or API tokens, and the database refuses it too', async () => {
    const asha = await signIn('asha')
    expect((await asha.get('/api/me/two-factor')).body).toMatchObject({ enabled: false, available: false })
    const refused = await asha.post('/api/me/two-factor/setup')
    expect(refused.status).toBe(403)
    expect(refused.body.error.message).toContain('Demo accounts')
    expect(() => app.db.prepare('UPDATE users SET totp_pending_secret = ? WHERE email = ?').run('v1.x.y.z', 'asha@demo.local')).toThrow(/demo accounts/)
    expect(() => app.db.prepare('UPDATE users SET totp_secret = ? WHERE email = ?').run('v1.x.y.z', 'vikram@demo.local')).toThrow()

    const sam = await newAccount()
    const secret = (await sam.post('/api/me/tokens', { name: 'script' })).body.secret as string
    const script = new Client()
    const viaToken = await script.call('GET', '/api/me/two-factor', { headers: { origin: '', authorization: `Bearer ${secret}` } })
    expect(viaToken.status).toBe(403)
    expect(viaToken.body.error.code).toBe('SESSION_REQUIRED')
    // On but without a start time (or the reverse) can't be stored.
    expect(() => app.db.prepare('UPDATE users SET totp_secret = ? WHERE email = ?').run('v1.x.y.z', 'sam@acme.test')).toThrow(/both a secret and a start time/)
  })

  it('binds each secret to its account: copied to another row, it produces no valid codes', async () => {
    const { secret } = await turnOn(await newAccount('sam@acme.test'))
    await newAccount('ria@acme.test')
    app.db
      .prepare(`UPDATE users SET totp_secret = (SELECT totp_secret FROM users WHERE email = 'sam@acme.test'), totp_enabled_at = ? WHERE email = 'ria@acme.test'`)
      .run(new Date().toISOString())
    later()
    const warnings: string[] = []
    setLogSink((line, level) => level === 'warn' && warnings.push(line))
    const { client, challenge } = await passwordStep('ria@acme.test')
    expect((await client.post('/api/auth/two-factor', { challenge, code: totp(secret) })).body.error.code).toBe('INVALID_CODE')
    // The operator is told why, without the secret.
    expect(warnings.join()).toContain('could not be decrypted')
  })

  it('can be turned off by the operator for someone locked out, with the script that ships in the image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowpilot-two-step-'))
    try {
      const file = join(dir, 'flowpilot.db')
      const db = openDatabase(file)
      const id = createUser(db, { email: 'lost@acme.test', name: 'Lost Phone', passwordHash: await hashPassword(PASSWORD) })
      expect(confirmSetup(db, id, totp(base32Decode(beginSetup(db, id))))).not.toBeNull()
      db.close()
      const script = (email: string) =>
        execFileSync(process.execPath, ['scripts/two-factor-off.mjs', email], { env: { ...process.env, DATABASE_PATH: file }, encoding: 'utf8' })
      expect(script('LOST@acme.test')).toContain('now off for LOST@acme.test')
      expect(script('lost@acme.test')).toContain('already off')
      const after = openDatabase(file)
      expect(isTwoFactorOn(after, id)).toBe(false)
      expect(after.prepare('SELECT COUNT(*) FROM recovery_codes').pluck().get()).toBe(0)
      after.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
