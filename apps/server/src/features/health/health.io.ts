/**
 * Imperative shell for the `health` slice — the slice's I/O port (hexagonal
 * sense).
 *
 * `HealthClock` is an Effect service (Context.Tag) exposing the one impure
 * read the route needs (the current wall-clock time) plus two plain data
 * fields captured once at boot: the process start time and the build
 * version. Routes depend on the Tag; `main.ts` provides the live Layer.
 * Tests substitute a fake Layer with a frozen clock.
 */
import { Clock, Context, type Effect, Layer } from "effect"
import { appConfig } from "../../platform/config"

export interface HealthClockApi {
  /** Wall-clock now, epoch ms. */
  readonly now: () => Effect.Effect<number>
  /** Process start time, epoch ms — a constant, not an effect. */
  readonly startedAt: number
  /** Build/package version string — a constant, not an effect. */
  readonly version: string
}

export class HealthClock extends Context.Tag("HealthClock")<HealthClock, HealthClockApi>() {}

/**
 * Live implementation. Captures the boot time once at layer construction
 * (imperative shell — `Date.now()` here is fine) so uptime is measured from
 * process start, and reads the version through the typed config
 * (platform/config.ts — the only sanctioned env funnel). `now()` delegates
 * to Effect's built-in clock rather than a hand-rolled `Date.now()`.
 */
export const HealthClockLive: Layer.Layer<HealthClock> = Layer.sync(HealthClock, () => {
  const bootedAt = Date.now()
  return {
    now: () => Clock.currentTimeMillis,
    startedAt: bootedAt,
    version: appConfig.version,
  }
})
