import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import * as fc from "fast-check"
import {
  checkCapacity,
  NOTE_TEXT_MAX_LENGTH,
  parseNoteId,
  requireNote,
  validateText,
} from "./notes.core"

describe("validateText", () => {
  it("trims and accepts non-empty text", () => {
    expect(validateText("  hello  ")).toEqual(Either.right("hello"))
  })

  it("rejects empty (after trim) text", () => {
    expect(Either.isLeft(validateText("   "))).toBe(true)
  })

  it("rejects text over the max length", () => {
    const tooLong = "x".repeat(NOTE_TEXT_MAX_LENGTH + 1)
    const result = validateText(tooLong)
    expect(result).toEqual(Either.left({ _tag: "InvalidNoteText", received: tooLong }))
  })
})

describe("checkCapacity", () => {
  it("allows when under the limit", () => {
    expect(checkCapacity({ count: 5, limit: 10 })).toEqual(Either.right(5))
  })

  it("rejects at or over the limit", () => {
    expect(checkCapacity({ count: 10, limit: 10 })).toEqual(
      Either.left({ _tag: "NoteLimitReached", limit: 10 }),
    )
  })
})

describe("requireNote", () => {
  const note = { id: 1, text: "hi", createdAt: 0 }

  it("returns the note when found", () => {
    expect(requireNote({ id: 1, found: note })).toEqual(Either.right(note))
  })

  it("returns a tagged Left when missing", () => {
    expect(requireNote({ id: 42, found: undefined })).toEqual(
      Either.left({ _tag: "NoteNotFound", id: 42 }),
    )
  })
})

describe("parseNoteId", () => {
  it("parses a non-negative integer string", () => {
    expect(parseNoteId("42")).toEqual(Either.right(42))
  })

  it("rejects non-numeric input", () => {
    expect(Either.isLeft(parseNoteId("abc"))).toBe(true)
  })

  it("rejects a negative number", () => {
    expect(Either.isLeft(parseNoteId("-1"))).toBe(true)
  })
})

// Property-based coverage (fast-check): pure data-in/data-out cores are ideal
// property targets — no mocks, thousands of generated cases per run.
describe("core properties", () => {
  it("validateText is total and never returns an empty string on the Right", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = validateText(raw)
        expect(Either.isEither(result)).toBe(true)
        if (Either.isRight(result)) {
          expect(result.right.length).toBeGreaterThan(0)
          expect(result.right.length).toBeLessThanOrEqual(NOTE_TEXT_MAX_LENGTH)
        }
      }),
    )
  })

  it("checkCapacity is a Left exactly when count >= limit", () => {
    fc.assert(
      fc.property(
        fc.record({ count: fc.nat({ max: 1_000 }), limit: fc.nat({ max: 1_000 }) }),
        (input) => {
          const result = checkCapacity(input)
          expect(Either.isLeft(result)).toBe(input.count >= input.limit)
        },
      ),
    )
  })

  it("parseNoteId is total: any string yields an Either, never a throw", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(Either.isEither(parseNoteId(raw))).toBe(true)
      }),
    )
  })
})
