import { describe, expect, it } from "bun:test"
import { decodeNote, decodeNoteList } from "./note"

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
