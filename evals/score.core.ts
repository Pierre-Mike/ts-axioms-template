/**
 * Eval scoring — PURE (data in / data out, no clock, no I/O, no Effect).
 *
 * The runner (evals/run.ts) is the imperative shell: it drives worktrees,
 * spawns agents and shells out to the gates. Everything it then *concludes*
 * from those observations lives here, so the interesting half of the harness
 * is unit-testable without spending a token.
 *
 * Two ideas do the work:
 *
 * 1. **Graded, not binary.** A cell (task × model × repeat) is a bag of
 *    checks: the repo's gates (`lint:ci`/`typecheck`/`test`/`audit`) plus the
 *    task's own asserts. Gates prove the agent did not break the repo;
 *    asserts prove it actually built the thing. Asserts weigh more precisely
 *    because gates are green on an untouched checkout — a task judged on
 *    gates alone passes when the agent does nothing.
 * 2. **A delta is only real if it clears the noise.** Agents are stochastic,
 *    so `verdictOf` compares two samples against the standard error of their
 *    difference (default 2σ) and refuses to call anything at n=1 unless the
 *    gap is large.
 */

export type CheckKind = "gate" | "assert"

export interface CheckResult {
  readonly name: string
  readonly kind: CheckKind
  readonly ok: boolean
  readonly ms: number
}

/** One task × model × repeat, after the agent ran and the gates judged it. */
export interface CellResult {
  readonly taskId: string
  readonly archetype: string
  readonly model: string
  readonly repeat: number
  readonly checks: ReadonlyArray<CheckResult>
  readonly costUsd: number
  readonly durationMs: number
  readonly turns: number
  readonly filesChanged: number
  readonly linesChanged: number
  readonly agentError: string | null
}

/**
 * Asserts outweigh gates 2:1. Gates are a floor (they pass on an untouched
 * repo); asserts are the evidence the task was actually done.
 */
const WEIGHT_BY_KIND: Record<CheckKind, number> = { gate: 1, assert: 2 }

const weightOf = (check: CheckResult): number => WEIGHT_BY_KIND[check.kind]

/** Weighted fraction of checks that passed, in [0, 1]. No checks -> 0. */
export const scoreOf = (checks: ReadonlyArray<CheckResult>): number => {
  const total = checks.reduce((sum, check) => sum + weightOf(check), 0)
  if (total === 0) return 0
  const earned = checks.reduce((sum, check) => sum + (check.ok ? weightOf(check) : 0), 0)
  return earned / total
}

/** A cell "passes" only when every check is green — no partial credit here. */
export const isPass = (checks: ReadonlyArray<CheckResult>): boolean =>
  checks.length > 0 && checks.every((check) => check.ok)

export const mean = (xs: ReadonlyArray<number>): number =>
  xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length

/** Sample standard deviation (n-1). Fewer than two samples -> 0. */
export const stdev = (xs: ReadonlyArray<number>): number => {
  if (xs.length < 2) return 0
  const mu = mean(xs)
  const variance = xs.reduce((sum, x) => sum + (x - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

export interface ModelSummary {
  readonly model: string
  readonly cells: number
  readonly passRate: number
  readonly meanScore: number
  readonly scoreStdev: number
  readonly totalCostUsd: number
  readonly meanCostUsd: number
  readonly meanDurationMs: number
  readonly meanTurns: number
  readonly meanFilesChanged: number
  readonly agentErrors: number
}

const distinct = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)]

const summariseCells = (input: {
  readonly model: string
  readonly cells: ReadonlyArray<CellResult>
}): ModelSummary => {
  const scores = input.cells.map((cell) => scoreOf(cell.checks))
  const costs = input.cells.map((cell) => cell.costUsd)
  return {
    model: input.model,
    cells: input.cells.length,
    passRate: mean(input.cells.map((cell) => (isPass(cell.checks) ? 1 : 0))),
    meanScore: mean(scores),
    scoreStdev: stdev(scores),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    meanDurationMs: mean(input.cells.map((cell) => cell.durationMs)),
    meanTurns: mean(input.cells.map((cell) => cell.turns)),
    meanFilesChanged: mean(input.cells.map((cell) => cell.filesChanged)),
    agentErrors: input.cells.filter((cell) => cell.agentError !== null).length,
  }
}

/** One row per model, ordered as first seen in the results. */
export const summariseByModel = (cells: ReadonlyArray<CellResult>): ReadonlyArray<ModelSummary> =>
  distinct(cells.map((cell) => cell.model)).map((model) =>
    summariseCells({ model, cells: cells.filter((cell) => cell.model === model) }),
  )

export interface TaskModelCell {
  readonly taskId: string
  readonly archetype: string
  readonly model: string
  readonly meanScore: number
  readonly passRate: number
  readonly runs: number
  readonly failedChecks: ReadonlyArray<string>
}

/** The task × model matrix: where exactly a cheaper model starts to break. */
export const summariseByTask = (cells: ReadonlyArray<CellResult>): ReadonlyArray<TaskModelCell> =>
  distinct(cells.map((cell) => cell.taskId)).flatMap((taskId) => {
    const forTask = cells.filter((cell) => cell.taskId === taskId)
    return distinct(forTask.map((cell) => cell.model)).map((model) => {
      const runs = forTask.filter((cell) => cell.model === model)
      const failed = runs.flatMap((run) =>
        run.checks.filter((check) => !check.ok).map((check) => check.name),
      )
      return {
        taskId,
        archetype: runs.reduce((acc, run) => run.archetype ?? acc, ""),
        model,
        meanScore: mean(runs.map((run) => scoreOf(run.checks))),
        passRate: mean(runs.map((run) => (isPass(run.checks) ? 1 : 0))),
        runs: runs.length,
        failedChecks: distinct(failed),
      }
    })
  })

export type VerdictLabel = "improved" | "regressed" | "noise"

export interface Verdict {
  readonly delta: number
  readonly threshold: number
  readonly label: VerdictLabel
}

/**
 * Is `candidate` really better than `base`, or did the dice land differently?
 *
 * Threshold = sigma × the standard error of the difference of means. With
 * fewer than two samples on either side there is no variance estimate at all,
 * so the call falls back to a blunt minimum delta — this is exactly the
 * "judge over several runs against a noise floor, not a single number" rule
 * the canon asks for, made executable.
 */
const standardErrorOfDifference = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
}): number =>
  Math.sqrt(
    stdev(input.base) ** 2 / Math.max(1, input.base.length) +
      stdev(input.candidate) ** 2 / Math.max(1, input.candidate.length),
  )

const labelOf = (input: { readonly delta: number; readonly threshold: number }): VerdictLabel => {
  if (input.delta > input.threshold) return "improved"
  return input.delta < -input.threshold ? "regressed" : "noise"
}

const DEFAULT_SIGMA = 2
/** With n<2 there is no variance to measure, so demand a blunt visible gap. */
const DEFAULT_MIN_DELTA = 0.1

const canEstimateNoise = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
}): boolean => input.base.length > 1 && input.candidate.length > 1

const thresholdOf = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
  readonly sigma?: number
  readonly minDelta?: number
}): number =>
  canEstimateNoise(input)
    ? Math.max((input.sigma ?? DEFAULT_SIGMA) * standardErrorOfDifference(input), 1e-9)
    : (input.minDelta ?? DEFAULT_MIN_DELTA)

export const verdictOf = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
  readonly sigma?: number
  readonly minDelta?: number
}): Verdict => {
  const delta = mean(input.candidate) - mean(input.base)
  const threshold = thresholdOf(input)
  return { delta, threshold, label: labelOf({ delta, threshold }) }
}

export interface TrivialTask {
  readonly taskId: string
  readonly noOpScore: number
}

/**
 * Tasks a do-nothing agent already scores well on — i.e. tasks that measure
 * nothing. Feed this the `--baseline` run (gates + asserts on an untouched
 * worktree, no agent). Any task above the threshold needs sharper asserts.
 */
export const trivialTasks = (input: {
  readonly baseline: ReadonlyArray<CellResult>
  readonly threshold?: number
}): ReadonlyArray<TrivialTask> => {
  const threshold = input.threshold ?? 0.75
  return distinct(input.baseline.map((cell) => cell.taskId))
    .map((taskId) => ({
      taskId,
      noOpScore: mean(
        input.baseline.filter((cell) => cell.taskId === taskId).map((cell) => scoreOf(cell.checks)),
      ),
    }))
    .filter((task) => task.noOpScore >= threshold)
}

/**
 * Cost of one point of score — the number that answers "is the cheap model
 * actually cheaper?". A model that is 10× cheaper but scores 0 is infinitely
 * expensive per point, and this makes that visible.
 */
export const costPerPoint = (summary: ModelSummary): number =>
  summary.meanScore === 0 ? Number.POSITIVE_INFINITY : summary.meanCostUsd / summary.meanScore
