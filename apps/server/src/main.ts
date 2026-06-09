/**
 * Composition root. Boots the Hono app over Bun.serve and owns the lifetime of
 * the shared Effect runtime (live Layers are wired in platform/runtime.ts).
 */
import app from "./api"
import { appRuntime } from "./platform/runtime"

const PORT = Number(process.env.PORT ?? 8787)

const server = Bun.serve({
  port: PORT,
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
