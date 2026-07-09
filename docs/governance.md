# Governance-as-code

Branch protection lives in the repo as a **GitHub repository ruleset**:
`.github/rulesets/main.json`. It is version-controlled, reviewable, and applied
with an idempotent script.

## What `main.json` enforces

Targeting `refs/heads/main`, trunk-based:

- **Pull request required** — `required_approving_review_count: 0` (a
  solo-owner/no-bypass default: the ruleset has no bypass list, so even the
  repo owner can't push `main` directly — requiring an approval nobody but
  the owner could ever give would lock the repo out of merging its own PRs;
  raise this once the repo has a second reviewer), stale reviews dismissed on
  push.
- **Required status checks** — `lint`, `typecheck`, `test`, `audit` must pass
  before merge. `strict_required_status_checks_policy: true` means the branch
  must also be up to date with `main`.
- **`non_fast_forward`** — blocks force-pushes to `main`.
- **`required_linear_history`** — no merge commits; squash or rebase only.
- **`deletion`** — blocks deleting `main`.

## The required-check naming contract

The `context` values in `required_status_checks` (`lint` / `typecheck` /
`test` / `audit`) MUST equal the **job names** in
`.github/workflows/ci.yml`. GitHub matches required checks by name; a rename on
one side without the other means merges block forever on a check that never
reports. Change both together.

## Applying the ruleset

Managing rulesets is an admin-only operation that the built-in `GITHUB_TOKEN`
can never perform (there is no `administration:` grant in workflow
`permissions:`), so application is a one-time manual step after creating a
repo from the template — and again whenever you edit the ruleset:

```bash
gh auth login                       # need admin on the repo
./.github/scripts/apply-ruleset.sh  # detects current repo
# or target explicitly:
./.github/scripts/apply-ruleset.sh owner/repo
```

The script is idempotent: it looks up the ruleset by name and PUTs an update if
it exists, otherwise POSTs a create.

## Editing a rule

1. Edit `.github/rulesets/main.json`.
2. If you touch `required_status_checks`, update `ci.yml` job names to match.
3. Re-apply: `./.github/scripts/apply-ruleset.sh`.
4. Commit the JSON change through a PR like any other code.

## Merge hygiene: head branches die on merge

`apply-ruleset.sh` also PATCHes the repo setting `delete_branch_on_merge=true`.
This is not cosmetic. With squash-merge (forced by `required_linear_history`),
the merged head branch ends up **ahead** of `main` by its original commits —
GitHub compares by commit, not by diff. Any automated ship loop that asks "does
my branch have commits main doesn't?" answers yes and opens a fresh PR of
already-merged work. A descendant repo audited in 2026-07 accumulated 22 of 59
merged PRs (~37%) as exactly these empty re-merges. Deleting the branch at
merge time removes the trigger structurally.

Agent ship loops should also check `gh pr list --head <branch>` before opening
a PR, so a still-open PR for the branch is reused instead of duplicated.

## Decay resistance: what a fork inherits by construction

The template assumes its descendants will rename apps, add surfaces, and prune
files — and that nobody re-audits enforcement after doing so. Two properties
keep the axioms alive through that churn:

- **Rules attach to file shape, not location.** Biome scoping is keyed to
  suffixes and folder shapes (`**/*.core.ts`, `**/*.io.ts`, `**/features/**`,
  `**/platform/config.ts`) with denials global and allows sanctioned. Renaming
  `apps/server` to anything, or adding a sixth app, changes nothing about what
  is enforced — a rename cannot fail open.
- **The harness checks itself.** `bun run doctor`
  (`scripts/check-harness.ts`, running inside the required `test` check)
  structurally asserts the enforcement stack: Biome overrides + grit plugins
  present, lefthook jobs wired, CI job names cover the ruleset's required
  checks, actions SHA-pinned, every workspace in the `tsc -b` graph, canon
  markers intact, gate scripts composed. The doctor will not stop a determined
  owner from deleting gates — it converts *silent, incremental* decay into a
  *loud, deliberate* diff that fails the most-watched pipeline in the repo.

## Org-level bypass

On an organization repo, members with **admin** (or an org owner) can bypass a
ruleset, and org-level rulesets can override repo-level ones. If you need a
hard floor that maintainers can't bypass, define the ruleset at the org level
with an empty bypass list — that requires org-admin rights and is out of scope
for this template, which ships a repo-level ruleset.
