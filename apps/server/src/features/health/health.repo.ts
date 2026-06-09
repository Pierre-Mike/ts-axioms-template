/**
 * Imperative shell for the `health` slice — the I/O boundary.
 *
 * `ClockRepo` is an Effect service (Context.Tag) exposing the two impure reads
 * the route needs: the current wall-clock time and the process start time, plus
 * the build version. Routes depend on the Tag; `main.ts` provides the live
 * Layer. Tests substitute a fake Layer with a frozen clock.
 */
import { Context, Effect, Layer } from "effect"
import { appConfig } from "../../platform/config"

export interface ClockRepoApi {
  /** Wall-clock now, epoch ms. */
  readonly now: () => Effect.Effect<number>
  /** Process start time, epoch ms. */
  readonly startedAt: () => Effect.Effect<number>
  /** Build/package version string. */
  readonly version: () => Effect.Effect<string>
}

export class ClockRepo extends Context.Tag("ClockRepo")<ClockRepo, ClockRepoApi>() {}

/**
 * Live implementation. Captures the boot time once at layer construction so
 * uptime is measured from process start, and reads the version through the
 * typed config (platform/config.ts — the only sanctioned env funnel).
 */
export const ClockRepoLive: Layer.Layer<ClockRepo> = Layer.sync(ClockRepo, () => {
  const bootedAt = Date.now()
  return {
    now: () => Effect.sync(() => Date.now()),
    startedAt: () => Effect.succeed(bootedAt),
    version: () => Effect.succeed(appConfig.version),
  }
})
