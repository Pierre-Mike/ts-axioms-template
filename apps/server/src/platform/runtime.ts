/**
 * Shared application runtime (cross-cutting platform infra).
 *
 * Composes every live Layer into one `ManagedRuntime` that route handlers and
 * `main.ts` run programs against. New feature slices add their `*IoLive`
 * layer to `AppLayer`.
 *
 * Also wires the process-wide `Logger`: `Effect.log*` calls anywhere in a
 * program (the sanctioned way to log from inside a slice — `console.*` stays
 * banned there) render as structured JSON in production and human-readable
 * pretty output otherwise. This is the one place the choice is made; slices
 * never branch on environment themselves.
 */
import { Layer, Logger, ManagedRuntime } from "effect"
import { HealthClockLive } from "../features/health/health.io"
import { NotesIoLive } from "../features/notes/notes.io"
import { appConfig } from "./config"

const LoggerLive = appConfig.nodeEnv === "production" ? Logger.json : Logger.pretty

const AppLayer = Layer.mergeAll(
  HealthClockLive,
  NotesIoLive({ dbPath: appConfig.notesDbPath }),
  LoggerLive,
)

export const appRuntime = ManagedRuntime.make(AppLayer)
