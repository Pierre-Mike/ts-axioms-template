# AGENTS.md — ts-axioms template

Tool-neutral operating rules for any coding agent working in this repo. This
mirrors `CLAUDE.md`; both must stay in sync.

## Architecture: feature-first vertical slices

Organize by feature, not by layer. Each slice owns its vertical:

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

## The impureim sandwich (critical)

- `*.core.ts` is pure: failures are values (`Either`/`Option`/`Data` tagged
  unions). No `Effect`/`Layer`/`Context`/`ManagedRuntime`, no async, no I/O.
  `Either`/`Option`/`Data`/`Schema` are allowed.
- `*.repo.ts` / `*.routes.ts` / `main.ts` use the Effect runtime (`Context.Tag`
  services, `Layer` wiring, `ManagedRuntime`).
- Lift core into Effect at the boundary: read I/O, call pure core, respond. A
  core `Either` is `yield*`-ed inside `Effect.gen`; a `Left` short-circuits as a
  typed failure.

Biome blocks `Effect`/`Layer`/`Context` imports and `*.repo` imports inside
`*.core.ts`.

## Other axioms (tool-enforced)

- Named params for 3+ args (`useMaxParams` max 2).
- No raw `fetch` global, no `axios`. Use the typed Hono RPC client `hc<AppType>`.
- Co-located tests (`*.test.ts`), never `__tests__/`.
- TanStack Router loads (loader -> `ensureQueryData`); TanStack Query owns the
  cache (component -> `useSuspenseQuery`). Define `queryOptions` once. Router is
  UI-only, not Start.

## How to add a feature slice

1. Create `apps/server/src/features/<feature>/`.
2. `<feature>.core.ts` (pure) + `<feature>.core.test.ts` (co-located).
3. `<feature>.repo.ts` (`Context.Tag` + `*RepoLive` Layer).
4. `<feature>.routes.ts` (Hono `Effect.gen` sandwich; export `app`).
5. Mount in `api.ts`; add `*RepoLive` to `AppLayer` in `platform/runtime.ts`.
6. (web) add `<feature>.queries.ts` + `<feature>.route.tsx`.

## Gate commands

```bash
bun install            # install + wire git hooks
bun run lint:ci        # biome ci .
bun run typecheck      # tsc -b
bun test               # unit tests
bun run audit          # fallow audit
bun run scaffold:clean # backend-only (removes web + e2e)
```

CI job names `lint` / `typecheck` / `test` / `audit` must match the branch
ruleset's required checks in `.github/rulesets/main.json`.
