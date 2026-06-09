/**
 * API assembly: mounts every feature slice's Hono app and exports `AppType`
 * for the typed Hono RPC client (`hc<AppType>`) consumed by apps/web.
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
import * as healthRoute from "./features/health/health.routes"
import { appConfig } from "./platform/config"

const app = new Hono()
  .use(
    "*",
    cors({
      origin: [...appConfig.corsOrigins],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .route("/health", healthRoute.app)

export type AppType = typeof app
export { app }
export default app
