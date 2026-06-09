# Getting started

## 1. Create your repo

- **GitHub template:** click **Use this template** → **Create a new
  repository**. (This repo is marked as a template.)
- **Or degit** (no git history):
  ```bash
  bunx degit Pierre-Mike/ts-axioms-template my-service
  cd my-service && git init
  ```

## 2. Install

```bash
bun install
```

This installs dependencies and wires the git hooks (`prepare` → `lefthook
install`).

## 3. One-time repo settings

```bash
# Branch protection (needs gh + repo admin; GITHUB_TOKEN cannot manage rulesets):
./.github/scripts/apply-ruleset.sh

# Let release-please open its release PR ("Allow GitHub Actions to create and
# approve pull requests" — off by default on new repos):
gh api -X PUT "repos/{owner}/{repo}/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
```

See [governance.md](./governance.md).

## 4. Run it

```bash
bun run dev          # server :8787 + web :5173
curl localhost:8787/health
```

## 5. Add your first feature slice

```bash
bun run scaffold:slice <feature>
```

Then follow the recipe in `CLAUDE.md` / `AGENTS.md`: implement the pure core
(+ co-located test), replace the stub I/O in `.repo.ts`, map error tags in
`platform/http.ts`. Add the web query + route if you have a UI.

## 6. End-to-end tests (optional)

Playwright needs its browsers installed once (NOT done by `bun install` or CI
bootstrap):

```bash
bunx playwright install
bun run test:e2e
```

## 7. Backend-only?

If you don't want the web UI or e2e tier:

```bash
bun run scaffold:clean   # removes apps/web + apps/e2e, prunes refs, reinstalls
```

The server slice, tooling plane, and CI keep working.
