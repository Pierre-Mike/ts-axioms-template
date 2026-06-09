# CLAUDE.md — ts-axioms template

Agent operating rules for this repo. These are enforced by tooling (Biome /
Lefthook / Fallow / `tsc`); if you fight a rule, fix the design, not the linter.

## Architecture: feature-first vertical slices

Code is organized by **feature**, not by layer. Each slice owns its full
vertical:

```
apps/server/src/
  features/<feature>/
    <feature>.core.ts        # PURE domain logic — no I/O, no Effect runtime
    <feature>.core.test.ts   # co-located unit test (data-in / data-out)
    <feature>.repo.ts        # I/O as an Effect service (Context.Tag + Layer)
    <feature>.routes.ts      # Hono shell; impure read -> pure core -> respond
  platform/                  # cross-cutting infra (runtime.ts, etc.)
  api.ts                     # assembles routes; exports AppType for hc RPC
  main.ts                    # composition root (Bun.serve, provides live Layers)
apps/web/                    # optional UI: Vite+React + TanStack Router + Query
apps/e2e/                    # Playwright; asserts /health end-to-end
shared/                      # @effect/schema contracts (promote when >=2 apps use)
```

`platform/` is for infra shared across slices (the Effect runtime, config,
shell). Anything feature-specific lives in its slice.

## The impureim sandwich (critical)

- **`*.core.ts` is pure.** Failures are values: `Either<E, A>`, `Option`, or
  `Data` tagged unions. Typed errors YES — but **NO** `Effect` / `Layer` /
  `Context` / `ManagedRuntime`, no async, no I/O. `Either`, `Option`, `Data`,
  and `Schema` from `effect` / `@effect/schema` are allowed.
- **`*.repo.ts` / `*.routes.ts` / `main.ts` use Effect.** Services are
  `Context.Tag`s, wiring is `Layer`s, the runtime is a `ManagedRuntime`.
- **Lift core into Effect at the boundary.** A route reads I/O (impure), calls
  the pure core (sandwich filling), responds. An `Either` returned by core is
  `yield*`-ed directly inside `Effect.gen` (an `Either` is a valid Effect
  yieldable; a `Left` short-circuits as a typed failure).

Biome enforces this: `*.core.ts` may not import `Effect`/`Layer`/`Context` from
`effect`, and may not import any `*.repo` module.

## Other axioms (each enforced by a tool)

- **Named params for 3+ args.** `useMaxParams` caps positional params at 2 — pass
  an options object beyond that.
- **No raw `fetch`, no `axios`.** `noRestrictedGlobals` bans the `fetch` global;
  `noRestrictedImports` bans `axios`. The web app talks to the server through the
  typed Hono RPC client (`hc<AppType>`) only.
- **Co-located tests.** `*.test.ts` next to its source. Never a `__tests__/`
  folder.
- **Router loads, Query owns the cache.** Define `queryOptions` ONCE; the route
  `loader` calls `ensureQueryData`, the component calls `useSuspenseQuery` on the
  same options. No loading flash, no key drift. TanStack Router is UI-only (NOT
  Start).

## How to add a feature slice

1. `mkdir apps/server/src/features/<feature>`.
2. `<feature>.core.ts` — pure functions; model failures as `Either`/`Option`/`Data`.
3. `<feature>.core.test.ts` — cover the core data-in/data-out, no mocks.
4. `<feature>.repo.ts` — `Context.Tag` service + `*RepoLive` Layer for the I/O.
5. `<feature>.routes.ts` — Hono app; `Effect.gen` sandwich; export `app`.
6. Mount in `api.ts` (`.route("/<feature>", route.app)`) and add `*RepoLive` to
   `AppLayer` in `platform/runtime.ts`.
7. (web) add `<feature>.queries.ts` (queryOptions once) + `<feature>.route.tsx`.

## Gate commands

```bash
bun install            # installs + wires git hooks (lefthook)
bun run lint           # biome check --write .   (autofix)
bun run lint:ci        # biome ci .              (no writes; CI gate)
bun run typecheck      # tsc -b
bun run test           # bun test apps/server shared (co-located unit tests)
bun run test:e2e       # playwright (apps/e2e; run `bunx playwright install` once)
bun run audit          # bunx fallow audit (dead code / dup / cycles / complexity)
bun run dev            # server (:8787) + web (:5173)
bun run scaffold:clean # remove apps/web + apps/e2e -> backend-only repo
```

CI job names (`lint` / `typecheck` / `test` / `audit`) are a contract with the
branch ruleset's required checks — keep them identical.
