/**
 * Route-level test for the `health` slice. Exercises the full impureim
 * sandwich over a FROZEN clock layer (the live `HealthClockLive` is swapped
 * for a `Layer.succeed` stub — same Tag, fake I/O), and asserts both branches
 * of the contract: the 200 body decodes against the shared `HealthStatus`
 * schema, and a bad `?verbose=` flag yields the shared `ApiErrorBody`
 * envelope with a 400.
 */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeHealthStatus } from "@ts-axioms/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HealthClock, type HealthClockApi } from "./health.io"
import { buildHealthApp } from "./health.routes"

const frozenClock: HealthClockApi = {
  now: () => Effect.succeed(5_000),
  startedAt: 2_000,
  version: "9.9.9",
}

const FrozenClock = Layer.succeed(HealthClock, frozenClock)

const app = buildHealthApp(ManagedRuntime.make(FrozenClock))

describe("GET /health", () => {
  it("returns a body that decodes against the shared contract", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(200)
    const status = decodeHealthStatus(await res.json())
    expect(status).toEqual({ ok: true, version: "9.9.9", uptimeMs: 3_000 })
  })

  it("echoes the verbose flag when requested", async () => {
    const res = await app.request("/?verbose=1")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { verbose?: boolean }
    expect(body.verbose).toBe(true)
  })

  it("maps an invalid verbose flag to the shared 400 error envelope", async () => {
    const res = await app.request("/?verbose=banana")
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.ok).toBe(false)
    expect(body.error._tag).toBe("InvalidVerboseFlag")
  })
})
