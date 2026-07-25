import { describe, expect, it } from "bun:test"
import {
  bodyMismatches,
  dig,
  headerMismatch,
  interpolate,
  interpolateJson,
  occurrences,
  parseCountExpectation,
  parseEnvFlag,
  parseHeaderExpectation,
  parseHeaderFlag,
  parseStatuses,
  statusAllowed,
} from "./probe.core"

describe("flag parsing", () => {
  it("splits a header expectation on the first =", () => {
    expect(parseHeaderExpectation("Content-Type=text/event-stream")).toEqual({
      name: "content-type",
      needle: "text/event-stream",
    })
    expect(parseHeaderExpectation("x-request-id")).toEqual({ name: "x-request-id", needle: "" })
  })

  it("splits a count expectation on the LAST = so the needle may contain one", () => {
    expect(parseCountExpectation("data:=3")).toEqual({ needle: "data:", min: 3 })
    expect(parseCountExpectation("a=b=2")).toEqual({ needle: "a=b", min: 2 })
    expect(parseCountExpectation("data:")).toEqual({ needle: "data:", min: 1 })
  })

  it("splits a request header on the first colon and an env pair on the first =", () => {
    expect(parseHeaderFlag("X-API-Key: s3cret")).toEqual(["X-API-Key", "s3cret"])
    expect(parseEnvFlag("BASE_URL=http://127.0.0.1:9")).toEqual(["BASE_URL", "http://127.0.0.1:9"])
  })

  it("parses a status list and ignores junk", () => {
    expect(parseStatuses("200,201")).toEqual([200, 201])
    expect(parseStatuses("200, nope ,404")).toEqual([200, 404])
    expect(parseStatuses(undefined)).toEqual([])
  })
})

describe("statusAllowed", () => {
  it("treats an empty expectation as don't-care", () => {
    expect(statusAllowed({ actual: 500, allowed: [] })).toBe(true)
  })

  it("accepts any listed status", () => {
    expect(statusAllowed({ actual: 502, allowed: [502, 503] })).toBe(true)
    expect(statusAllowed({ actual: 500, allowed: [502, 503] })).toBe(false)
  })
})

describe("occurrences", () => {
  it("counts non-overlapping needles and never divides by an empty needle", () => {
    expect(occurrences({ text: "data: 1\ndata: 2\n", needle: "data:" })).toBe(2)
    expect(occurrences({ text: "abc", needle: "" })).toBe(0)
  })
})

describe("bodyMismatches", () => {
  it("is empty when every expectation is met", () => {
    expect(
      bodyMismatches({ text: "data: 1\ndata: 2\n", contains: ["data:"], counts: ["data:=2"] }),
    ).toEqual([])
  })

  it("reports a missing substring", () => {
    const [message] = bodyMismatches({ text: "{}", contains: ["data:"], counts: [] })
    expect(message).toContain('contain "data:"')
  })

  it("reports a stream that stopped short", () => {
    const [message] = bodyMismatches({ text: "data: 1\n", contains: [], counts: ["data:=3"] })
    expect(message).toContain("expected >=3")
    expect(message).toContain("got 1")
  })
})

describe("headerMismatch", () => {
  it("passes when the actual header contains the needle, case-insensitively", () => {
    expect(
      headerMismatch({
        expectation: "content-type=text/event-stream",
        actual: "text/event-stream; charset=utf-8",
      }),
    ).toBeNull()
  })

  it("explains the miss", () => {
    const message = headerMismatch({
      expectation: "content-type=text/event-stream",
      actual: "application/json",
    })
    expect(message).toContain("application/json")
  })
})

describe("dig", () => {
  it("walks a dotted path and stops at the first non-object", () => {
    expect(dig({ value: { a: { b: 7 } }, path: ["a", "b"] })).toBe(7)
    expect(dig({ value: { a: 1 }, path: ["a", "b"] })).toBeUndefined()
    expect(dig({ value: null, path: ["a"] })).toBeUndefined()
  })
})

describe("interpolate", () => {
  it("substitutes a previous step's field", () => {
    expect(interpolate({ text: "/tickets/{{0.id}}", responses: [{ id: 42 }] })).toBe("/tickets/42")
  })

  it("leaves the token in place when the field is missing, so the failure is visible", () => {
    expect(interpolate({ text: "/tickets/{{0.id}}", responses: [{}] })).toBe("/tickets/{{0.id}}")
    expect(interpolate({ text: "/tickets/{{3.id}}", responses: [] })).toBe("/tickets/{{3.id}}")
  })

  it("reaches nested fields", () => {
    expect(interpolate({ text: "{{0.ticket.id}}", responses: [{ ticket: { id: 9 } }] })).toBe("9")
  })
})

describe("interpolateJson", () => {
  it("rewrites strings anywhere in a body and leaves other scalars alone", () => {
    expect(
      interpolateJson({
        value: { id: "{{0.id}}", nested: [{ ref: "#{{0.id}}" }], keep: 5, flag: true },
        responses: [{ id: 3 }],
      }),
    ).toEqual({ id: "3", nested: [{ ref: "#3" }], keep: 5, flag: true })
  })
})
