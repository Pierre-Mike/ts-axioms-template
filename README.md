# ts-axioms-template

A GitHub **template repository** for TypeScript services built on the
ts-axioms canon: **feature-first vertical slices**, a **pure functional core /
imperative Effect shell** (impureim), and **governance-as-code**. Every
principle is enforced by a tool — no enforcement, no rule.

## Stack

- **Runtime/PM:** [Bun](https://bun.sh) (workspaces, test runner) — no
  npm/yarn, no Turborepo.
- **Server:** [Hono](https://hono.dev) + [Effect](https://effect.website)
  (+ built-in `Schema`). Effect lives only at the I/O boundary.
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
> `bunx degit Pierre-Mike/ts-axioms-template my-service`

## Gates

```bash
bun run verify     # the four CI gates, one shot
bun run lint:ci    # biome ci . (+ GritQL purity plugins, openapi freshness in CI)
bun run typecheck  # tsc -b
bun run test       # core/test colocation check + co-located unit tests
bun run audit      # fallow full-repo scan (CI adds `bun audit` for vulnerabilities)
```

These four are the CI jobs (`lint` / `typecheck` / `test` / `audit`) and the
branch ruleset's required checks — the names are a contract. CI also runs
non-required `e2e` (Playwright) and `zizmor` (workflow lint) jobs per PR, plus
weekly mutation tests (Stryker on `*.core.ts`) and the agent eval grid
(`evals/`).

## Reference slice: `health`

`apps/server/src/features/health/` is the canonical slice and the CI smoke test:
pure core (`health.core.ts`) → Effect io (`health.io.ts`) → Hono route
(`health.routes.ts`) → shared schema contract (`shared/src/health.ts`) → typed
RPC with runtime decode → web route → Playwright e2e. Don't hand-copy it —
generate new slices:

```bash
bun run scaffold:slice <feature>   # core + test + io + routes, mounted + wired
```

## AI-ready by construction

- `CLAUDE.md` / `AGENTS.md` share a marker-delimited canon; a unit test fails
  the build if they drift.
- Conventional commits enforced at commit-msg (lefthook); release-please
  automates releases from the history.
- `openapi.json` is generated from the shared effect `Schema` contracts and
  freshness-checked in CI.
- Toolchain pinned (`.bun-version`, `packageManager`, SHA-pinned actions);
  Renovate auto-merges green minor/patch dev-dep bumps.
- `.devcontainer/` gives agents and humans the identical sandbox.

## Optional tiers

- `bunx playwright install` — **prerequisite** for the e2e suite (browsers are
  not installed by `bun install` or CI bootstrap).
- `bun run scaffold:clean` — strip `apps/web` + `apps/e2e` for a backend-only
  service.
- `bun run test:mutation` — Stryker mutation run over the pure cores.
- `bun run evals` — agent evals over a `task × model × repeat` grid: twelve
  application archetypes, judged by the repo's gates **and** functional
  asserts that drive real HTTP. Answers "does the template still steer agents
  to working code?" and "how cheap a model can it carry?" (cost-per-point per
  model, 2σ A/B verdicts). `bun run evals:baseline` scores the grid with no
  agent and costs nothing. See [evals/README.md](./evals/README.md).

## Docs

- [Architecture](./docs/architecture.md) — slices, impureim, platform, Turborepo upgrade trigger.
- [Governance](./docs/governance.md) — the ruleset, applying it, the check-name contract.
- [Contributing](./docs/contributing.md) — branch → PR → green CI → squash-merge.
- [Getting started](./docs/getting-started.md) — from template to first feature.
- `CLAUDE.md` / `AGENTS.md` — agent operating rules + "add a feature slice" recipe.

## License

[MIT](./LICENSE)
