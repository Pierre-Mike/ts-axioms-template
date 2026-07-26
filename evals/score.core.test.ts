import { describe, expect, it } from "bun:test"
import {
  type CellResult,
  type CheckResult,
  costPerPoint,
  isPass,
  mean,
  scoreOf,
  stdev,
  summariseByModel,
  summariseByTask,
  trivialTasks,
  verdictOf,
} from "./score.core"

const GREEN_GATE: CheckResult = { name: "lint:ci", kind: "gate", ok: true, ms: 0 }

const check = (over: Partial<CheckResult> = {}): CheckResult => ({ ...GREEN_GATE, ...over })

const BASE_CELL: CellResult = {
  taskId: "t1",
  archetype: "arch",
  model: "sonnet",
  repeat: 0,
  checks: [GREEN_GATE],
  costUsd: 0,
  durationMs: 0,
  turns: 0,
  filesChanged: 0,
  linesChanged: 0,
  agentError: null,
}

const cell = (over: Partial<CellResult> = {}): CellResult => ({ ...BASE_CELL, ...over })

/** Test-local unwrap: keeps assertions free of optional chaining noise. */
const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a value")
  return value
}

describe("scoreOf", () => {
  it("is 0 with no checks", () => {
    expect(scoreOf([])).toBe(0)
  })

  it("weighs an assert twice a gate", () => {
    // one gate (1) green, one assert (2) red -> 1/3
    expect(scoreOf([check({ ok: true }), check({ kind: "assert", ok: false })])).toBeCloseTo(1 / 3)
    // the mirror image -> 2/3, so gate-only greenness cannot masquerade as done work
    expect(scoreOf([check({ ok: false }), check({ kind: "assert", ok: true })])).toBeCloseTo(2 / 3)
  })

  it("is 1 only when everything is green", () => {
    expect(scoreOf([check(), check({ kind: "assert" })])).toBe(1)
  })
})

describe("isPass", () => {
  it("requires every check green and at least one check", () => {
    expect(isPass([])).toBe(false)
    expect(isPass([check(), check({ kind: "assert" })])).toBe(true)
    expect(isPass([check(), check({ kind: "assert", ok: false })])).toBe(false)
  })
})

describe("stats", () => {
  it("means an empty sample to 0 rather than NaN", () => {
    expect(mean([])).toBe(0)
    expect(stdev([])).toBe(0)
    expect(stdev([0.5])).toBe(0)
  })

  it("computes the sample standard deviation", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4)
  })
})

describe("summariseByModel", () => {
  it("aggregates pass rate, score and cost per model", () => {
    const summaries = summariseByModel([
      cell({ model: "haiku", checks: [check({ ok: false })], costUsd: 0.01 }),
      cell({ model: "haiku", checks: [check()], costUsd: 0.03 }),
      cell({ model: "opus", checks: [check()], costUsd: 1 }),
    ])
    expect(summaries.map((s) => s.model)).toEqual(["haiku", "opus"])
    const haiku = must(summaries.at(0))
    expect(haiku.cells).toBe(2)
    expect(haiku.passRate).toBe(0.5)
    expect(haiku.meanScore).toBe(0.5)
    expect(haiku.totalCostUsd).toBeCloseTo(0.04)
    expect(haiku.meanCostUsd).toBeCloseTo(0.02)
    expect(must(summaries.at(1)).passRate).toBe(1)
  })

  it("counts agent errors separately from check failures", () => {
    const summaries = summariseByModel([cell({ agentError: "max turns exceeded" }), cell()])
    expect(must(summaries.at(0)).agentErrors).toBe(1)
  })
})

describe("summariseByTask", () => {
  it("builds the task x model matrix and names the failing checks", () => {
    const matrix = summariseByTask([
      cell({
        taskId: "sse",
        model: "haiku",
        checks: [check({ name: "audit", ok: false }), check({ name: "probe", kind: "assert" })],
      }),
      cell({ taskId: "sse", model: "opus", checks: [check({ name: "audit" })] }),
    ])
    expect(matrix).toHaveLength(2)
    const haiku = must(matrix.find((row) => row.model === "haiku"))
    expect(haiku.meanScore).toBeCloseTo(2 / 3)
    expect(haiku.failedChecks).toEqual(["audit"])
    expect(must(matrix.find((row) => row.model === "opus")).passRate).toBe(1)
  })
})

describe("verdictOf", () => {
  it("calls a small delta noise when the samples overlap", () => {
    const verdict = verdictOf({ base: [0.6, 0.8, 0.7], candidate: [0.7, 0.75, 0.65] })
    expect(verdict.label).toBe("noise")
  })

  it("calls a clean separation improved", () => {
    const verdict = verdictOf({ base: [0.3, 0.32, 0.31], candidate: [0.9, 0.92, 0.91] })
    expect(verdict.label).toBe("improved")
    expect(verdict.delta).toBeCloseTo(0.6)
  })

  it("calls a clean drop regressed", () => {
    expect(verdictOf({ base: [0.9, 0.91, 0.92], candidate: [0.4, 0.41, 0.42] }).label).toBe(
      "regressed",
    )
  })

  it("falls back to a blunt minimum delta at n=1 instead of trusting one run", () => {
    expect(verdictOf({ base: [0.5], candidate: [0.55] }).label).toBe("noise")
    expect(verdictOf({ base: [0.5], candidate: [0.9] }).label).toBe("improved")
  })

  it("never reports improvement on identical samples", () => {
    expect(verdictOf({ base: [0.5, 0.5, 0.5], candidate: [0.5, 0.5, 0.5] }).label).toBe("noise")
  })
})

describe("trivialTasks", () => {
  it("flags tasks a do-nothing agent already scores well on", () => {
    const flagged = trivialTasks({
      baseline: [
        // gates green, asserts red -> the task really measures something
        cell({ taskId: "real", checks: [check(), check({ kind: "assert", ok: false })] }),
        // everything green with no agent -> the task measures nothing
        cell({ taskId: "trivial", checks: [check(), check({ kind: "assert" })] }),
      ],
    })
    expect(flagged.map((t) => t.taskId)).toEqual(["trivial"])
    expect(must(flagged.at(0)).noOpScore).toBe(1)
  })
})

describe("costPerPoint", () => {
  it("is infinite for a model that scores nothing at any price", () => {
    const zero = must(summariseByModel([cell({ checks: [check({ ok: false })] })]).at(0))
    expect(costPerPoint(zero)).toBe(Number.POSITIVE_INFINITY)
  })

  it("prefers the cheap model only when it actually scores", () => {
    const haiku = must(summariseByModel([cell({ model: "haiku", costUsd: 0.05 })]).at(0))
    const opus = must(summariseByModel([cell({ model: "opus", costUsd: 1.2 })]).at(0))
    expect(costPerPoint(haiku)).toBeLessThan(costPerPoint(opus))
  })
})
