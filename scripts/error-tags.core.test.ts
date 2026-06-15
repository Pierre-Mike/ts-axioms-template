import { describe, expect, it } from "bun:test"
import { extractLeftTags, extractRegisteredTags, findUnregisteredTags } from "./error-tags.core"

describe("extractLeftTags", () => {
  it("finds a tag constructed in Either.left", () => {
    const src = `Either.left({ _tag: "InvalidVerboseFlag", received: raw })`
    expect(extractLeftTags(src)).toEqual(["InvalidVerboseFlag"])
  })

  it("ignores _tag literals not built in an Either.left (success-side unions)", () => {
    const src = `const event = { _tag: "Created" }\nreturn Either.left({ _tag: "Bad" })`
    expect(extractLeftTags(src)).toEqual(["Bad"])
  })

  it("dedupes a tag returned from two branches", () => {
    const src = `Either.left({ _tag: "Dup" })\nEither.left({ _tag: "Dup" })`
    expect(extractLeftTags(src)).toEqual(["Dup"])
  })
})

describe("extractRegisteredTags", () => {
  it("reads the STATUS_BY_TAG object keys", () => {
    const src = `const STATUS_BY_TAG: Record<string, number> = {\n  InvalidVerboseFlag: 400,\n  HealthNotFound: 404,\n}`
    expect([...extractRegisteredTags(src)].sort()).toEqual(["HealthNotFound", "InvalidVerboseFlag"])
  })
})

describe("findUnregisteredTags", () => {
  it("flags a Left tag missing from STATUS_BY_TAG", () => {
    const cores = [{ path: "ghost.core.ts", source: `Either.left({ _tag: "Ghost" })` }]
    expect(findUnregisteredTags({ cores, registered: ["Other"] })).toEqual([
      { file: "ghost.core.ts", tag: "Ghost" },
    ])
  })

  it("passes when every Left tag is registered", () => {
    const cores = [{ path: "ok.core.ts", source: `Either.left({ _tag: "Ok" })` }]
    expect(findUnregisteredTags({ cores, registered: ["Ok"] })).toEqual([])
  })
})
