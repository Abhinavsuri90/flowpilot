import type { ApiIssue } from '../lib/types'

export const NO_STORE = 'private, no-store'

/** An error that maps directly to an HTTP response with the standard error shape. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly issues?: ApiIssue[]
  readonly draft?: unknown
  readonly runId?: string

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { issues?: ApiIssue[]; draft?: unknown; runId?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = extra.issues
    this.draft = extra.draft
    this.runId = extra.runId
  }
}

export const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
export const notFound = (what = 'That item') =>
  new ApiError(404, 'NOT_FOUND', `${what} doesn't exist or you don't have access to it.`)
export const forbidden = (message: string) => new ApiError(403, 'FORBIDDEN', message)
export const invalid = (message: string, issues?: ApiIssue[], code = 'VALIDATION_FAILED') =>
  new ApiError(422, code, message, { issues })

const BASE_HEADERS = {
  'Cache-Control': NO_STORE,
  'X-Content-Type-Options': 'nosniff',
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...init.headers },
  })
}

export function errorResponse(err: ApiError, headers?: Record<string, string>): Response {
  const error: Record<string, unknown> = { code: err.code, message: err.message }
  if (err.issues?.length) error.issues = err.issues
  if (err.draft !== undefined) error.draft = err.draft
  if (err.runId) error.runId = err.runId
  return json({ error }, { status: err.status, headers })
}

export function noContent(headers?: Record<string, string>): Response {
  return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...headers } })
}

/**
 * Reads a request body with a hard byte cap, whatever Content-Length claims.
 * Oversized bodies stop being read as soon as the cap is crossed.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes)
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw tooLarge(maxBytes)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function tooLarge(maxBytes: number) {
  const kib = Math.round(maxBytes / 1024)
  return new ApiError(413, 'PAYLOAD_TOO_LARGE', `The request is larger than the ${kib} KiB limit.`)
}

const JSON_BODY_LIMIT = 256 * 1024

/** Parses a JSON request body. Wrong content type → 415, malformed JSON → 422. */
export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.')
  }
  const bytes = await readBodyCapped(request, JSON_BODY_LIMIT)
  if (bytes.byteLength === 0) return {}
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw invalid('The request body is not valid JSON.')
  }
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]!.trim() === 'https'
  return new URL(request.url).protocol === 'https:'
}
