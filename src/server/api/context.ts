import type { DB } from '../db'
import type { SessionUser } from '../auth'

export type ApiContext = {
  request: Request
  url: URL
  params: Record<string, string>
  db: DB
  /** Null only on routes that allow anonymous callers. */
  user: SessionUser | null
}

/** Context for routes that require a session; the dispatcher guarantees `user`. */
export type AuthedContext = ApiContext & { user: SessionUser }

export type Handler = (ctx: AuthedContext) => Response | Promise<Response>
export type PublicHandler = (ctx: ApiContext) => Response | Promise<Response>
