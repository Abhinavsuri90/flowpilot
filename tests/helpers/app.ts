import { handleApi } from '../../src/server/api/router'
import { openDatabase, setDatabase } from '../../src/server/db'
import { seedDatabase } from '../../src/server/seed'
import { resetLoginThrottle } from '../../src/server/auth'
import { resetAccountLimits } from '../../src/server/ratelimit'
import { clearMailOutbox } from '../../src/server/mail'
import type { DemoKey } from '../../src/lib/demo'

export const BASE = 'http://localhost:3000'
export const PASSWORD = 'flowpilot-demo'

/** A fresh in-memory database with the demo seed, used by the real dispatcher. */
export async function freshApp() {
  const db = setDatabase(openDatabase(':memory:'))
  resetLoginThrottle()
  resetAccountLimits()
  clearMailOutbox()
  const seed = await seedDatabase(db, { password: PASSWORD })
  return { db, seed }
}

export type Res<T = any> = { status: number; body: T; headers: Headers; text: string }

type CallOptions = { json?: unknown; form?: FormData; headers?: Record<string, string> }

/** Calls handleApi(Request) exactly as the server route does, keeping the session cookie. */
export class Client {
  cookie: string | null = null

  async call<T = any>(method: string, path: string, opts: CallOptions = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { origin: BASE }
    for (const [k, v] of Object.entries(opts.headers ?? {})) {
      if (v === '') delete headers[k]
      else headers[k] = v
    }
    if (this.cookie) headers.cookie = this.cookie
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.form) {
      body = opts.form
    }
    const res = await handleApi(new Request(BASE + path, { method, headers, body }))
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]!
      this.cookie = pair.endsWith('=') ? null : pair
    }
    return { status: res.status, body: parsed as T, headers: res.headers, text }
  }

  get<T = any>(path: string) {
    return this.call<T>('GET', path)
  }
  post<T = any>(path: string, json: unknown = {}) {
    return this.call<T>('POST', path, { json })
  }
  patch<T = any>(path: string, json: unknown) {
    return this.call<T>('PATCH', path, { json })
  }
  del<T = any>(path: string) {
    return this.call<T>('DELETE', path)
  }

  /** POST /api/runs as multipart: versionId + file + optional parameters JSON. */
  run<T = any>(versionId: string, csv: string, parameters?: Record<string, unknown>, extra: Record<string, string> = {}, headers?: Record<string, string>) {
    const form = new FormData()
    form.set('versionId', versionId)
    form.set('file', new File([csv], extra.fileName ?? 'upload.csv', { type: 'text/csv' }))
    if (parameters) form.set('parameters', JSON.stringify(parameters))
    for (const [k, v] of Object.entries(extra)) if (k !== 'fileName') form.set(k, v)
    return this.call<T>('POST', '/api/runs', { form, headers })
  }
}

export async function signIn(key: DemoKey): Promise<Client> {
  const client = new Client()
  const res = await client.post('/api/auth/login', { email: `${key}@demo.local`, password: PASSWORD })
  if (res.status !== 200) throw new Error(`sign-in as ${key} failed: ${res.status} ${res.text}`)
  return client
}

/** Result rows as [group, total] pairs for compact assertions. */
export const pairs = (rows: Array<Record<string, string | number>>, key = 'region', value = 'total') =>
  rows.map((r) => [r[key], r[value]])
