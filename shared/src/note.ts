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
