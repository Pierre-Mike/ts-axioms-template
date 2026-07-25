# Agent evals

Deterministic tooling can only prove the code is well-formed. These evals
measure the other half: **does this template actually steer a coding agent to
build working software the canonical way — and how small a model can it carry?**

Each cell is one `(task × model × repeat)`: a throwaway git worktree, a
headless `claude -p` attempt, then two independent juries.

| jury | what it proves | weight |
| --- | --- | --- |
| **gates** — `lint:ci`, `typecheck`, `test`, `audit` | the agent did not break the repo, and stayed inside the axioms | 1 each |
| **asserts** — per task, mostly real HTTP through `evals/probe.ts` | the feature the task asked for actually exists and runs | 2 each |

Gates alone cannot be the judge, because **`bun run verify` is green on an
untouched checkout** — a gates-only eval scores a do-nothing agent 100%. Prove
it yourself, for free:

```bash
bun run evals:baseline        # runs the whole grid with NO agent
bun run evals:report evals/results/<runId>.json
```

Any task the baseline scores ≥ 0.75 on is flagged as measuring nothing.

## Running

```bash
bun run evals -- --suite smoke --models sonnet            # 3 tasks, cheap
bun run evals -- --suite core  --models sonnet,haiku      # 7 tasks, 2 models
bun run evals -- --suite full  --models opus,sonnet,haiku --repeats 3
bun run evals -- --tasks sse-stream,cross-module-door --models haiku --repeats 5
bun run evals:report evals/results/<runId>.json
bun run evals:report -- --compare evals/results/<before>.json evals/results/<after>.json
```

Useful flags: `--repeats N` (a stochastic agent needs samples), `--concurrency
N`, `--max-turns N`, `--timeout-ms N`, `--ref <git-ref>`, `--dirty` (score
uncommitted harness work), `--keep-worktrees` (post-mortem a failure),
`--permission-mode`, `--label "what changed"`, `--fail-on-red`.

Two deliberate choices in the runner:

- **`--setting-sources project`** — the agent sees only the template's
  `.claude/` and `CLAUDE.md`, never the operator's personal skills. Otherwise
  the score measures your laptop, not the template.
- **`--permission-mode bypassPermissions`** (default) — the target is a
  disposable worktree in `$TMPDIR`, and permission friction would otherwise be
  scored as model incapability. Override it if you want to measure the
  allowlist itself.

## The two questions this answers

**"Can this template express any kind of application?"** The task set spans
twelve archetypes on purpose — pure algorithm, CRUD + state machine, external
HTTP integration, shared contract, cross-cutting middleware, web UI with
loader/query, modular-monolith door, non-request background work, streaming
SSE, infrastructure adapter, error taxonomy, and a rename-survival stress
test. A structure that only fits request/response CRUD shows up as a column of
zeros on `sse-stream`, `background-job` and `cross-module-door` — which is a
finding about the *architecture*, not about the model.

**"How cheap a model can I run?"** The report ranks models by mean score and
by **cost per point**, so a model that is 10× cheaper but fails half the grid
stops looking cheap. Strong determinism should let a smaller model succeed;
the grid tells you exactly which archetypes it stops being able to carry.

## Adding a task

One JSON object per line in `tasks.jsonl`:

```json
{
  "id": "kebab-id",
  "archetype": "what shape of app this exercises",
  "difficulty": "easy | medium | hard",
  "suites": ["core", "full"],
  "prompt": "... Finish by running `bun run verify` and fixing any failures.",
  "asserts": [{ "name": "human-readable claim", "run": "shell command, exit 0 = pass" }]
}
```

Rules that keep the grid honest:

1. **Every task needs at least one assert** (`bun run doctor` enforces this) —
   otherwise the task is free points.
2. **Prefer a functional assert over a grep.** `evals/probe.ts` boots the real
   server on a free port and drives real HTTP:
   ```bash
   bun evals/probe.ts --path '/pricing/quote?units=250' --expect-status 200 | jq -e '.totalCents == 2200'
   bun evals/probe.ts --steps '[{"method":"POST","path":"/tickets","body":{"title":"a"},"expectStatus":201},
                                {"method":"PATCH","path":"/tickets/{{0.id}}","body":{"status":"closed"},"expectStatus":409}]'
   ```
   It supports `--env K=V`, `--header`, `--wait-ms` (background work),
   `--read-ms` + `--expect-match-count` (streams), and `{{0.field}}`
   interpolation from an earlier step.
3. **Pin exact expected values in the prompt** (a price, a status code, a tag
   name) so the assert can be exact instead of fuzzy.
4. **End the prompt with** "run `bun run verify` and fix any failures" so the
   gates stay part of the judgement.

## Interpreting a run

`evals/report.ts` prints a model table, a task × model matrix, and the list of
checks that failed. For harness changes, use `--compare`: the verdict is
`improved` / `regressed` / `noise` against a **2σ noise floor** computed from
the repeats (with fewer than two repeats per side it demands a blunt ±0.1 gap
instead of trusting one sample). Score up → keep the change and ratchet the
floor. Sustained drop → revert. Inside the noise → you learned nothing yet;
add repeats.

The scoring maths (`evals/score.core.ts`) and the probe's judgements
(`evals/probe.core.ts`) are pure and unit-tested — the harness that judges the
agent is itself judged by the repo's own gates.

CI runs the grid weekly (`.github/workflows/evals.yml`) and no-ops when
`ANTHROPIC_API_KEY` is absent.
