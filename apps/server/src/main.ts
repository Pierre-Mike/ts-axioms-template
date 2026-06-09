/**
 * Composition root. Boots the Hono app over Bun.serve and owns the lifetime of
 * the shared Effect runtime (live Layers are wired in platform/runtime.ts).
 */
import app from "./api"
import { appConfig } from "./platform/config"
import { appRuntime } from "./platform/runtime"

const server = Bun.serve({
  port: appConfig.port,
  fetch: app.fetch,
  idleTimeout: 0,
})

console.error(`server up: http://localhost:${server.port}`)

const shutdown = async (): Promise<void> => {
  server.stop()
  await appRuntime.dispose()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
