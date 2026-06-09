# Agent evals

Golden tasks that measure whether this template actually steers a coding agent
to the canonical shape. Each task in `tasks.jsonl` runs headless
(`claude -p`) in a throwaway git worktree; **the repo's own gates are the
judge** — a task passes iff `bun run verify` is green afterwards.

```bash
ANTHROPIC_API_KEY=... ./evals/run.sh
```

CI runs them weekly (`.github/workflows/evals.yml`); the job no-ops when the
`ANTHROPIC_API_KEY` secret is absent. When a doc/lint/scaffolder change makes
agents start failing these tasks, the harness regressed — fix the template,
not the task.

Add a task: one JSON object per line — `{"id": "...", "prompt": "..."}`. End
every prompt with "run `bun run verify` and fix any failures" so the gates
stay the judge.
