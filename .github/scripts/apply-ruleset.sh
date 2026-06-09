#!/usr/bin/env bash
#
# Idempotently apply .github/rulesets/main.json to the current repository's
# branch rulesets via the GitHub API. Manual fallback for the self-applying
# bootstrap workflow (run it locally if bootstrap is skipped or you edit the
# ruleset). Requires `gh auth login` (or GH_TOKEN) with admin on the repo.
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

echo "Done."
