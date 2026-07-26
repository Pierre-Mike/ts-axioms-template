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

## Reference run (the floor to ratchet)

Full grid, one repeat per cell, 2026-07-25, 36 cells, $46.60:

| model | fully green | mean score | $/task | $/point | min/task |
| --- | --- | --- | --- | --- | --- |
| opus | 75% | 0.966 | $2.36 | $2.45 | 6.1 |
| haiku | 67% | 0.945 | $0.30 | $0.31 | 2.3 |
| sonnet | 75% | 0.937 | $1.22 | $1.31 | 4.0 |

Every archetype reached green on at least one model, and eight of twelve on
all three — streaming, background work, the cross-module door, the infra
adapter and a whole-app rename included. The cheap tier's one substantive
miss was `background-job` (the endpoint's counter never advanced, though the
code looked right — exactly the failure a grep-based assert would have
scored green).

### Cheap-tier reliability (haiku, `core` suite, 3 repeats — 21 cells, $5.20)

mean **0.960**, 81% fully green, **$0.25/task**, σ 0.103.

| archetype | haiku pass rate |
| --- | --- |
| error taxonomy · contract · pure algorithm · web loader/query | 3/3 |
| persistence + state machine | 2/3 |
| cross-cutting middleware | 2/3 |
| external integration (upstream failure → typed 502) | 1/3 |

Read that as a routing policy, not a verdict: the cheap tier is dependable on
the shapes the scaffolder already stamps out, and flaky exactly where a task
needs multi-step *runtime* behaviour to be right. One sample would have called
`external-http` a pass.

The flakiness is the task's, not one model's: `crud-state-machine` failed for
sonnet in the grid and passed on a re-run of the same cell (1/2), while haiku
went 2/3. Before reading a single red cell as "this model cannot do X", re-run
it — `--tasks <id> --models <m> --repeats 3 --keep-worktrees` keeps the
worktrees so the failure can be opened up.

**Noise floor for this suite:** σ 0.103 over 21 cells → SE 0.023, so a 3-repeat
A/B needs to move the mean by **≳0.06** to clear 2σ. Anything smaller is dice.
Beat the table above before claiming a harness change helped, and always
re-run with `--repeats 3` before trusting a delta.

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
