# Governance-as-code

Branch protection lives in the repo as a **GitHub repository ruleset**:
`.github/rulesets/main.json`. It is version-controlled, reviewable, and applied
either automatically (bootstrap workflow) or manually (script).

## What `main.json` enforces

Targeting `refs/heads/main`, trunk-based:

- **Pull request required** — `required_approving_review_count: 1`, stale
  reviews dismissed on push.
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

### Automatic — bootstrap workflow

`.github/workflows/bootstrap.yml` runs on push to `main`. On the first push it
applies `main.json` via the GitHub API using the built-in `GITHUB_TOKEN`
(`permissions: administration: write`), then self-guards: subsequent pushes find
the ruleset already present and exit immediately.

### Manual — apply-ruleset.sh

If Actions lacks the permission (common under org policy) or you edit the
ruleset, apply it locally:

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
3. Re-apply: `./.github/scripts/apply-ruleset.sh` (or push to trigger bootstrap
   on a repo where the ruleset was deleted).
4. Commit the JSON change through a PR like any other code.

## Org-level bypass

On an organization repo, members with **admin** (or an org owner) can bypass a
ruleset, and org-level rulesets can override repo-level ones. If you need a
hard floor that maintainers can't bypass, define the ruleset at the org level
with an empty bypass list — that requires org-admin rights and is out of scope
for this template, which ships a repo-level ruleset.
