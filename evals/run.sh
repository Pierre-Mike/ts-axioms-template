#!/usr/bin/env bash
# Golden-task agent evals: regression-test the HARNESS, not just the code.
#
# Each task in tasks.jsonl is handed to a headless agent (claude -p) in a
# throwaway git worktree; the repo's own gates (`bun run verify`) are the
# judge. If the template's docs/scaffolder/lint rules steer the agent to a
# green build, the task passes. Run weekly in CI (.github/workflows/evals.yml)
# or locally: ANTHROPIC_API_KEY=... ./evals/run.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0
failed_ids=()

while IFS= read -r task; do
  [ -z "$task" ] && continue
  id="$(jq -r .id <<<"$task")"
  prompt="$(jq -r .prompt <<<"$task")"
  wt="$root/.evals-wt-$id"

  echo "=== eval: $id ==="
  git -C "$root" worktree add --detach "$wt" HEAD >/dev/null

  if (
    cd "$wt"
    bun install --frozen-lockfile >/dev/null
    # Major-pinned: an unpinned bunx pulls whatever shipped that morning,
    # making week-over-week eval scores incomparable.
    bunx @anthropic-ai/claude-code@2 -p "$prompt" --permission-mode acceptEdits --max-turns 50 || true
    bun run verify
  ); then
    echo "PASS $id"
    pass=$((pass + 1))
  else
    echo "FAIL $id"
    fail=$((fail + 1))
    failed_ids+=("$id")
  fi

  git -C "$root" worktree remove --force "$wt" || true
done <"$root/evals/tasks.jsonl"

echo
echo "evals: $pass passed, $fail failed ${failed_ids[*]:-}"
[ "$fail" -eq 0 ]
