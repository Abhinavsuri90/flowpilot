import { afterEach, describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  codeKind,
  hashRecoveryCode,
  hotp,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  timeStep,
  totp,
} from '../src/server/totp'
import { forgetKey, seal, unseal } from '../src/server/secrets'

// One-time codes checked against the published test vectors, recovery codes,
// and the encryption that keeps authenticator secrets unreadable at rest.

const RFC_SECRET = new TextEncoder().encode('12345678901234567890')

describe('base32 (RFC 4648)', () => {
  it('matches the RFC test vectors and round-trips', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ]
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded)
      expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain)
    }
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    // What people paste: lower case, spaces, padding.
    expect(base32Decode('mzxw 6ytb oi======')).toEqual(new TextEncoder().encode('foobar'))
    expect(() => base32Decode('MZXW1')).toThrow(/base32/)
  })
})

describe('one-time codes', () => {
  it('matches the HOTP test values in RFC 4226', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code))
  })

  it('matches the TOTP test values in RFC 6238 (SHA-1, 8 digits)', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ]
    for (const [seconds, code] of vectors) expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code)
  })

  it('accepts one step of clock drift either way, and never a spent or older step', () => {
    const now = Date.UTC(2026, 8, 27, 10, 0, 15)
    const step = timeStep(now)
    const code = (offset: number) => hotp(RFC_SECRET, step + offset)
    expect(matchTotp(RFC_SECRET, code(0), { now })).toBe(step)
    expect(matchTotp(RFC_SECRET, code(-1), { now })).toBe(step - 1)
    expect(matchTotp(RFC_SECRET, code(1), { now })).toBe(step + 1)
    expect(matchTotp(RFC_SECRET, code(-2), { now })).toBeNull()
    expect(matchTotp(RFC_SECRET, code(2), { now })).toBeNull()
    // Replay: once a step is spent, it and every older one are refused.
    expect(matchTotp(RFC_SECRET, code(0), { now, afterStep: step })).toBeNull()
    expect(matchTotp(RFC_SECRET, code(-1), { now, afterStep: step })).toBeNull()
    expect(matchTotp(RFC_SECRET, code(1), { now, afterStep: step })).toBe(step + 1)
    for (const junk of ['', '12345', '1234567', 'abcdef', '12 345']) expect(matchTotp(RFC_SECRET, junk, { now })).toBeNull()
  })

  it('makes 160-bit secrets and otpauth links authenticator apps understand', () => {
    const secret = newTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Decode(secret)).toHaveLength(20)
    expect(newTotpSecret()).not.toBe(secret)
    const uri = new URL(otpauthUri(secret, 'sam@acme.test'))
    expect(uri.protocol).toBe('otpauth:')
    expect(uri.host).toBe('totp')
    expect(decodeURIComponent(uri.pathname)).toBe('/FlowPilot:sam@acme.test')
    expect(Object.fromEntries(uri.searchParams)).toEqual({ secret, issuer: 'FlowPilot', algorithm: 'SHA1', digits: '6', period: '30' })
  })
})

describe('recovery codes', () => {
  it('makes ten distinct codes that avoid look-alike characters', () => {
    const codes = newRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/)
      expect(code).not.toMatch(/[01ilo]/)
    }
  })

  it('reads them however they are typed, and tells them apart from app codes', () => {
    const [code] = newRecoveryCodes(1) as [string]
    const typed = ` ${code.toUpperCase().replace('-', ' ')} `
    expect(hashRecoveryCode(typed)).toBe(hashRecoveryCode(code))
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/)
    expect(codeKind(code)).toBe('recovery')
    expect(codeKind(typed.trim())).toBe('recovery')
    expect(codeKind('123456')).toBe('totp')
    expect(codeKind('123 456')).toBe('totp')
    for (const junk of ['', '12345', 'k7m2q-x9p4', 'hello world', 'l0l0l-l0l0l']) expect(codeKind(junk)).toBeNull()
  })
})

describe('secrets at rest', () => {
  afterEach(() => {
    delete process.env.SECRET_KEY
    forgetKey()
  })

  it('encrypts with authentication, bound to one owner', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', 'totp:usr_a')
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/)
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP')
    expect(seal('JBSWY3DPEHPK3PXP', 'totp:usr_a')).not.toBe(sealed) // a fresh IV every time
    expect(unseal(sealed, 'totp:usr_a')).toBe('JBSWY3DPEHPK3PXP')
    // Copied to another owner, or changed by a single character: unreadable.
    expect(unseal(sealed, 'totp:usr_b')).toBeNull()
    const [v, iv, body, tag] = sealed.split('.') as [string, string, string, string]
    const flipped = body[0] === 'A' ? `B${body.slice(1)}` : `A${body.slice(1)}`
    expect(unseal([v, iv, flipped, tag].join('.'), 'totp:usr_a')).toBeNull()
    expect(unseal('not sealed', 'totp:usr_a')).toBeNull()
  })

  it('uses SECRET_KEY when set, so a value survives a restart only under the same key', () => {
    process.env.SECRET_KEY = 'x'.repeat(32) + '-a-long-random-deployment-secret'
    forgetKey()
    const sealed = seal('secret value', 'ctx')
    forgetKey() // as if the process restarted
    expect(unseal(sealed, 'ctx')).toBe('secret value')
    process.env.SECRET_KEY = 'y'.repeat(32) + '-a-different-deployment-secret'
    forgetKey()
    expect(unseal(sealed, 'ctx')).toBeNull()
  })

  it('refuses a SECRET_KEY that is too short to be a key', () => {
    process.env.SECRET_KEY = 'hunter2'
    forgetKey()
    expect(() => seal('secret value', 'ctx')).toThrow(/at least 32 characters/)
  })
})
