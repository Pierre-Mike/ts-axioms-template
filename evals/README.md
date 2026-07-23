# Agent evals

Golden tasks that measure whether this template actually steers a coding
agent to the canonical shape. Each task in `tasks.jsonl` runs headless
(`claude -p`, pinned CLI version + model — see `run.sh`) in a throwaway git
worktree.

A task passes only when **all three** hold:

1. **The agent touched the tree.** `git status --porcelain` is non-empty
   after the agent runs. An agent that edits nothing does not pass — it
   would otherwise inherit a HEAD that is green by definition.
2. **`bun run verify` is green** in that worktree.
3. **The task's own `assert` check exits 0.** Each task carries a small,
   deterministic bash snippet — grep/find over the files the prompt actually
   asked for (e.g. does `api.ts` mount `/metrics`, does the response include
   `ok: true`, does `STATUS_BY_TAG` map the new tag to 404) — run after
   `verify` passes.

`bun run verify` alone is **not** the judge: it's green on an untouched
worktree, so a do-nothing agent would score 100% without condition 1 and 3.
Those two are what make the loop discriminating.

```bash
ANTHROPIC_API_KEY=... ./evals/run.sh
```

## Reproducibility

The two knobs that determine what actually gets measured — the agent CLI
version and the model id — are pinned at the top of `run.sh`
(`CLAUDE_CODE_VERSION`, `CLAUDE_MODEL`). Bump either only as a deliberate,
commented act: a score change across a bump reflects a different agent, not
a harness change, and invalidates a before/after comparison.

## Baseline (the ratchet floor)

`run.sh` writes a per-task breakdown to `evals/results/latest.json` and
compares the total `pass` count against `evals/baseline.json`'s `minPass`. A
run scoring below the floor fails. `minPass` starts at `0` — no honest run
(real judge + real per-task asserts) has executed against this task set yet.
Once CI reports a genuine pass count, raise `minPass` to it in the same PR;
never lower it without a commit message explaining why.

## CI

`.github/workflows/evals.yml` runs on the weekly schedule, on manual
dispatch, and on pull requests that touch `.claude/**`, `CLAUDE.md`,
`AGENTS.md`, or `evals/**` — so a harness change is evaluated before merge,
not just discovered a week later. It is **not** a required check (it invokes
a live model and can be slow/flaky by nature).

Fork PRs cannot see the `ANTHROPIC_API_KEY` secret. When it's absent, the
job **skips** the eval run and writes a plainly-labeled step summary
("evals skipped: no API key") instead of silently reporting green — a skip
is not a pass. It uploads `evals/results/latest.json` as a workflow artifact
whenever the eval run actually executes, even on a baseline regression, so
the per-task breakdown is inspectable without re-running.

## Adding a task

One JSON object per line in `tasks.jsonl`: `{"id", "prompt", "assert"}`.

- End every `prompt` with "Finish by running `bun run verify` and fixing any
  failures." so the build gates stay part of the judge.
- `assert` is a bash snippet, run via `bash -c "$assert"` with the task
  worktree as the cwd, after `verify` passes. Keep it cheap and
  deterministic — file existence, `grep`/`find` over the changed files — no
  live server, no network. A non-zero exit fails the task.

When a doc/lint/scaffolder change makes agents start failing these tasks,
the harness regressed — fix the template, not the task.
