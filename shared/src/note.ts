/**
 * The `notes` contract — single source of truth for the shape crossing the
 * client/server boundary, mirroring shared/src/health.ts. One effect
 * `Schema` yields the runtime codec AND the static type, so server and
 * client can never drift silently: the web client decodes responses with
 * `decodeNote` / `decodeNoteList`, turning any drift into a loud runtime
 * `ParseError` instead of a quiet UI bug.
 */
import { Schema as S } from "effect"

export const Note = S.Struct({
  id: S.Number,
  text: S.String,
  /** Epoch ms. */
  createdAt: S.Number,
})

export type Note = S.Schema.Type<typeof Note>

export const NoteList = S.Array(Note)

export type NoteList = S.Schema.Type<typeof NoteList>

/**
 * Runtime decode for RPC consumers; throws a ParseError on contract drift —
 * including undocumented excess fields, so a server field added without a
 * matching contract change fails loudly instead of passing silently.
 */
export const decodeNote = S.decodeUnknownSync(Note, { onExcessProperty: "error" })

/** Runtime decode for the list endpoint — same excess-field discipline as `decodeNote`. */
export const decodeNoteList = S.decodeUnknownSync(NoteList, { onExcessProperty: "error" })

/**
 * The max length a note's trimmed text may run to. Lives here (not in the
 * server's notes.core.ts) so the request contract below can reuse it without
 * shared importing back from the server; notes.core.ts re-exports this same
 * binding so its own callers/tests see one source of truth, not two copies.
 */
export const NOTE_TEXT_MAX_LENGTH = 500

/** The POST body contract for creating a note. */
export const CreateNoteRequest = S.Struct({
  text: S.String.pipe(S.maxLength(NOTE_TEXT_MAX_LENGTH)),
})

export type CreateNoteRequest = S.Schema.Type<typeof CreateNoteRequest>

/**
 * Runtime decode for the server's request-body boundary. Unlike `decodeNote`
 * / `decodeNoteList` (which assert trusted response shapes and throw on
 * drift), this one is consumed from inside the pure functional core
 * (notes.core.ts's `parseCreateNoteRequest`), which must never throw —
 * so it returns an `Either` instead of throwing a `ParseError`. Same
 * excess-field discipline as the other shared decoders.
 */
export const decodeCreateNoteRequest = S.decodeUnknownEither(CreateNoteRequest, {
  onExcessProperty: "error",
})
