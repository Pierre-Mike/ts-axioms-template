# Architecture

## Feature-first vertical slices

This template organizes the server by **feature**, not by horizontal layer.
There is no top-level `controllers/`, `services/`, `models/`. Instead each
feature owns its full vertical and its tests:

```
apps/server/src/
  features/
    health/
      health.core.ts        # PURE domain logic
      health.core.test.ts   # co-located unit test
      health.repo.ts        # I/O as an Effect service (Context.Tag + Layer)
      health.routes.ts      # Hono shell (Effect.gen sandwich)
  platform/
    runtime.ts              # the shared Effect ManagedRuntime + Layer wiring
  api.ts                    # mounts every slice; exports AppType (hc RPC)
  main.ts                   # composition root: Bun.serve + provide live Layers
```

A slice is the unit of change: to add a capability you create one folder and
touch two wiring points (`api.ts`, `platform/runtime.ts`). `platform/` holds
only cross-cutting infrastructure shared by every slice.

### File-suffix roles

| Suffix        | Role                          | Effect runtime? |
| ------------- | ----------------------------- | --------------- |
| `*.core.ts`   | Pure domain logic             | NO              |
| `*.repo.ts`   | I/O service (`Context.Tag`)   | YES             |
| `*.routes.ts` | HTTP shell (Hono)             | YES             |
| `main.ts`     | Composition root              | YES             |

## The impureim sandwich

"Imperative shell, functional core." Every request handler is a sandwich:

```
impure read (repo)  ->  pure transform (core)  ->  impure respond (routes)
```

- The **core** is pure and total. Fallible paths return values, not throws:
  `Either<E, A>`, `Option<A>`, or `Data` tagged unions. No `Effect` runtime, no
  `Layer`, no `Context`, no async, no I/O. `Either` / `Option` / `Data` /
  `Schema` are allowed (they are data, not runtime).
- The **shell** (`*.repo.ts` / `*.routes.ts` / `main.ts`) owns the Effect
  runtime: services are `Context.Tag`s, wiring is `Layer`s, the process runs one
  `ManagedRuntime`.
- The boundary lifts core into Effect: inside `Effect.gen`, a core `Either` is
  `yield*`-ed directly — an `Either` is a valid Effect yieldable, so a `Left`
  short-circuits as a typed failure (see `health.routes.ts`, which turns a bad
  `?verbose=` flag into a typed 400 with no try/catch).

```
       ┌──────────────────── routes.ts (Hono + Effect.gen) ───────────────────┐
       │  yield* ClockRepo            (impure read — repo service)             │
       │  buildStatus({...})          (PURE core — the sandwich filling)       │
       │  yield* parseVerbose(q)      (PURE core Either, lifted at boundary)   │
       │  c.json(status)              (impure respond)                         │
       └───────────────────────────────────────────────────────────────────────┘
```

Biome makes this structural, not aspirational: `*.core.ts` cannot import
`Effect`/`Layer`/`Context` from `effect`, and cannot import any `*.repo` module.

## `platform/` — cross-cutting infra

`platform/runtime.ts` builds the single `ManagedRuntime` from the merged live
Layers. Adding a slice means adding its `*RepoLive` to `AppLayer` here. Other
cross-cutting concerns (config readers, shell wrappers, websocket plumbing)
belong in `platform/` too — never inside a feature.

## Web tier (optional)

`apps/web` is Vite + React + **TanStack Router (UI only, not Start)** + TanStack
Query over the Hono RPC client. The data rule:

- Define `queryOptions` ONCE per query (`<feature>.queries.ts`).
- The route `loader` prefetches with `queryClient.ensureQueryData(thatQuery)`.
- The component reads with `useSuspenseQuery(thatQuery)`.

Router drives navigation + prefetch; Query owns the cache. Same key, same
fetcher, no loading flash, no duplicate request. The client never uses raw
`fetch` — only `hc<AppType>` (the server's exported type), so the network
surface is typed end-to-end.

`apps/web` and `apps/e2e` are removable: `bun run scaffold:clean` deletes them
and reduces the repo to a backend-only service.

## Monorepo & build

- **bun workspaces** (`apps/*`, `shared`) with root scripts. No Turborepo.
- **Upgrade trigger:** adopt Turborepo (or Nx) only when task graph caching
  starts paying for itself — i.e. when `bun run typecheck` / `bun test` across
  the workspace gets slow enough that remote/incremental caching saves real CI
  minutes, OR when cross-package task ordering becomes non-trivial (multiple
  build outputs feeding each other). Until then root scripts + `tsc -b` project
  references are simpler and have zero extra dependency.
- `tsc -b` uses TypeScript project references (each workspace is `composite`).

## `shared/`

Holds `@effect/schema` contracts. Promote a type into `shared/` only when **two
or more apps consume it** (e.g. server + web both validate the same DTO). Until
then keep it in its slice. Shared logic is intended to graduate to versioned
internal packages as the system grows.
