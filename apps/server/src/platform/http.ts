/**
 * HTTP error mapping (cross-cutting platform infra).
 *
 * Turns a core tagged error into the shared `ApiErrorBody` envelope
 * (`{ ok: false, error: { _tag, ... } }` — see shared/src/api-error.ts) plus
 * an HTTP status. Every slice's Left branch goes through here, so clients see
 * exactly one error shape.
 *
 * `STATUS_BY_TAG` is an ALLOWLIST, not a default map: registering a tag here
 * is the act of declaring it client-safe. A registered tag's full payload
 * crosses the wire at its mapped status. An unregistered tag is redacted to
 * a generic `InternalServerError` at 500 instead — the real tag and payload
 * are logged server-side — so forgetting to register a new tag now fails
 * safe (no leak, no wrong status) rather than leaking an unreviewed shape.
 * `onUnexpectedError` extends the same redact-and-log posture to defects
 * (unexpected throws) that bypass the `Either` boundary entirely.
 *
 * Evolution path: replace this open `Record` with a per-tag schema-encoded
 * error contract once a slice needs tag-specific payload validation on the
 * wire, rather than the allowlist's "known-safe passthrough".
 */
import { Effect, type ManagedRuntime } from "effect"
import type { ErrorHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export interface TaggedError {
  readonly _tag: string
}

const INTERNAL_SERVER_ERROR = { _tag: "InternalServerError" } as const

/**
 * Allowlist: only tags registered here cross the wire with their real
 * payload. Notably absent: `NotesDbError` (notes.io.ts) — its `cause` field
 * is an intentionally open, unvalidated payload (whatever bun:sqlite/JS
 * threw), so it's deliberately left unregistered and falls through to the
 * generic redacted `InternalServerError` 500 below, same as any other
 * unexpected server-side failure.
 */
const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
  InvalidNoteBody: 400,
  InvalidNoteText: 400,
  InvalidNoteId: 400,
  NoteNotFound: 404,
  NoteLimitReached: 409,
}

export const errorEnvelope = (error: TaggedError) => {
  const status = STATUS_BY_TAG[error._tag]
  if (status === undefined) {
    console.error("unregistered error tag reached the boundary:", error)
    return {
      body: { ok: false as const, error: INTERNAL_SERVER_ERROR },
      status: 500 as ContentfulStatusCode,
    }
  }
  return { body: { ok: false as const, error }, status }
}

/**
 * Runs an Effect program on a slice runtime and folds its typed-error channel
 * into a plain outcome: either the success value or the shared `ApiErrorBody`
 * envelope + status. Collapses the `runPromise` -> `Effect.either` edge every
 * route repeats, WITHOUT calling `c.json` itself — each handler renders both
 * branches with its own `c.json(...)`, so Hono's per-route RPC response typing
 * (success AND error shape) stays fully inferred at the call site.
 */
export const runToOutcome = async <A, E extends TaggedError, R>(input: {
  readonly runtime: Pick<ManagedRuntime.ManagedRuntime<R, never>, "runPromise">
  readonly program: Effect.Effect<A, E, R>
}): Promise<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ReturnType<typeof errorEnvelope> }
> => {
  const result = await input.runtime.runPromise(Effect.either(input.program))
  return result._tag === "Left"
    ? { ok: false, error: errorEnvelope(result.left) }
    : { ok: true, value: result.right }
}

/**
 * Hono error handler for defects — throws that bypass the `Either` boundary
 * entirely (e.g. a service throwing instead of failing typed). Wired via
 * `app.onError` in api.ts. Same redact-and-log posture as an unregistered
 * tag above: log the real defect server-side, return the generic envelope.
 */
export const onUnexpectedError: ErrorHandler = (err, c) => {
  console.error("unexpected defect reached the http boundary:", err)
  return c.json({ ok: false as const, error: INTERNAL_SERVER_ERROR }, 500)
}
