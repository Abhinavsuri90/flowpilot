import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { databasePath } from './db'
import { loadEnv } from './env'

// Encryption at rest for secrets the server must read back (authenticator-app
// secrets), unlike passwords and tokens, which are only ever hashed. AES-256-GCM
// with a key kept outside the database, so a leaked database file or backup
// doesn't reveal them. The key is SECRET_KEY, or else a random key created once
// as `secret.key` next to the database (mode 600). Each value is bound to its
// owner (the "context", e.g. a user id), so it can't be copied to another row.

const VERSION = 'v1'
export const SECRET_KEY_MIN_LENGTH = 32

let cached: { source: string; key: Buffer } | null = null

function derive(material: string): Buffer {
  return Buffer.from(hkdfSync('sha256', material, 'flowpilot', 'flowpilot/secrets/v1', 32))
}

function keyFile(): string {
  return join(dirname(resolve(databasePath())), 'secret.key')
}

/** Where the key comes from right now: SECRET_KEY, the key file, or (tests, in-memory databases) this process only. */
function keySource(): string {
  loadEnv()
  if (process.env.SECRET_KEY?.trim()) return 'env'
  if (process.env.VITEST || databasePath() === ':memory:') return 'process'
  return `file:${keyFile()}`
}

function encryptionKey(): Buffer {
  const source = keySource()
  if (cached?.source === source) return cached.key
  let key: Buffer
  if (source === 'env') {
    const material = process.env.SECRET_KEY!.trim()
    if (material.length < SECRET_KEY_MIN_LENGTH) {
      throw new Error(`SECRET_KEY must be at least ${SECRET_KEY_MIN_LENGTH} characters; generate one with: openssl rand -base64 32`)
    }
    key = derive(material)
  } else if (source === 'process') {
    key = randomBytes(32)
  } else {
    const file = keyFile()
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true })
      try {
        // 'wx': if another process created it first, keep theirs.
        writeFileSync(file, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
    key = derive(readFileSync(file, 'utf8').trim())
  }
  cached = { source, key }
  return key
}

/** Fails fast on a SECRET_KEY that is set but too short, at start-up rather than on first use. */
export function checkSecretKey(): void {
  if (keySource() === 'env') encryptionKey()
}

/** Encrypts `plaintext` for one owner: "v1.<iv>.<ciphertext>.<tag>" in base64url. */
export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

/** Decrypts a sealed value, or null when it was tampered with, belongs to another owner, or the key changed. */
export function unseal(sealed: string, context: string): string | null {
  const [version, iv, body, tag] = sealed.split('.')
  if (version !== VERSION || !iv || !body || !tag) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Tests switch keys to prove a value sealed under one can't be read under another. */
export function forgetKey(): void {
  cached = null
}
