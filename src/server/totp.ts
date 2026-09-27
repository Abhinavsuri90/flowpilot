import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

// Time-based one-time passwords (RFC 6238) on top of HOTP (RFC 4226), with the
// defaults every authenticator app understands: HMAC-SHA1, 6 digits, 30-second
// steps. Plus the recovery codes that stand in for a lost phone.

export const TOTP = { digits: 6, stepSeconds: 30, secretBytes: 20, issuer: 'FlowPilot' } as const

// ----- base32 (RFC 4648, no padding): how authenticator apps expect the secret ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** Decodes base32, ignoring case, spaces, dashes and padding; throws on any other character. */
export function base32Decode(text: string): Uint8Array {
  const out: number[] = []
  let value = 0
  let bits = 0
  for (const char of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error(`Not a base32 character: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
    value &= (1 << bits) - 1
  }
  return Uint8Array.from(out)
}

// ----- HOTP and TOTP ------------------------------------------------------------------------

/** RFC 4226: the code for one counter value. */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP.digits): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', secret).update(message).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The 30-second time step a moment falls in. */
export const timeStep = (ms: number): number => Math.floor(ms / 1000 / TOTP.stepSeconds)

/** RFC 6238: the code an authenticator app shows at a moment. */
export function totp(secret: Uint8Array, ms: number = Date.now(), digits: number = TOTP.digits): string {
  return hotp(secret, timeStep(ms), digits)
}

const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * The time step a 6-digit code belongs to, or null. One step either side is
 * accepted for clock drift, and never a step at or before `afterStep`: once a
 * code has been used, it (and every older one) is spent.
 */
export function matchTotp(secret: Uint8Array, code: string, opts: { now?: number; window?: number; afterStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = timeStep(opts.now ?? Date.now())
  const window = opts.window ?? 1
  for (let step = current - window; step <= current + window; step++) {
    if (opts.afterStep !== null && opts.afterStep !== undefined && step <= opts.afterStep) continue
    if (sameCode(hotp(secret, step), code)) return step
  }
  return null
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(TOTP.secretBytes))
}

/** The otpauth:// link a QR code carries (Key Uri Format understood by authenticator apps). */
export function otpauthUri(secret: string, account: string, issuer: string = TOTP.issuer): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP.digits), period: String(TOTP.stepSeconds) })
  return `otpauth://totp/${label}?${query.toString()}`
}

// ----- recovery codes -------------------------------------------------------------------------

/** No 0/o, 1/l/i: the codes get copied by hand. 31 symbols × 10 = about 49 bits each. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const RECOVERY = { count: 10, length: 10 } as const

/** Ten fresh codes like "k7m2q-x9p4t", shown once. */
export function newRecoveryCodes(count: number = RECOVERY.count): string[] {
  return Array.from({ length: count }, () => {
    let code = ''
    for (let i = 0; i < RECOVERY.length; i++) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
    return `${code.slice(0, 5)}-${code.slice(5)}`
  })
}

/** What people type, reduced to the code itself: lower case, no spaces or dashes. */
export const normalizeRecoveryCode = (input: string): string => input.toLowerCase().replace(/[\s-]/g, '')

export const hashRecoveryCode = (input: string): string => createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex')

/** Which kind of code someone typed at the second step, if either. */
export function codeKind(input: string): 'totp' | 'recovery' | null {
  const compact = input.replace(/[\s-]/g, '')
  if (/^\d{6}$/.test(compact)) return 'totp'
  if (compact.length === RECOVERY.length && [...compact.toLowerCase()].every((c) => RECOVERY_ALPHABET.includes(c))) return 'recovery'
  return null
}
