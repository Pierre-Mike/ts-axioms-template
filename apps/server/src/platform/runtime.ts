/**
 * Shared application runtime (cross-cutting platform infra).
 *
 * Composes every live Layer into one `ManagedRuntime` that route handlers and
 * `main.ts` run programs against. New feature slices add their `*RepoLive`
 * layer to `AppLayer`.
 */
import { Layer, ManagedRuntime } from "effect"
import { ClockRepoLive } from "../features/health/health.repo"

const AppLayer = Layer.mergeAll(ClockRepoLive)

export const appRuntime = ManagedRuntime.make(AppLayer)
