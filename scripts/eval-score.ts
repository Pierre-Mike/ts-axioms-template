#!/usr/bin/env bun
/**
 * Harness-eval scorer + ratchet.
 *
 * `evals/run.sh` attempts each golden task N times and writes a results
 * array (`{id, attempts, passes}`) to `evals/results.json`. This turns that
 * raw pass/fail into a SCORE — a per-task pass-rate and a cross-task mean —
 * and gates it against a committed floor (`evals/floor.json`).
 *
 * Why a score and not a boolean: agent runs are non-deterministic. A single
 * green `bun run verify` hides flakiness; N attempts make "the template
 * reliably steers the agent" a number that can be tracked and RATCHETED. A
 * change to `.claude/` that raises the mean is kept and the floor is bumped;
 * a sustained drop below `floor - margin` (the noise tolerance) means the
 * harness regressed — revert.
 *
 * The aggregation (`scoreRuns`) is pure and unit-tested in eval-score.test.ts;
 * the I/O (read files, exit code) lives in `main` at the bottom — the same
 * impureim split the server axioms enforce, applied to tooling.
 */

export interface TaskResult {
  readonly id: string
  readonly attempts: number
  readonly passes: number
}

export interface Floor {
  /** Minimum acceptable cross-task mean pass-rate, 0..1. Ratchet up over time. */
  readonly floor: number
  /** Noise tolerance subtracted from the floor before failing, 0..1. */
  readonly margin: number
}

export interface PerTaskScore {
  readonly id: string
  readonly rate: number
}

export interface Score {
  readonly perTask: readonly PerTaskScore[]
  readonly mean: number
  readonly floor: number
  readonly margin: number
  readonly threshold: number
  readonly pass: boolean
}

const clampRate = (opts: { passes: number; attempts: number }): number => {
  const { passes, attempts } = opts
  if (attempts <= 0) return 0
  const r = passes / attempts
  return r < 0 ? 0 : r > 1 ? 1 : r
}

/** Pure: raw per-task results + floor -> scored verdict. No I/O. */
export const scoreRuns = (opts: { results: readonly TaskResult[]; floor: Floor }): Score => {
  const { results, floor } = opts
  const perTask: PerTaskScore[] = results.map((r) => ({
    id: r.id,
    rate: clampRate({ passes: r.passes, attempts: r.attempts }),
  }))
  let total = 0
  for (const t of perTask) total += t.rate
  const mean = perTask.length === 0 ? 0 : total / perTask.length
  const threshold = Math.max(0, floor.floor - floor.margin)
  return {
    perTask,
    mean,
    floor: floor.floor,
    margin: floor.margin,
    threshold,
    // An empty result set never "passes" — nothing was proven.
    pass: perTask.length > 0 && mean >= threshold,
  }
}

/** Human-readable one-block report. Pure. */
export const formatScore = (score: Score): string => {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`
  const lines = score.perTask.map(
    (t) => `  ${t.rate >= 1 ? "✓" : t.rate > 0 ? "~" : "✗"} ${t.id}  ${pct(t.rate)}`,
  )
  return [
    "harness eval score",
    ...lines,
    `  mean ${pct(score.mean)} | floor ${pct(score.floor)} (−${pct(score.margin)} noise → ${pct(score.threshold)})`,
    score.pass ? "PASS — at or above floor" : "FAIL — below floor; harness may have regressed",
  ].join("\n")
}

// ---- impure shell ----------------------------------------------------------
if (import.meta.main) {
  const { readFileSync } = await import("node:fs")
  const resultsPath = process.argv[2] ?? "evals/results.json"
  const floorPath = process.argv[3] ?? "evals/floor.json"

  const results = JSON.parse(readFileSync(resultsPath, "utf8")) as TaskResult[]
  const floor = JSON.parse(readFileSync(floorPath, "utf8")) as Floor

  const score = scoreRuns({ results, floor })
  console.error(formatScore(score))
  process.exit(score.pass ? 0 : 1)
}
