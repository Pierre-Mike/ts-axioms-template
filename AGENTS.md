# AGENTS.md — ts-axioms template

Tool-neutral operating rules for any coding agent working in this repo.

Everything between the markers below is the shared canon, byte-identical with
`CLAUDE.md` — `scripts/docs-sync.test.ts` fails the build if they drift. Edit
both files together.

<!-- axioms:start -->
## Architecture: feature-first vertical slices

Code is organized by **feature**, not by layer. Each slice owns its full
vertical:

```
apps/server/src/
  features/<feature>/        # shipped: health (clock io), notes (sqlite persistence)
    <feature>.core.ts        # PURE domain logic — no I/O, no Effect runtime
    <feature>.core.test.ts   # co-located unit test (data-in / data-out)
    <feature>.io.ts          # I/O as an Effect service (Context.Tag + Layer)
    <feature>.routes.ts      # Hono shell; impure read -> pure core -> respond
    <feature>.door.ts        # opt-in: the ONLY file other slices may import
  platform/                  # cross-cutting infra (runtime, typed config, http errors)
  api.ts                     # assembles routes; exports AppType for hc RPC
  main.ts                    # composition root (Bun.serve, provides live Layers)
apps/web/                    # optional UI: Vite+React + TanStack Router + Query
apps/e2e/                    # Playwright; asserts /health + /notes end-to-end
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
- **`*.io.ts` / `*.routes.ts` / `main.ts` use Effect.** Services are
  `Context.Tag`s, wiring is `Layer`s, the runtime is a `ManagedRuntime`.
- **Lift core into Effect at the boundary.** A route reads I/O (impure), calls
  the pure core (sandwich filling), responds. An `Either` returned by core is
  `yield*`-ed directly inside `Effect.gen` (an `Either` is a valid Effect
  yieldable; a `Left` short-circuits as a typed failure).
- **`*.io.ts` is the slice's I/O port** (hexagonal sense) — any effectful
  dependency (DB, HTTP, clock), not just persistence.

Biome enforces this: in `*.core.ts` the imports `Effect`/`Layer`/`Context` and
any `*.io` or `*.door` module are banned, the globals `Date` / `process` /
`Promise` / `console` / `setTimeout` / `setInterval` are banned, and GritQL
plugins (`biome-plugins/`) ban `throw` and `await`.

## Other axioms (each enforced by a tool)

- **Named params for 2+ args — on signatures you design.** A GritQL plugin
  (`biome-plugins/max-one-param-declarations.grit`) bans 2+ positional params on
  named/exported function declarations — pass a single options object instead;
  a one-object interface stays narrow as the implementation deepens. Inline
  callbacks whose shape a library dictates (`sort((a, b))`, Hono's `(c, next)`,
  Effect's `(acc, a)`) are exempt by construction.
- **No raw `fetch`, no `axios`.** `noRestrictedGlobals` bans the `fetch` global;
  `noRestrictedImports` bans `axios`. The web app talks to the server through the
  typed Hono RPC client (`hc<AppType>`) only. One exception: `*.io.ts` — the
  slice's sanctioned I/O layer — may use `fetch` to call external services.
- **Co-located tests.** `*.test.ts` next to its source; never a `__tests__/`
  folder. Every `*.core.ts` MUST have a sibling `*.core.test.ts`
  (`scripts/check-colocated-tests.ts` gates `bun run test`). Use fast-check
  properties for non-trivial pure logic.
- **Typed config at boot.** The server reads `process.env` ONLY in
  `platform/config.ts` (schema-validated, fails fast); Biome bans the `process`
  global elsewhere under `apps/server/src` (composition root excepted).
- **One error shape.** Failures cross HTTP as the shared `ApiErrorBody`
  envelope. `platform/http.ts` `STATUS_BY_TAG` is an **allowlist**: registering
  a tag declares it client-safe at its mapped status; an unregistered tag — or
  a defect caught by `app.onError` — returns a redacted `InternalServerError`
  500 and logs the real error server-side. Forgetting to register fails safe.
- **Log through the runtime, not `console`.** `noConsole` bans `console` in
  slices (`error`/`warn` allowed at the platform boundary). Programs log with
  `Effect.log*`, rendered by the Logger layer in `platform/runtime.ts`
  (`Logger.json` in production, `Logger.pretty` in dev); every request gets an
  id (`hono/request-id`) and an access log at the edge (`api.ts`).
- **Contracts decode at the boundary.** Shared effect `Schema` contracts live
  in `shared/src`; the web client decodes responses with the shared `decode*`
  helpers, which reject undocumented fields (`onExcessProperty: "error"`) —
  drift fails loudly. `openapi.json` is generated from the same schemas
  (`bun run openapi:gen`; CI checks freshness), and the generator's route↔spec
  parity check fails when the live Hono routes and the spec disagree.
- **Router loads, Query owns the cache.** Define `queryOptions` ONCE; the route
  `loader` calls `ensureQueryData`, the component calls `useSuspenseQuery` on the
  same options. No loading flash, no key drift. TanStack Router is UI-only (NOT
  Start).
- **Conventional commits.** `type(scope)?: subject` — the lefthook commit-msg
  hook rejects anything else; release-please builds releases from the history.
- **Modules talk through doors, not back-channels (modular monolith).** A feature
  slice may import another slice's *published* door — a service `Context.Tag` plus
  a `shared/` `Schema` contract — but NEVER its internal files. Biome
  `noRestrictedImports` bans cross-slice `../*/*.{core,io,routes}` imports under
  `features/`; `fallow audit` rejects the cycles a back-channel would create.
  Promote a contract to `shared/` the moment a second module needs it. The door
  is a file: `<feature>.door.ts`, inside the slice that publishes it — ownership
  stays with the module fronting the code, and it is the one cross-slice path
  the ban leaves open. It re-exports that slice's service `Context.Tag` and its
  interface type plus the `shared/` `Schema` contract for the data crossing it,
  so consumers have a single import site and nothing else in the slice is
  importable from outside; `bun run scaffold:slice <feature> --door` stamps one
  out (opt-in — an unconsumed door is dead code the `audit` gate rejects). The
  module boundary (the narrow typed door) is independent of the deployment
  boundary: compose every module's live `Layer` into one process by default
  (in-process calls, no network). A module becomes a separate deployment only
  under real pressure (independent scaling, fault/team isolation) — and because
  consumers depend on the `Tag`, not the implementation, that split swaps a
  `Layer` at the composition root, not call sites. Design as if distributed;
  deploy as if together.
- **Platform-agnostic deploy.** The deploy unit is the container
  (`apps/server/Dockerfile`); `infra/` is a Pulumi TS program that dispatches
  to a per-provider `DeployTarget` adapter (`infra/src/registry.ts`; gcp is the
  reference). Stack config decodes through `infra/src/config.core.ts` — same
  typed-config-fails-fast axiom as the server. See `infra/README.md` to add a
  provider.
- **Evals + retrospective close the loop (the harness improves over time).**
  Tests/lint verify deterministic code; **evals** verify the non-deterministic
  half — including the harness itself. `evals/` is a frozen grid of
  `task × model × repeat`: each cell hands a task to a headless agent in a
  throwaway worktree, then judges it twice — the repo's gates (`lint:ci` /
  `typecheck` / `test` / `audit`) prove nothing broke, and per-task
  **asserts** (mostly real HTTP through `evals/probe.ts`) prove the feature
  actually runs. Asserts outweigh gates 2:1 because `bun run verify` is green
  on an untouched checkout — a gates-only task scores a do-nothing agent 100%.
  `bun run evals:baseline` (no agent, no tokens) makes that visible and
  `bun run doctor` rejects any task with no asserts. The task set spans
  application *archetypes*, not just CRUD — pure algorithm, persistence + state
  machine, external HTTP, shared contract, cross-cutting middleware, web
  loader/query, cross-module door, background (non-request) work, streaming,
  infra adapter, rename survival — so a structure that only fits one shape
  shows up as a column of zeros. Two questions get answered: *did my harness
  change help?* — `evals/report.ts --compare` judges the delta against a 2σ
  noise floor built from the repeats, never a single run (score up → keep and
  ratchet the floor; sustained drop → revert); and *how cheap a model can this
  carry?* — the model table ranks by score AND cost-per-point, so strong
  determinism buys a smaller tier exactly where the grid says it does. `/retro`
  (`.claude/skills/retro`) is the diagnosis step — it mines `.claude/traces/`,
  git history, and merged PRs into a few ranked, **enforcement-biased**
  proposals (prefer a hook/lint/test/script over a guideline; enforcements
  compound, guidelines decay). Loop: `/retro` proposes → apply → re-run the
  grid → keep what raises the score.

- **Pick the model tier from the grid, not from habit.** Strong determinism is
  supposed to buy a cheaper model; the grid says exactly where it does. Measured
  2026-07-26 at `1de825b` (full 36-cell grid, plus haiku ×3 repeats on `core`):
  **haiku 0.945 at ~$0.25–0.30/task, sonnet 0.937 at $1.22, opus 0.966 at $2.36** —
  8× the price of haiku for +0.02 of score. Per archetype, haiku went 3/3 on the
  shapes the scaffolder already stamps out (typed error taxonomy, shared
  contracts, pure algorithms, web loader/query slices) and degraded precisely
  where correctness is multi-step *runtime* behaviour: 2/3 persistence + state
  machine, 2/3 cross-cutting middleware, 1/3 external-integration failure
  mapping, and a background job it wired with `Effect.fork` that never ticked.
  So: **cheap tier for structural work inside the canonical shape; escalate for
  behaviour that has to be live-correct** (background/scheduled work, upstream
  failure mapping, anything whose proof is an HTTP round-trip rather than a
  type). Escalate rather than retry blindly — a red cell is often variance
  (`crud-state-machine` failed for sonnet in the grid and passed on re-run), so
  re-run with `--repeats 3` before concluding a tier cannot do something. These
  numbers are a snapshot of THIS harness: re-measure with `bun run evals` after
  a harness change or a new model release, and treat the reference tables in
  `evals/README.md` as the record of what was last measured.

- **The harness checks itself.** Enforcement attaches to file *shape*, not
  location (`**/*.core.ts`, `**/*.io.ts`, `**/features/**`,
  `**/platform/config.ts`): denials are global, allows are sanctioned shapes,
  so renaming or adding an app cannot fail open. `bun run doctor`
  (`scripts/check-harness.ts`, inside the `test` gate) structurally asserts
  the enforcement stack itself: Biome overrides + grit plugins present,
  lefthook jobs wired, CI job names cover the ruleset's required checks,
  actions SHA-pinned, every workspace in the `tsc -b` graph, canon sync
  markers intact, gate scripts composed. Deleting a gate is a deliberate,
  visible act that fails CI — not silent drift. Motivated by a descendant
  audit where an app rename silently evaporated every path-scoped rule.

## How to add a feature slice

`features/health` is the minimal exemplar (clock io); `features/notes` is the
persistence exemplar (bun:sqlite; multi-step sandwich: impure read → pure
decide → impure write). Study whichever is closer to your slice, then:

1. `bun run scaffold:slice <feature>` — generates the slice files in the
   canonical shape, mounts the route in `api.ts` over the shared `appRuntime`,
   and registers the live Layer in `platform/runtime.ts`. Never hand-copy a
   slice. Add `--door` when another module will consume this one — it also
   emits `<feature>.door.ts`, the slice's published surface.
2. Implement the real pure logic in `<feature>.core.ts` + its co-located test.
3. Replace the stub I/O in `<feature>.io.ts`.
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
bun run test           # core/test colocation check + bun test apps/server shared scripts infra
bun run test:e2e       # playwright (apps/e2e; run `bunx playwright install` once)
bun run test:mutation  # stryker mutation run over *.core.ts (also weekly in CI)
bun run audit          # fallow full-repo scan (dead code / dup / cycles / complexity)
bun run doctor         # harness self-check: the enforcement stack itself is intact (also in test)
bun run evals          # agent evals: task × model grid (evals/README.md)
bun run evals:baseline # score the grid with NO agent — proves tasks measure work
bun run evals:report   # markdown report; --compare A B for a 2σ A/B verdict
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
