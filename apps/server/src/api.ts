/**
 * API assembly: builds every feature slice's Hono app over the shared live
 * runtime and exports `AppType` for the typed Hono RPC client (`hc<AppType>`)
 * consumed by apps/web. Route modules export only builders — the live
 * `appRuntime` is injected here, so importing a route module has no side
 * effects and tests can build the same app over a stub runtime.
 *
 * Logging at this boundary is deliberately `console.*`, not `Effect.log*`:
 * the request-id + access-log middleware run outside any Effect program, so
 * they use the platform's sanctioned `console.error`/`console.warn` escape
 * hatch (Biome bans `console.log`/`info`/`debug` outside `main.ts`). Inside a
 * slice's program, `Effect.log*` remains the only sanctioned way to log — it
 * renders through the `Logger` layer wired in platform/runtime.ts.
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { requestId } from "hono/request-id"
import { buildHealthApp } from "./features/health/health.routes"
import { buildNotesApp } from "./features/notes/notes.routes"
import { appConfig } from "./platform/config"
import { onUnexpectedError } from "./platform/http"
import { appRuntime } from "./platform/runtime"

const app = new Hono()
  .onError(onUnexpectedError)
  .use("*", requestId())
  .use("*", logger(console.error))
  .use(
    "*",
    cors({
      origin: [...appConfig.corsOrigins],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .route("/health", buildHealthApp(appRuntime))
  .route("/notes", buildNotesApp(appRuntime))

export type AppType = typeof app
export { app }
export default app
