---
name: retro
description: >
  Retrospective look-back over recent agent and engineering work. Scans whatever signal the repo
  has — `.claude/traces/`, git history, merged PRs — to surface patterns (retry-heavy tasks, hot
  files, repeated failures, slow time-to-green, abandoned branches) and turn them into concrete,
  ranked improvement proposals. Use when the user invokes `/retro` or `/retro --since 7d`, or asks
  for a retrospective / post-mortem / look-back over recent work to find what to fix next.
  Project-agnostic: every data source is optional and the skill degrades to whatever exists.
---

## Core Principle

Retrospective closes the loop. Signal only matters when it produces action. `/retro` converts aggregated history into a small set of ranked, concrete proposals — never a vague report. Bias every proposal toward a **deterministic enforcement** (a hook, lint rule, test, or script) over a soft guideline, because enforcements compound and guidelines decay.

## Preconditions

- Run from a repo root with a git history.
- At least one source of signal exists (see Step 2). If none do, say so and exit — never invent findings.

## Workflow

### Step 1 — Define the window

Default: last 7 days. Respect `--since <duration>` if provided (`7d`, `30d`, or an ISO date like `2026-04-01`). Compute the window start once and reuse it for every source.

### Step 2 — Detect available sources

Probe each; use only what exists. Never fail because a source is absent.

| Source | Probe | What to extract |
|---|---|---|
| Agent traces | `.claude/traces/*.jsonl` in window | events/session, tool failures, hook blocks (exit 2), retries, most-touched files, sessions with >3× median retries |
| Git history | `git log --since=<window-start>` | commit volume, churn-heavy files (`git log --since=<window-start> --name-only --pretty=format: \| sort \| uniq -c \| sort -rn \| head`), revert/`fixup` commits, large diffs |
| Merged PRs | `gh pr list --state merged --search "merged:>=<window-start>"` (skip if `gh` absent/unauthed) | CI duration, re-run count, time open, review round-trips |
| Open branches | `git branch -a --sort=-committerdate` | branches with no commit in window — candidates for abandonment |
| Project task/spec system | only if one is detected (e.g. `specs/`, `TODO`, issue tracker) | in-flight items stale beyond the window |

State which sources were found at the top of the report.

### Step 3 — Aggregate findings

Each finding must have:
- **Signal** — what the data shows, citing specific trace files, commit SHAs, PR numbers, or file paths.
- **Hypothesis** — why it might be happening.
- **Proposed action** — one concrete change.
- **Enforcement type** — `hook`, `lint-rule`, `test`, `script`, `doc`, or `process`. Prefer the first four.

Floor: 1 finding. Ceiling: 5. If nothing surfaces, say so plainly and exit.

### Step 4 — Rank and select

Rank by leverage: how much future pain does each prevent? Bias toward deterministic enforcements (`hook` / `lint-rule` / `test` / `script`) — those compound. Mark the top finding.

### Step 5 — Emit the report

Write a single markdown report. Default path: `.claude/retro/<date>-retro.md` (create the dir if needed). If the user named an output path, honor it. The report contains **all** findings, the selected top one flagged, and a short "Deferred" list for the rest.

### Step 6 — Offer to act

Present the top finding and offer to implement its enforcement now. If the repo has a spec/workflow system (e.g. a `/do` command or an issue tracker), offer to file it there instead. Do not silently spawn follow-on work — propose, then act on confirmation.

### Step 7 — Print summary

```
/retro complete (window: <window>)

sources: <which were found>
findings: <n>
top: <title> — <enforcement type>
report: <path>
```

## Rules

- **One primary action per retrospective.** If everything is urgent, nothing is.
- **Never hand-wave the signal.** Every finding cites a specific file, SHA, or PR.
- **Degrade gracefully.** A missing source is normal, not an error.
- **Prefer enforcement over advice.** A finding whose action is "be more careful" is incomplete — restate it as a hook/test/lint/script, or drop it.
- **Don't auto-merge anything.** The human closes the loop.

## When NOT to invoke

- Less than ~3 sessions or a near-empty git window — not enough signal.
- Mid-execution of another focused task — finish first.
- No available source in the window — output "no activity, no retrospective" and exit.

## Headless / cron use

Runnable on a schedule (weekly GitHub Action, `/loop`, `/schedule`). When non-interactive:
- Always select the top finding, no prompts.
- Write the report to the default path.
- If a spec/issue system exists, file the top finding tagged `retro`; otherwise leave the report for human review.

## Escalation

If two findings' actions conflict (one would undo another), write the conflict into the report under a `Conflicts` heading and stop — let a human resolve it.

## Naming

`retro` does retrospective — a look-back at past work to propose improvements. Distinct from `review` (PR-review semantics) and `code-review` (current-diff bugs). Retro looks at history; review looks at a change.
