/**
 * API assembly: mounts every feature slice's Hono app and exports `AppType`
 * for the typed Hono RPC client (`hc<AppType>`) consumed by apps/web.
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
import * as healthRoute from "./features/health/health.routes"

const DEFAULT_ORIGINS = ["http://localhost:5173"]

const extraOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const allowedOrigins = [...DEFAULT_ORIGINS, ...extraOrigins]

const app = new Hono()
  .use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .route("/health", healthRoute.app)

export type AppType = typeof app
export { app }
export default app
