/**
 * Router assembly. The `QueryClient` lives in the router context so loaders can
 * call `ensureQueryData` without importing a singleton. Code-based route tree
 * keeps the template plugin-free; switch to file-based routing once the slice
 * count grows.
 */
import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, createRouter, Outlet } from "@tanstack/react-router"

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
})

// Imported after rootRoute is defined so child routes can reference it without
// a circular module-init hazard.
import { healthRoute } from "./features/health/health.route"

const routeTree = rootRoute.addChildren([healthRoute])

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
