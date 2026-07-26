---
name: add-slice
description: Add a new feature slice to this repo the canonical way. Use when asked to add a feature, endpoint, resource, or API route. Runs the deterministic scaffolder, then guides filling in the pure core, io layer, and web wiring, and verifies with the repo gates.
---

# Add a feature slice

1. Scaffold (kebab-case name):

   ```bash
   bun run scaffold:slice <feature>        # add --door if another slice will consume it
   ```

   This generates `<feature>.core.ts` / `<feature>.core.test.ts` /
   `<feature>.io.ts` / `<feature>.routes.ts` / `<feature>.routes.test.ts`,
   mounts the route in `api.ts` over the shared `appRuntime`, and registers
   `<Feature>IoLive` in `platform/runtime.ts`. Never hand-copy the health
   slice.

2. Implement the real domain logic in `<feature>.core.ts` — PURE: plain data
   in/out, failures as `Either`/`Option`/`Data` tagged unions. No
   `Effect`/`Layer`/`Context`, no `Date`/`process`/`Promise`/`throw`/`await`
   (Biome enforces all of this). Grow the co-located test alongside; add
   fast-check properties for non-trivial logic.

3. Replace the stub I/O in `<feature>.io.ts` with the real service body.
   Routes depend on the `Context.Tag`, never the implementation.

4. Publish a door only if another feature slice consumes this one:
   `<feature>.door.ts`, in this slice, re-exporting the service `Context.Tag`
   and its interface type (plus the `shared/` `Schema` contract for the data
   crossing it). That file is the only cross-slice import Biome allows — never
   reach into a sibling's `.core` / `.io` / `.routes`, and never import a door
   from a `*.core.ts`. Import it from the consumer right away: an unconsumed
   door is dead code and `bun run audit` fails on it.

5. Map any new error tags to HTTP statuses in `platform/http.ts`
   (`STATUS_BY_TAG`); the shared `ApiErrorBody` envelope is the only error
   shape clients see.

6. Contract + spec: promote the response schema to `shared/src` once the web
   app consumes it; register the path in `scripts/generate-openapi.ts` and run
   `bun run openapi:gen`.

7. (web) Add `<feature>.queries.ts` (one `queryOptions`, decode with the
   shared schema) + `<feature>.route.tsx` (loader `ensureQueryData`, component
   `useSuspenseQuery`).

8. Gate everything:

   ```bash
   bun run verify
   ```
