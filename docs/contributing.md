# Contributing

Trunk-based flow. `main` is protected (see [governance.md](./governance.md)).

## Workflow

1. **Branch** off `main`: `git switch -c feat/<slice>`.
2. **Build** the slice (see "How to add a feature slice" in `CLAUDE.md`).
3. **Local gates** — all must pass before you push:
   ```bash
   bun run lint:ci     # biome ci .
   bun run typecheck   # tsc -b
   bun test            # co-located unit tests
   bun run audit       # fallow audit
   ```
   The Lefthook `pre-commit` hook auto-formats staged files with Biome and
   re-stages them; `pre-push` runs `fallow audit` + `tsc -b`.
4. **Open a PR** into `main`. Fill in the PR template checklist.
5. **Green CI** — the `lint` / `typecheck` / `test` / `audit` checks must pass.
6. **Squash-merge** — linear history is required; squash on merge.

## PR checklist (enforced by template)

- Axioms followed — pure core, Effect at the boundary only, named params for
  3+ args, no raw `fetch`/`axios`.
- Tests co-located (`*.test.ts` next to source, never `__tests__/`).
- `fallow audit` clean (no dead code, duplication, or circular deps).

## Bypassing hooks (escape hatch)

- Skip all hooks: `LEFTHOOK=0 git ...` or `git ... --no-verify`.
- Use sparingly; CI re-runs the same gates and will block the merge anyway.
