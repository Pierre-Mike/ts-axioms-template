/**
 * Hono shell for the `health` slice.
 *
 * The handler is an impure-imperative sandwich: read the clock/version through
 * the Effect service (impure), call the PURE core `parseVerbose` + `buildStatus`
 * in the middle, and respond. The core `Either` is lifted into Effect by
 * `yield*`-ing it directly (an `Either` is a valid Effect yieldable; a `Left`
 * short-circuits as a typed failure), so a bad `?verbose=` flag becomes a typed
 * 400 — no try/catch, no throwing.
 */
import { Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { errorEnvelope } from "../../platform/http"
import { buildStatus, parseVerbose } from "./health.core"
import { HealthClock } from "./health.io"

// Runtime surface the handlers depend on. Prod passes `appRuntime`; route tests
// substitute a stub runtime built over a fake HealthClock layer.
export type HealthRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<HealthClock, never>,
  "runPromise"
>

export const buildHealthApp = (runtime: HealthRouteRuntime) =>
  new Hono().get("/", async (c) => {
    const program = Effect.gen(function* () {
      // --- impure read (shell) ---
      const clock = yield* HealthClock
      const now = yield* clock.now()
      // --- pure core: lift the Either typed-error into Effect at the boundary ---
      const verbose = yield* parseVerbose(c.req.query("verbose"))
      const status = buildStatus({ version: clock.version, startedAt: clock.startedAt, now })
      return { status, verbose }
    })

    const result = await runtime.runPromise(Effect.either(program))
    if (result._tag === "Left") {
      // Shared ApiErrorBody envelope; tag -> status mapping lives in platform/http.ts.
      const { body, status } = errorEnvelope(result.left)
      return c.json(body, status)
    }
    const { status, verbose } = result.right
    return c.json(verbose ? { ...status, verbose: true } : status)
  })
