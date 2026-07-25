import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import { decodeCreateNoteRequest, decodeNote, decodeNoteList, NOTE_TEXT_MAX_LENGTH } from "./note"

describe("decodeNote", () => {
  it("round-trips a valid payload", () => {
    const payload = { id: 1, text: "hello", createdAt: 1_700_000_000_000 }
    expect(decodeNote(payload)).toEqual(payload)
  })

  it("throws on an excess field (contract drift cannot pass silently)", () => {
    const payload = { id: 1, text: "hello", createdAt: 1, extra: "x" }
    expect(() => decodeNote(payload)).toThrow()
  })
})

describe("decodeNoteList", () => {
  it("round-trips a list of valid notes", () => {
    const payload = [
      { id: 1, text: "a", createdAt: 1 },
      { id: 2, text: "b", createdAt: 2 },
    ]
    expect(decodeNoteList(payload)).toEqual(payload)
  })

  it("round-trips an empty list", () => {
    expect(decodeNoteList([])).toEqual([])
  })

  it("throws when any element has an excess field", () => {
    const payload = [{ id: 1, text: "a", createdAt: 1, extra: true }]
    expect(() => decodeNoteList(payload)).toThrow()
  })
})

describe("decodeCreateNoteRequest", () => {
  it("decodes a valid request", () => {
    expect(decodeCreateNoteRequest({ text: "hello" })).toEqual(Either.right({ text: "hello" }))
  })

  it("rejects a missing text field", () => {
    expect(Either.isLeft(decodeCreateNoteRequest({}))).toBe(true)
  })

  it("rejects a non-string text field", () => {
    expect(Either.isLeft(decodeCreateNoteRequest({ text: 42 }))).toBe(true)
  })

  it("rejects text over NOTE_TEXT_MAX_LENGTH", () => {
    const tooLong = "x".repeat(NOTE_TEXT_MAX_LENGTH + 1)
    expect(Either.isLeft(decodeCreateNoteRequest({ text: tooLong }))).toBe(true)
  })

  it("rejects an excess field (contract drift cannot pass silently)", () => {
    expect(Either.isLeft(decodeCreateNoteRequest({ text: "hi", extra: true }))).toBe(true)
  })
})
