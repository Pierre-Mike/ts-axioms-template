# IDEA.md — making ts-axioms-template a first-class AI-ready repo

> **Status: implemented** (2026-06-09) — all items below are in the repo, with
> two exceptions left for a human: **#2** (PostToolUse hook) and **#19**
> (permission allowlist) touch `.claude/settings.json` permission machinery,
> which the agent sandbox refuses to self-modify. Apply them manually if
> wanted. Deviations: #2 would run Biome only (not scoped `tsc`) to keep the
> hook fast; #11 generates OpenAPI via a registry script
> (`scripts/generate-openapi.ts`) instead of the `hono-openapi` middleware.

Candidate upgrades, ordered by leverage. Each follows the repo's own axiom:
**no enforcement, no rule** — every idea names the tool that enforces it.
"AI-ready" here means: an agent dropped into this repo gets fast feedback,
deterministic scaffolding, machine-readable contracts, and gates that catch
plausible-but-wrong code.

---

## Tier 1 — agent feedback loop (highest leverage)

### 1. Single `verify` entrypoint
`bun run verify` = `lint:ci && typecheck && test && audit` — the exact CI
gates, one command. Agents (and humans) should never have to remember four
commands or discover failures at push time.
**Enforced by:** the script itself; CI calls the same script so local and CI
can't drift.

### 2. Claude Code `PostToolUse` hook — instant lint/type feedback
A `.claude/settings.json` hook that runs `biome check` + scoped `tsc` on every
file the agent edits. Today an agent learns about an impureim violation at
pre-commit; a hook surfaces it within the same turn, when fixing is cheapest.
**Enforced by:** `.claude/settings.json` `hooks.PostToolUse`.

### 3. Slice generator: `bun run scaffold:slice <name>`
CLAUDE.md describes the 7-step recipe in prose. A generator that emits
`<name>.core.ts` / `core.test.ts` / `repo.ts` / `routes.ts`, mounts the route
in `api.ts`, and adds `*RepoLive` to `AppLayer` makes the canonical shape
deterministic — agents copy nothing, drift nothing.
**Enforced by:** `scripts/scaffold-slice.ts` (sibling of `scaffold-clean.ts`).

### 4. CLAUDE.md ⇄ AGENTS.md sync test
Both files say "must stay in sync" but nothing checks it. A co-located doc
test (compare canonical sections, or make one `@`-include the other) turns the
promise into a gate.
**Enforced by:** `bun test` (a `docs.test.ts`), runs in the existing `test` job.

---

## Tier 2 — close the purity gaps (high standard)

### 5. Ban impure globals in `*.core.ts`
Biome currently bans `Effect`/`Layer`/`Context` imports in core — but a core
file can still call `Date.now()`, `Math.random()`, `process.env`, or
`console.*`. Extend the core override with `noRestrictedGlobals` for these.
The repo already models this correctly (`health.core.ts` takes `now` as
input); make the lint match the discipline.
**Enforced by:** `biome.json` override on `**/*.core.ts`.

### 6. Ban `throw` and `async` in core via Biome GritQL plugins
"Failures are values" is only half-enforced: nothing stops `throw` or
`async`/`await` inside a core. Biome 2 supports GritQL linter plugins — two
small plugins (`no-throw-in-core.grit`, `no-async-in-core.grit`) finish the
job.
**Enforced by:** `biome.json` `plugins` scoped to `**/*.core.ts`.

### 7. Every core must have a co-located test
"Co-located tests" is documented but unverified — an agent can ship
`foo.core.ts` with no `foo.core.test.ts`. A 10-line glob check fails the build
when a core lacks its sibling test.
**Enforced by:** `scripts/check-colocated-tests.ts` in the `test` CI job.

### 8. Mutation testing on `*.core.ts` (StrykerJS)
AI-generated tests pass vacuously more often than human ones. Cores are pure,
fast, and mock-free — ideal mutation targets. Run Stryker on core files only,
with a survival threshold; nightly or pre-release, not per-PR (cost).
**Enforced by:** `stryker.conf.json` + a scheduled CI job.

### 9. Property-based tests for cores (fast-check)
Pure data-in/data-out functions are exactly what property testing is for
(`parseVerbose` round-trips, `buildStatus` never negative uptime). Add
`fast-check` and demonstrate in `health.core.test.ts` so the reference slice
teaches the pattern.
**Enforced by:** the example itself — agents copy the canonical slice.

---

## Tier 3 — machine-readable contracts

### 10. Runtime decode at the RPC boundary
`shared/health.ts` is currently a type-only contract — the web client trusts
`res.json()`. Decode with `S.decodeUnknownSync(HealthStatus)` in
`health.queries.ts` so server/client drift fails loudly at runtime, not
silently in the UI.
**Enforced by:** the schema itself, exercised by the e2e suite.

### 11. OpenAPI spec generated from routes
`hono-openapi` + `@effect/schema` → JSON Schema gives a machine-readable API
surface for free. Agents, contract tests, and external consumers all read the
same artifact; a CI step diffs the committed spec against the generated one.
**Enforced by:** `openapi.json` freshness check in CI.

### 12. Typed config at boot
`process.env` is read ad-hoc in `main.ts`, `api.ts`, and `health.repo.ts`.
Centralize in `platform/config.ts` using Effect `Config` + schema validation —
boot fails fast with a typed error instead of half-working with a bad env.
Then ban `process.env` everywhere else.
**Enforced by:** Biome `noRestrictedGlobals`(`process`) outside `platform/`.

### 13. Shared `ApiError` envelope
The 400 shape in `health.routes.ts` is inline (`{ ok: false, error }`).
Promote a tagged-error→HTTP-status mapping to `shared/` so every slice returns
the same machine-parsable error envelope — agents writing clients can rely on
one shape.
**Enforced by:** the shared schema + e2e assertions.

---

## Tier 4 — CI/CD and supply-chain hardening

### 14. Pin the toolchain
CI uses `bun-version: latest` — irreproducible by construction. Pin via
`.bun-version` (setup-bun reads it) and `packageManager` in root
`package.json`. Same for pinning Actions to commit SHAs.
**Enforced by:** `setup-bun` + `zizmor` (workflow linter) in CI.

### 15. e2e as an optional 5th gate
Playwright exists but never runs in CI. Add an `e2e` job (with browser cache)
on PRs touching `apps/web` or `apps/server` — the health slice is already the
smoke test; let it actually gate.
**Enforced by:** CI job + path filter; add to ruleset checks if made required.

### 16. Conventional commits + release automation
A lefthook `commit-msg` job (commitlint) plus release-please gives
machine-readable history — agents summarizing changes, generating changelogs,
or bisecting benefit directly.
**Enforced by:** lefthook `commit-msg` hook; release-please CI.

### 17. Dependency + vulnerability gates
`bun audit` (or osv-scanner) as a CI job, plus Renovate with auto-merge for
green patch/minor bumps — strong gates make automated bumps safe, which keeps
the template evergreen without human toil.
**Enforced by:** CI job + `renovate.json`.

---

## Tier 5 — agent-native extras

### 18. Repo skill: `.claude/skills/add-slice/`
Move the "add a feature slice" recipe from CLAUDE.md prose into an invocable
skill that shells out to the scaffolder (#3) and then runs `verify` (#1).
CLAUDE.md shrinks to axioms + pointers, which keeps the always-loaded context
small.
**Enforced by:** the skill calls the generator — recipe and code can't drift.

### 19. Permissions allowlist expansion
`.claude/settings.json` already allowlists the gates; add `bun run dev`,
`bun test <path>`, `bun run scaffold:slice:*` so agents never stall on
permission prompts for sanctioned commands.
**Enforced by:** `permissions.allow` in checked-in settings.

### 20. Golden-task agent evals
An `evals/` directory with 2–3 headless tasks ("add a `metrics` slice", "add a
typed 404 to health") run via `claude -p` on a schedule, scored by the gates
themselves. Measures whether the template actually steers agents to the
canonical shape — regression-tests the *harness*, not just the code.
**Enforced by:** scheduled CI job; gates are the judge.

### 21. Devcontainer for hermetic agent sandboxes
A `devcontainer.json` (Bun pinned, Playwright deps preinstalled) gives cloud
agents and CI identical environments — kills "works locally" drift.
**Enforced by:** the container image is the environment.

---

## Suggested order

1 → 2 → 5 → 4 → 3 (feedback loop + purity gaps first; all are <1 day each),
then 14 + 7 (cheap CI hardening), then Tier 3 contracts, then the rest as the
template grows real consumers.
