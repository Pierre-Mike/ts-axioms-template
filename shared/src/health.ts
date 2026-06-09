/**
 * The `health` contract — single source of truth for the shape crossing the
 * client/server boundary. One effect `Schema` yields the runtime codec AND the
 * static type, so server and client can never drift silently: the web client
 * decodes responses with `decodeHealthStatus`, turning any drift into a loud
 * runtime `ParseError` instead of a quiet UI bug.
 */
import { Schema as S } from "effect"

export const HealthStatus = S.Struct({
  ok: S.Boolean,
  version: S.String,
  uptimeMs: S.Number,
})

export type HealthStatus = S.Schema.Type<typeof HealthStatus>

/** Runtime decode for RPC consumers; throws a ParseError on contract drift. */
export const decodeHealthStatus = S.decodeUnknownSync(HealthStatus)
