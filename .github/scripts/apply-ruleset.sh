#!/usr/bin/env bash
#
# Idempotently apply .github/rulesets/main.json to the current repository's
# branch rulesets via the GitHub API. Run once after creating a repo from the
# template, and again whenever you edit the ruleset — the built-in
# GITHUB_TOKEN cannot do this (admin-only operation).
# Requires `gh auth login` (or GH_TOKEN) with admin on the repo.
#
# Usage:  ./.github/scripts/apply-ruleset.sh [owner/repo]
# If owner/repo is omitted, the current `gh repo` is used.
set -euo pipefail

ruleset_file="$(dirname "$0")/../rulesets/main.json"
repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
name="$(jq -r .name "$ruleset_file")"

echo "Applying ruleset '$name' to $repo ..."

# A ruleset with this name may already exist — update it (PUT) rather than
# creating a duplicate (POST). Look it up by name first.
existing_id="$(gh api "repos/$repo/rulesets" --jq \
  ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)"

if [ -n "$existing_id" ]; then
  echo "Updating existing ruleset id=$existing_id"
  gh api --method PUT "repos/$repo/rulesets/$existing_id" \
    --input "$ruleset_file"
else
  echo "Creating ruleset"
  gh api --method POST "repos/$repo/rulesets" \
    --input "$ruleset_file"
fi

# Merge hygiene: head branches must die on merge. Without this, squash-merge
# leaves the merged branch "ahead" of main, and automated ship loops re-PR it —
# a descendant repo accumulated 22/59 (~37%) empty re-merge PRs this way.
echo "Enabling delete_branch_on_merge on $repo ..."
gh api --method PATCH "repos/$repo" -F delete_branch_on_merge=true >/dev/null

echo "Done."
