/**
 * The shared error envelope. Every slice returns failures in this one shape —
 * `{ ok: false, error: { _tag, ... } }` — so clients (human or agent-written)
 * can rely on a single machine-parsable contract. Tags map to HTTP statuses in
 * apps/server/src/platform/http.ts; extra fields on `error` carry the tag's
 * payload (e.g. `received` on `InvalidVerboseFlag`).
 */
import { Schema as S } from "effect"

export const ApiErrorBody = S.Struct({
  ok: S.Literal(false),
  error: S.Struct({ _tag: S.String }),
})

export type ApiErrorBody = S.Schema.Type<typeof ApiErrorBody>

/** Runtime decode for RPC consumers asserting the envelope shape. */
export const decodeApiErrorBody = S.decodeUnknownSync(ApiErrorBody)
