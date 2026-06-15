# CLAUDE.md — ts-axioms template

Agent operating rules for this repo. These are enforced by tooling (Biome /
Lefthook / Fallow / `tsc`); if you fight a rule, fix the design, not the linter.

Everything between the markers below is the shared canon, byte-identical with
`AGENTS.md` — `scripts/docs-sync.test.ts` fails the build if they drift. Edit
both files together.

<!-- axioms:start -->
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
  platform/                  # cross-cutting infra (runtime, typed config, http errors)
  api.ts                     # assembles routes; exports AppType for hc RPC
  main.ts                    # composition root (Bun.serve, provides live Layers)
apps/web/                    # optional UI: Vite+React + TanStack Router + Query
apps/e2e/                    # Playwright; asserts /health end-to-end
shared/                      # effect Schema contracts (promote when >=2 apps use)
infra/                       # Pulumi (TS): provider-neutral DeployTarget + per-cloud adapters
```

`platform/` is for infra shared across slices (the Effect runtime, typed
config, HTTP error mapping). Anything feature-specific lives in its slice.

## The impureim sandwich (critical)

- **`*.core.ts` is pure.** Failures are values: `Either<E, A>`, `Option`, or
  `Data` tagged unions. Typed errors YES — but **NO** `Effect` / `Layer` /
  `Context` / `ManagedRuntime`, no async, no I/O, no clock. `Either`, `Option`,
  `Data`, and `Schema` from `effect` are allowed.
- **`*.repo.ts` / `*.routes.ts` / `main.ts` use Effect.** Services are
  `Context.Tag`s, wiring is `Layer`s, the runtime is a `ManagedRuntime`.
- **Lift core into Effect at the boundary.** A route reads I/O (impure), calls
  the pure core (sandwich filling), responds. An `Either` returned by core is
  `yield*`-ed directly inside `Effect.gen` (an `Either` is a valid Effect
  yieldable; a `Left` short-circuits as a typed failure).

Biome enforces this: in `*.core.ts` the imports `Effect`/`Layer`/`Context` and
any `*.repo` module are banned, the globals `Date` / `process` / `Promise` /
`console` / `setTimeout` / `setInterval` are banned, and GritQL plugins
(`biome-plugins/`) ban `throw` and `await`.

## Other axioms (each enforced by a tool)

- **Named params for 2+ args.** `useMaxParams` caps positional params at 1 — pass
  a single options object beyond that. A one-object interface stays narrow as the
  implementation deepens.
- **No raw `fetch`, no `axios`.** `noRestrictedGlobals` bans the `fetch` global;
  `noRestrictedImports` bans `axios`. The web app talks to the server through the
  typed Hono RPC client (`hc<AppType>`) only.
- **Co-located tests.** `*.test.ts` next to its source; never a `__tests__/`
  folder. Every `*.core.ts` MUST have a sibling `*.core.test.ts`
  (`scripts/check-colocated-tests.ts` gates `bun run test`). Use fast-check
  properties for non-trivial pure logic.
- **Typed config at boot.** The server reads `process.env` ONLY in
  `platform/config.ts` (schema-validated, fails fast); Biome bans the `process`
  global elsewhere under `apps/server/src` (composition root excepted).
- **One error shape.** Failures cross HTTP as the shared `ApiErrorBody`
  envelope; map new tags to statuses in `platform/http.ts` `STATUS_BY_TAG`.
  `scripts/check-error-tags.ts` (in `bun run test`) fails the build if a core
  returns an `Either.left` tag absent from `STATUS_BY_TAG` — an unmapped tag
  would otherwise silently fall through to the `?? 400` default at runtime.
  `scaffold:slice` registers the tag it generates for you.
- **Contracts decode at the boundary.** Shared effect `Schema` contracts live
  in `shared/src`; the web client decodes responses with the shared
  `decode*` helpers — drift fails loudly. `openapi.json` is generated from the
  same schemas (`bun run openapi:gen`; CI checks freshness).
- **Router loads, Query owns the cache.** Define `queryOptions` ONCE; the route
  `loader` calls `ensureQueryData`, the component calls `useSuspenseQuery` on the
  same options. No loading flash, no key drift. TanStack Router is UI-only (NOT
  Start).
- **Conventional commits.** `type(scope)?: subject` — the lefthook commit-msg
  hook rejects anything else; release-please builds releases from the history.
- **Modules talk through doors, not back-channels (modular monolith).** A feature
  slice may import another slice's *published* door — a service `Context.Tag` plus
  a `shared/` `Schema` contract — but NEVER its internal files. Biome
  `noRestrictedImports` bans cross-slice `../*/*.{core,repo,routes}` imports under
  `features/`; `fallow audit` rejects the cycles a back-channel would create.
  Promote a contract to `shared/` the moment a second module needs it. The module
  boundary (the narrow typed door) is independent of the deployment boundary:
  compose every module's live `Layer` into one process by default (in-process
  calls, no network). A module becomes a separate deployment only under real
  pressure (independent scaling, fault/team isolation) — and because consumers
  depend on the `Tag`, not the implementation, that split swaps a `Layer` at the
  composition root, not call sites. Design as if distributed; deploy as if
  together.
- **Platform-agnostic deploy.** The deploy unit is the container
  (`apps/server/Dockerfile`); `infra/` is a Pulumi TS program that dispatches
  to a per-provider `DeployTarget` adapter (`infra/src/registry.ts`; gcp is the
  reference). Stack config decodes through `infra/src/config.core.ts` — same
  typed-config-fails-fast axiom as the server. See `infra/README.md` to add a
  provider.

## How to add a feature slice

1. `bun run scaffold:slice <feature>` — generates the slice files in the
   canonical shape, mounts the route in `api.ts` over the shared `appRuntime`,
   and registers the live Layer in `platform/runtime.ts`. Never hand-copy a
   slice.
2. Implement the real pure logic in `<feature>.core.ts` + its co-located test.
3. Replace the stub I/O in `<feature>.repo.ts`.
4. Map new error tags in `platform/http.ts`.
5. Promote contracts to `shared/src` when the web consumes them; register the
   path in `scripts/generate-openapi.ts` and run `bun run openapi:gen`.
6. (web) add `<feature>.queries.ts` (queryOptions once, decode with the shared
   schema) + `<feature>.route.tsx`.
7. `bun run verify`.

## Gate commands

```bash
bun install            # installs + wires git hooks (lefthook)
bun run verify         # lint:ci + typecheck + test + audit — the CI gates, one shot
bun run lint           # biome check --write .   (autofix)
bun run lint:ci        # biome ci .              (no writes; CI gate)
bun run typecheck      # tsc -b
bun run test           # core/test colocation + error-tag mapping checks + bun test apps/server shared scripts infra
bun run test:e2e       # playwright (apps/e2e; run `bunx playwright install` once)
bun run test:mutation  # stryker mutation run over *.core.ts (also weekly in CI)
bun run audit          # fallow full-repo scan (dead code / dup / cycles / complexity)
bun run openapi:gen    # regenerate openapi.json from the shared schemas
bun run scaffold:slice # generate a new feature slice
bun run scaffold:clean # remove apps/web + apps/e2e -> backend-only repo
bun run infra:preview  # pulumi preview (needs pulumi CLI + a configured stack)
bun run infra:up       # build the server image, push, deploy to the stack's target
bun run dev            # server (:8787) + web (:5173)
```

CI job names (`lint` / `typecheck` / `test` / `audit`) are a contract with the
branch ruleset's required checks — keep them identical. `e2e`, `scaffold`, and `zizmor`
run as additional non-required jobs; mutation tests and agent evals run weekly.
<!-- axioms:end -->
