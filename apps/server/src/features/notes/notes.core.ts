/**
 * Functional core for the `notes` slice — PURE.
 *
 * No Effect runtime, no Layer/Context, no I/O, no clock. The imperative shell
 * (notes.io.ts / notes.routes.ts) reads the world — the request body, the
 * current note count, a note looked up by id, the wall clock — and passes
 * plain data in here. Every fallible path is a tagged `Either.left`, never a
 * throw, mirroring health.core.ts's `InvalidVerboseFlag` pattern.
 */
import type { Note } from "@ts-axioms/shared"
import { decodeCreateNoteRequest, NOTE_TEXT_MAX_LENGTH } from "@ts-axioms/shared"
import { Either } from "effect"

// Re-exported so this module stays the one import path the slice's tests and
// callers use for the constant, even though the value itself now lives in
// shared/src/note.ts (the request contract below needs it too).
export { NOTE_TEXT_MAX_LENGTH }

export interface InvalidNoteBody {
  readonly _tag: "InvalidNoteBody"
}

/**
 * Decode an unknown request body against the shared `CreateNoteRequest`
 * contract (well-formed JSON matching the shape, `text` a string within the
 * wire-level max length). Wraps the schema's `ParseError` in a tagged `Left`
 * — the raw `ParseError` never crosses the HTTP boundary (it isn't in
 * `STATUS_BY_TAG` and could leak internal schema detail). This only checks
 * shape; `validateText` below still owns the business rule (trim, reject
 * empty-after-trim).
 */
export const parseCreateNoteRequest = (raw: unknown): Either.Either<string, InvalidNoteBody> => {
  const decoded = decodeCreateNoteRequest(raw)
  if (Either.isLeft(decoded)) {
    return Either.left({ _tag: "InvalidNoteBody" })
  }
  return Either.right(decoded.right.text)
}

export interface InvalidNoteText {
  readonly _tag: "InvalidNoteText"
  readonly received: string
}

/**
 * Trim and validate note text: reject empty (after trim) or over-length
 * input. Total — every string maps to a Right or a tagged Left, never a
 * throw.
 */
export const validateText = (raw: string): Either.Either<string, InvalidNoteText> => {
  const trimmed = raw.trim()
  if (trimmed === "" || trimmed.length > NOTE_TEXT_MAX_LENGTH) {
    return Either.left({ _tag: "InvalidNoteText", received: raw })
  }
  return Either.right(trimmed)
}

export interface NoteLimitReached {
  readonly _tag: "NoteLimitReached"
  readonly limit: number
}

/**
 * Guard the note count against the configured limit. The Right carries the
 * (unchanged) count through so callers can chain without re-reading it.
 */
export const checkCapacity = (input: {
  readonly count: number
  readonly limit: number
}): Either.Either<number, NoteLimitReached> => {
  if (input.count >= input.limit) {
    return Either.left({ _tag: "NoteLimitReached", limit: input.limit })
  }
  return Either.right(input.count)
}

export interface NoteNotFound {
  readonly _tag: "NoteNotFound"
  readonly id: number
}

/** Turn an optional lookup result into a typed Either — no null-checking downstream. */
export const requireNote = (input: {
  readonly id: number
  readonly found: Note | undefined
}): Either.Either<Note, NoteNotFound> =>
  input.found === undefined
    ? Either.left({ _tag: "NoteNotFound", id: input.id })
    : Either.right(input.found)

export interface InvalidNoteId {
  readonly _tag: "InvalidNoteId"
  readonly received: string
}

/** Parse the `:id` route param. Total: any string yields an Either, never a throw. */
export const parseNoteId = (raw: string): Either.Either<number, InvalidNoteId> => {
  const trimmed = raw.trim()
  const id = Number(trimmed)
  if (trimmed === "" || !Number.isInteger(id) || id < 0) {
    return Either.left({ _tag: "InvalidNoteId", received: raw })
  }
  return Either.right(id)
}
