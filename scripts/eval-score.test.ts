import { describe, expect, it } from "bun:test"
import { type Floor, type Score, scoreRuns } from "./eval-score"

const floor = (opts: { floor: number; margin: number }): Floor => opts

describe("scoreRuns", () => {
  it("computes per-task pass-rate and cross-task mean", () => {
    const score = scoreRuns({
      results: [
        { id: "a", attempts: 4, passes: 4 },
        { id: "b", attempts: 4, passes: 2 },
      ],
      floor: floor({ floor: 0, margin: 0 }),
    })
    expect(score.perTask).toEqual([
      { id: "a", rate: 1 },
      { id: "b", rate: 0.5 },
    ])
    expect(score.mean).toBe(0.75)
  })

  it("passes when mean >= floor - margin (noise tolerance)", () => {
    const score = scoreRuns({
      results: [{ id: "a", attempts: 10, passes: 7 }],
      floor: floor({ floor: 0.8, margin: 0.15 }),
    })
    // mean 0.7, threshold 0.8 - 0.15 = 0.65 -> pass despite being under the raw floor
    expect(score.threshold).toBeCloseTo(0.65)
    expect(score.pass).toBe(true)
  })

  it("fails when mean drops below the noise threshold", () => {
    const score = scoreRuns({
      results: [{ id: "a", attempts: 10, passes: 5 }],
      floor: floor({ floor: 0.8, margin: 0.1 }),
    })
    expect(score.pass).toBe(false)
  })

  it("never passes on an empty result set — nothing was proven", () => {
    const score = scoreRuns({ results: [], floor: floor({ floor: 0, margin: 0 }) })
    expect(score.mean).toBe(0)
    expect(score.pass).toBe(false)
  })

  it("clamps a zero-attempt task to 0 rather than dividing by zero", () => {
    const score = scoreRuns({
      results: [{ id: "a", attempts: 0, passes: 0 }],
      floor: floor({ floor: 0, margin: 0 }),
    })
    expect(score.perTask[0]?.rate).toBe(0)
  })

  it("threshold floors at 0 even when margin exceeds the floor", () => {
    const score: Score = scoreRuns({
      results: [{ id: "a", attempts: 1, passes: 0 }],
      floor: floor({ floor: 0.1, margin: 0.5 }),
    })
    expect(score.threshold).toBe(0)
  })
})
