import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import { buildStatus, parseVerbose } from "./health.core"

describe("buildStatus", () => {
  it("reports ok with the version and computed uptime", () => {
    const status = buildStatus({ version: "1.2.3", startedAt: 1_000, now: 4_000 })
    expect(status).toEqual({ ok: true, version: "1.2.3", uptimeMs: 3_000 })
  })

  it("never returns negative uptime when the clock skews backwards", () => {
    const status = buildStatus({ version: "0.0.0", startedAt: 5_000, now: 1_000 })
    expect(status.uptimeMs).toBe(0)
  })
})

describe("parseVerbose", () => {
  it("defaults to false when the flag is absent", () => {
    expect(parseVerbose(undefined)).toEqual(Either.right(false))
    expect(parseVerbose("")).toEqual(Either.right(false))
  })

  it("parses truthy and falsy spellings", () => {
    expect(parseVerbose("true")).toEqual(Either.right(true))
    expect(parseVerbose("1")).toEqual(Either.right(true))
    expect(parseVerbose("false")).toEqual(Either.right(false))
    expect(parseVerbose("0")).toEqual(Either.right(false))
  })

  it("returns a tagged Left for anything else (error-as-value, no throw)", () => {
    const result = parseVerbose("maybe")
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toEqual({ _tag: "InvalidVerboseFlag", received: "maybe" })
    }
  })
})
