# Agent evals

Golden tasks that measure whether this template actually steers a coding agent
to the canonical shape. Each task in `tasks.jsonl` runs headless
(`claude -p`) in a throwaway git worktree; **the repo's own gates are the
judge** — an attempt passes iff `bun run verify` is green afterwards.

```bash
ANTHROPIC_API_KEY=... ./evals/run.sh            # 1 attempt/task
ANTHROPIC_API_KEY=... ATTEMPTS=3 ./evals/run.sh # 3 attempts/task -> a real pass-rate
```

CI runs them weekly (`.github/workflows/evals.yml`); the job no-ops when the
`ANTHROPIC_API_KEY` secret is absent.

## Score, not pass/fail

Agent runs are non-deterministic, so a single green `verify` hides flakiness.
Each task is attempted `ATTEMPTS` times; `run.sh` writes raw results to
`evals/results.json`:

```json
[{ "id": "metrics-slice", "attempts": 3, "passes": 3 }]
```

`scripts/eval-score.ts` turns that into a **score** — a per-task pass-rate and
a cross-task mean — and gates it against the committed floor
(`evals/floor.json`). The aggregation is pure and unit-tested
(`scripts/eval-score.test.ts`); only the file I/O + exit code is impure.

```jsonc
// evals/floor.json
{ "floor": 0.0, "margin": 0.1 } // pass iff mean >= floor - margin (margin = noise tolerance)
```

## The ratchet (how the template improves over time)

The floor only ever climbs. The loop:

1. **Diagnose** — run `/retro` (`.claude/skills/retro`). It mines
   `.claude/traces/`, git history, and merged PRs into a few ranked,
   enforcement-biased proposals (prefer a hook/lint/test/script over a
   guideline).
2. **Apply** one proposal — a change to `.claude/` (CLAUDE.md, a skill, a hook,
   a lint rule, the scaffolder).
3. **Re-run** `./evals/run.sh` (ideally `ATTEMPTS=3+`).
4. **Decide** — mean rose beyond the noise margin → keep the change and bump
   `floor` in `evals/floor.json`. Sustained drop below `floor - margin` → the
   harness regressed; **fix the template, not the task** (or revert the change).

Judge over several runs against the noise floor, not a single number — a
1-point wiggle is noise, a sustained move is signal.

## Add a task

One JSON object per line — `{"id": "...", "prompt": "..."}`. End every prompt
with "run `bun run verify` and fix any failures" so the gates stay the judge.
Tasks are **frozen**: never edit a task to chase a score — that makes the
scoreboard lie.
