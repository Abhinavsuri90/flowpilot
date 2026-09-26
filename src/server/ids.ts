import { randomBytes } from 'node:crypto'

/** Unguessable, URL-safe ids with a readable prefix, e.g. `wf_3f9a2c7d1e0b4a56`. */
export function newId(prefix: 'usr' | 'ws' | 'wf' | 'ver' | 'run' | 'inv' | 'tok'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export const nowIso = () => new Date().toISOString()
