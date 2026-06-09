# ts-axioms-template

A GitHub **template repository** for TypeScript services built on the
ts-axioms canon: **feature-first vertical slices**, a **pure functional core /
imperative Effect shell** (impureim), and **governance-as-code**. Every
principle is enforced by a tool — no enforcement, no rule.

## Stack

- **Runtime/PM:** [Bun](https://bun.sh) (workspaces, test runner) — no
  npm/yarn, no Turborepo.
- **Server:** [Hono](https://hono.dev) + [Effect](https://effect.website)
  (+ `@effect/schema`). Effect lives only at the I/O boundary.
- **Web (optional):** Vite + React + TanStack Router (UI only) + TanStack Query
  over the typed Hono RPC client (`hc<AppType>`).
- **E2E (optional):** Playwright, asserting `/health` end-to-end.
- **Lint/format:** [Biome](https://biomejs.dev) (one tool, not ESLint+Prettier).
- **Git hooks:** [Lefthook](https://lefthook.dev) (`stage_fixed`, not husky+lint-staged).
- **Audit:** [Fallow](https://www.npmjs.com/package/fallow) — dead code,
  duplication, circular deps, complexity.
- **Governance:** a GitHub repository ruleset checked into `.github/rulesets/`.

## Quickstart

```bash
bun install            # deps + git hooks
bun run dev            # server :8787 + web :5173
curl localhost:8787/health
```

Full setup (template/degit, branch protection, first slice, backend-only):
[docs/getting-started.md](./docs/getting-started.md).

> Degit alternative (no history):
> `bunx degit your-org/ts-axioms-template my-service`

## Gates

```bash
bun run lint:ci    # biome ci .
bun run typecheck  # tsc -b
bun test           # co-located unit tests
bun run audit      # fallow audit
```

These four are the CI jobs (`lint` / `typecheck` / `test` / `audit`) and the
branch ruleset's required checks — the names are a contract.

## Reference slice: `health`

`apps/server/src/features/health/` is the canonical slice and the CI smoke test:
pure core (`health.core.ts`) → Effect repo (`health.repo.ts`) → Hono route
(`health.routes.ts`) → typed RPC → web route → Playwright e2e. Copy its shape
for new features.

## Optional tiers

- `bunx playwright install` — **prerequisite** for the e2e suite (browsers are
  not installed by `bun install` or CI bootstrap).
- `bun run scaffold:clean` — strip `apps/web` + `apps/e2e` for a backend-only
  service.

## Docs

- [Architecture](./docs/architecture.md) — slices, impureim, platform, Turborepo upgrade trigger.
- [Governance](./docs/governance.md) — the ruleset, applying it, the check-name contract.
- [Contributing](./docs/contributing.md) — branch → PR → green CI → squash-merge.
- [Getting started](./docs/getting-started.md) — from template to first feature.
- `CLAUDE.md` / `AGENTS.md` — agent operating rules + "add a feature slice" recipe.
