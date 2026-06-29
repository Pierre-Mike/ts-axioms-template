#!/usr/bin/env bash
# Golden-task agent evals: regression-test the HARNESS, not just the code.
#
# Each task in tasks.jsonl is handed to a headless agent (claude -p) in a
# throwaway git worktree; the repo's own gates (`bun run verify`) are the
# judge. If the template's docs/scaffolder/lint rules steer the agent to a
# green build, the task passes. Run weekly in CI (.github/workflows/evals.yml)
# or locally: ANTHROPIC_API_KEY=... ./evals/run.sh
#
# Non-determinism is real, so each task is attempted ATTEMPTS times (default
# 1; set higher for a meaningful pass-rate). Raw results are written to
# evals/results.json and turned into a SCORE + ratchet verdict by
# scripts/eval-score.ts against the committed floor (evals/floor.json):
#
#   ANTHROPIC_API_KEY=... ATTEMPTS=3 ./evals/run.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
attempts="${ATTEMPTS:-1}"
results="$root/evals/results.json"
tmp="$(mktemp)"
echo "[]" >"$tmp"

while IFS= read -r task; do
  [ -z "$task" ] && continue
  id="$(jq -r .id <<<"$task")"
  prompt="$(jq -r .prompt <<<"$task")"

  passes=0
  for attempt in $(seq 1 "$attempts"); do
    wt="$root/.evals-wt-$id-$attempt"
    echo "=== eval: $id (attempt $attempt/$attempts) ==="
    git -C "$root" worktree add --detach "$wt" HEAD >/dev/null

    if (
      cd "$wt"
      bun install --frozen-lockfile >/dev/null
      bunx @anthropic-ai/claude-code -p "$prompt" --permission-mode acceptEdits --max-turns 50 || true
      bun run verify
    ); then
      echo "PASS $id (attempt $attempt)"
      passes=$((passes + 1))
    else
      echo "FAIL $id (attempt $attempt)"
    fi

    git -C "$root" worktree remove --force "$wt" || true
  done

  # Append {id, attempts, passes} to the results array.
  jq --arg id "$id" --argjson a "$attempts" --argjson p "$passes" \
    '. += [{id: $id, attempts: $a, passes: $p}]' "$tmp" >"$tmp.next"
  mv "$tmp.next" "$tmp"
done <"$root/evals/tasks.jsonl"

mv "$tmp" "$results"
echo
echo "raw results -> $results"

# Score + ratchet: exit non-zero if the cross-task mean fell below the floor.
bun run "$root/scripts/eval-score.ts" "$results" "$root/evals/floor.json"
