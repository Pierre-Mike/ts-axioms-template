/**
 * Router assembly. The `QueryClient` lives in the router context so loaders can
 * call `ensureQueryData` without importing a singleton. Code-based route tree
 * keeps the template plugin-free; switch to file-based routing once the slice
 * count grows.
 */
import { createRouter } from "@tanstack/react-router"
import { healthRoute } from "./features/health/health.route"
import { type RouterContext, rootRoute } from "./root-route"

const routeTree = rootRoute.addChildren([healthRoute])

export const createAppRouter = (context: RouterContext) =>
  createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
