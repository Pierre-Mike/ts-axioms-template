import { describe, expect, it } from "bun:test"
import { decodeHealthStatus } from "./health"

describe("decodeHealthStatus", () => {
  it("round-trips a valid payload without verbose", () => {
    const payload = { ok: true, version: "1.2.3", uptimeMs: 42 }
    expect(decodeHealthStatus(payload)).toEqual(payload)
  })

  it("round-trips a valid payload with verbose", () => {
    const payload = { ok: true, version: "1.2.3", uptimeMs: 42, verbose: true }
    expect(decodeHealthStatus(payload)).toEqual(payload)
  })

  it("throws on an excess field (contract drift cannot pass silently)", () => {
    const payload = { ok: true, version: "1", uptimeMs: 1, extra: "x" }
    expect(() => decodeHealthStatus(payload)).toThrow()
  })
})
