---
name: add-slice
description: Add a new feature slice to this repo the canonical way. Use when asked to add a feature, endpoint, resource, or API route. Runs the deterministic scaffolder, then guides filling in the pure core, io layer, and web wiring, and verifies with the repo gates.
---

# Add a feature slice

1. Scaffold (kebab-case name):

   ```bash
   bun run scaffold:slice <feature>
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

4. Map any new error tags to HTTP statuses in `platform/http.ts`
   (`STATUS_BY_TAG`); the shared `ApiErrorBody` envelope is the only error
   shape clients see.

5. Contract + spec: promote the response schema to `shared/src` once the web
   app consumes it; register the path in `scripts/generate-openapi.ts` and run
   `bun run openapi:gen`.

6. (web) Add `<feature>.queries.ts` (one `queryOptions`, decode with the
   shared schema) + `<feature>.route.tsx` (loader `ensureQueryData`, component
   `useSuspenseQuery`).

7. Gate everything:

   ```bash
   bun run verify
   ```
