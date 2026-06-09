## What & why

<!-- One paragraph: what this change does and the motivation. -->

## Checklist

- [ ] **Axioms followed** — functional core is pure (failures as `Either`/`Option`/`Data`, no Effect runtime in `*.core.ts`); Effect lives only at the I/O boundary (`*.repo.ts` / `*.routes.ts` / `main.ts`); named params for 3+ args; no raw `fetch`/`axios` (typed Hono RPC client only).
- [ ] **Tests co-located** — new logic ships a `*.test.ts` next to its source (never `__tests__/`); pure core covered data-in/data-out.
- [ ] **Fallow audit clean** — `bun run audit` reports no dead code, duplication, or circular deps.
- [ ] **Gates green locally** — `bun run lint:ci`, `bun run typecheck`, `bun test` all pass.
- [ ] Feature-first slice structure preserved (`features/<f>/` with `.core` / `.repo` / `.routes`; cross-cutting infra in `platform/`).
