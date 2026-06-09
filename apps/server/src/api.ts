/**
 * API assembly: builds every feature slice's Hono app over the shared live
 * runtime and exports `AppType` for the typed Hono RPC client (`hc<AppType>`)
 * consumed by apps/web. Route modules export only builders — the live
 * `appRuntime` is injected here, so importing a route module has no side
 * effects and tests can build the same app over a stub runtime.
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
import { buildHealthApp } from "./features/health/health.routes"
import { appConfig } from "./platform/config"
import { appRuntime } from "./platform/runtime"

const app = new Hono()
  .use(
    "*",
    cors({
      origin: [...appConfig.corsOrigins],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .route("/health", buildHealthApp(appRuntime))

export type AppType = typeof app
export { app }
export default app
