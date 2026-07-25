#!/usr/bin/env bash
# Golden-task agent evals: regression-test the HARNESS, not just the code.
#
# Each task in tasks.jsonl is handed to a headless agent (claude -p) in a
# throwaway git worktree. A task passes ONLY when all three hold:
#   1. the agent actually touched the tree (`git status --porcelain` is
#      non-empty) — an agent that edits nothing must not pass by silently
#      inheriting a HEAD that is green by definition.
#   2. `bun run verify` is green in that worktree.
#   3. the task's own `assert` snippet (a small, deterministic bash check
#      specific to that task — file/string evidence the actual requested
#      change landed) exits 0.
# `bun run verify` alone is NOT the judge: it is green on an untouched
# worktree, so a do-nothing agent must not be able to pass. Condition 1 and
# the per-task `assert` are what make the loop discriminating.
#
# Reproducibility knobs (the only two ways this loop's inputs vary run to
# run): the agent CLI version and the model id. Both are pinned below.
# Bump either ONLY as a deliberate act, in its own commit, with a note that
# week-over-week score comparisons across the bump are not meaningful —
# you are now measuring a different agent, not a harness change.
CLAUDE_CODE_VERSION="2.1.206" # @anthropic-ai/claude-code, npm "stable" tag as of 2026-07-23
CLAUDE_MODEL="claude-sonnet-5" # pinned model id — never float to an alias like "sonnet"
#
# Run on every PR touching the harness + weekly (.github/workflows/evals.yml),
# or locally: ANTHROPIC_API_KEY=... ./evals/run.sh
set -euo pipefail

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY is required to run agent evals (see evals/README.md)." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
results_file="$root/evals/results/latest.json"
baseline_file="$root/evals/baseline.json"
mkdir -p "$(dirname "$results_file")"

pass=0
fail=0
failed_ids=()
task_results="[]"

while IFS= read -r task; do
  [ -z "$task" ] && continue
  id="$(jq -r .id <<<"$task")"
  prompt="$(jq -r .prompt <<<"$task")"
  assert="$(jq -r .assert <<<"$task")"
  wt="$root/.evals-wt-$id"

  echo "=== eval: $id ==="
  git -C "$root" worktree add --detach "$wt" HEAD >/dev/null

  diff_nonempty=false
  verify_pass=false
  assert_pass=false
  reason=""

  (
    cd "$wt"
    bun install --frozen-lockfile >/dev/null
    # Tolerant: an agent crash/timeout must not abort the whole run — it is
    # simply evidence for this task's own pass/fail below, not a script error.
    bunx "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" -p "$prompt" \
      --model "$CLAUDE_MODEL" --permission-mode acceptEdits --max-budget-usd 3 \
      >"$wt/.agent.log" 2>&1 || true
  )

  if [ -n "$(git -C "$wt" status --porcelain)" ]; then
    diff_nonempty=true
  else
    reason="agent made no changes to the worktree"
    echo "--- agent transcript ($id) ---" >&2
    cat "$wt/.agent.log" >&2 || true
  fi

  if [ "$diff_nonempty" = true ]; then
    if (cd "$wt" && bun run verify) >"$wt/.verify.log" 2>&1; then
      verify_pass=true
    else
      reason="bun run verify failed"
      echo "--- verify log ($id) ---" >&2
      cat "$wt/.verify.log" >&2 || true
    fi
  fi

  if [ "$verify_pass" = true ]; then
    if (cd "$wt" && bash -c "$assert") >"$wt/.assert.log" 2>&1; then
      assert_pass=true
    else
      reason="task assertion failed (verify passed, but the requested change wasn't found)"
      echo "--- assert log ($id) ---" >&2
      cat "$wt/.assert.log" >&2 || true
    fi
  fi

  if [ "$diff_nonempty" = true ] && [ "$verify_pass" = true ] && [ "$assert_pass" = true ]; then
    echo "PASS $id"
    pass=$((pass + 1))
    task_results="$(jq --arg id "$id" '. + [{id: $id, pass: true}]' <<<"$task_results")"
  else
    echo "FAIL $id ($reason)"
    fail=$((fail + 1))
    failed_ids+=("$id")
    task_results="$(jq --arg id "$id" --arg reason "$reason" \
      '. + [{id: $id, pass: false, reason: $reason}]' <<<"$task_results")"
  fi

  git -C "$root" worktree remove --force "$wt" || true
done <"$root/evals/tasks.jsonl"

jq -n --argjson pass "$pass" --argjson fail "$fail" \
  --arg cliVersion "$CLAUDE_CODE_VERSION" --arg model "$CLAUDE_MODEL" \
  --argjson tasks "$task_results" \
  '{pass: $pass, fail: $fail, cliVersion: $cliVersion, model: $model, tasks: $tasks}' \
  >"$results_file"

echo
echo "evals: $pass passed, $fail failed ${failed_ids[*]:-}"
echo "results written to $results_file"

# Baseline floor (the ratchet the canon axiom refers to): a committed integer
# lower bound on `pass`. A run scoring below it is a harness regression and
# fails CI. Raise the floor deliberately, in the same PR that earns the
# higher score; never lower it without recording why in the commit message.
min_pass="$(jq -r .minPass "$baseline_file")"
if [ "$pass" -lt "$min_pass" ]; then
  echo "REGRESSION: pass count $pass is below the baseline floor $min_pass (see evals/baseline.json)" >&2
  exit 1
fi

exit 0
