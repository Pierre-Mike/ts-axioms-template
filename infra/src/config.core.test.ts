import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import fc from "fast-check"
import { decodeGcpRuntimeConfig, decodeInfraConfig, TARGET_NAMES } from "./config.core"

describe("decodeInfraConfig", () => {
  it("decodes a minimal config and applies defaults", () => {
    const result = decodeInfraConfig({ target: "gcp" })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        target: "gcp",
        serviceName: "ts-axioms-server",
        appVersion: "0.0.0",
      })
    }
  })

  it("accepts every declared target name", () => {
    for (const target of TARGET_NAMES) {
      expect(Either.isRight(decodeInfraConfig({ target }))).toBe(true)
    }
  })

  it("rejects an unknown target as a Left, not a throw", () => {
    expect(Either.isLeft(decodeInfraConfig({ target: "heroku" }))).toBe(true)
  })

  it("rejects service names that are not cloud-resource safe", () => {
    const result = decodeInfraConfig({ target: "gcp", serviceName: "Bad_Name!" })
    expect(Either.isLeft(result)).toBe(true)
  })

  it("property: any string outside the target union is rejected", () => {
    const known: ReadonlyArray<string> = TARGET_NAMES
    fc.assert(
      fc.property(
        fc.string().filter((s) => !known.includes(s)),
        (target) => Either.isLeft(decodeInfraConfig({ target })),
      ),
    )
  })

  it("property: valid kebab-case service names always decode", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,48}$/), (serviceName) =>
        Either.isRight(decodeInfraConfig({ target: "gcp", serviceName })),
      ),
    )
  })
})

describe("decodeGcpRuntimeConfig", () => {
  it("defaults to europe-west1 and private access when nothing is set", () => {
    const result = decodeGcpRuntimeConfig({})
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ region: "europe-west1", allowPublicAccess: false })
    }
  })

  it("honors an explicit region and opt-in public access", () => {
    const result = decodeGcpRuntimeConfig({ region: "us-central1", allowPublicAccess: true })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ region: "us-central1", allowPublicAccess: true })
    }
  })

  it("rejects a non-boolean allowPublicAccess as a Left, not a throw", () => {
    expect(Either.isLeft(decodeGcpRuntimeConfig({ allowPublicAccess: "true" }))).toBe(true)
  })

  it("treats undefined fields the same as missing (pulumi Config returns undefined, not absence)", () => {
    const result = decodeGcpRuntimeConfig({ region: undefined, allowPublicAccess: undefined })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ region: "europe-west1", allowPublicAccess: false })
    }
  })
})
