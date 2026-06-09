/**
 * HTTP error mapping (cross-cutting platform infra).
 *
 * Turns a core tagged error into the shared `ApiErrorBody` envelope
 * (`{ ok: false, error: { _tag, ... } }` — see shared/src/api-error.ts) plus
 * an HTTP status. Every slice's Left branch goes through here, so clients see
 * exactly one error shape. Register new tags in STATUS_BY_TAG; unknown tags
 * default to 400.
 */
import type { ContentfulStatusCode } from "hono/utils/http-status"

export interface TaggedError {
  readonly _tag: string
}

const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
}

export const errorEnvelope = (error: TaggedError) => ({
  body: { ok: false as const, error },
  status: STATUS_BY_TAG[error._tag] ?? (400 as ContentfulStatusCode),
})
