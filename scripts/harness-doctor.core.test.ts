/**
 * Red-team tests for the harness doctor: every fixture is the repo's REAL
 * config with one gate surgically deleted — one tamper per decay class
 * observed in the descendant-repo audit that motivated the doctor. The green
 * fixture (untampered repo) must produce zero findings, so the doctor can
 * never rot into a gate people learn to ignore.
 */
import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { readDoctorInput } from "./check-harness"
import {
  checkBiome,
  checkCanonRedirect,
  checkCiContract,
  checkEvalTasks,
  checkHooks,
  checkScheduledAudit,
  checkScriptWiring,
  checkSupplyChain,
  checkTypecheckCoverage,
  type DoctorInput,
  runDoctor,
} from "./harness-doctor.core"

const root = join(import.meta.dir, "..")
const real: DoctorInput = readDoctorInput(root)

const tamperedBiome = (mutate: (biome: Record<string, unknown>) => void): unknown => {
  const clone = structuredClone(real.biome) as Record<string, unknown>
  mutate(clone)
  return clone
}

describe("harness doctor", () => {
  it("green fixture: the real repo produces zero findings", () => {
    expect(runDoctor(real)).toEqual([])
  })

  it("flags a deleted core-purity override (the rename-decay class)", () => {
    const biome = tamperedBiome((clone) => {
      clone.overrides = (clone.overrides as Array<{ includes?: string[] }>).filter(
        (override) => !(override.includes ?? []).includes("**/*.core.ts"),
      )
    })
    const findings = checkBiome(biome)
    expect(findings.some((finding) => finding.problem.includes("**/*.core.ts"))).toBe(true)
  })

  it("flags a dropped top-level process denial (fail-open funnel)", () => {
    const biome = tamperedBiome((clone) => {
      const linter = clone.linter as {
        rules: {
          style: { noRestrictedGlobals: { options: { deniedGlobals: Record<string, string> } } }
        }
      }
      delete linter.rules.style.noRestrictedGlobals.options.deniedGlobals.process
    })
    const findings = checkBiome(biome)
    expect(findings.some((finding) => finding.problem.includes("`process`"))).toBe(true)
  })

  it("flags an unregistered grit plugin", () => {
    const biome = tamperedBiome((clone) => {
      clone.plugins = []
    })
    const findings = checkBiome(biome)
    expect(
      findings.some((finding) => finding.problem.includes("max-one-param-declarations.grit")),
    ).toBe(true)
  })

  it("flags a deleted **/features/** door-ban override", () => {
    const biome = tamperedBiome((clone) => {
      clone.overrides = (clone.overrides as Array<{ includes?: string[] }>).filter(
        (override) => !(override.includes ?? []).includes("**/features/**"),
      )
    })
    const findings = checkBiome(biome)
    expect(findings.some((finding) => finding.axiom === "modules talk through doors")).toBe(true)
  })

  it("flags a dropped commit-msg hook", () => {
    const hooks = structuredClone(real.hooks) as Record<string, unknown>
    delete hooks["commit-msg"]
    const findings = checkHooks(hooks)
    expect(findings.some((finding) => finding.problem.includes("commit-msg"))).toBe(true)
  })

  it("flags a CI job renamed without touching the ruleset", () => {
    const ci = structuredClone(real.ci) as { jobs: Record<string, unknown> }
    ci.jobs.tests = ci.jobs.test
    delete ci.jobs.test
    const findings = checkCiContract({ ci, ruleset: real.ruleset })
    expect(findings.some((finding) => finding.problem.includes("`test`"))).toBe(true)
  })

  it("flags a missing ruleset file", () => {
    const findings = checkCiContract({ ci: real.ci, ruleset: null })
    expect(findings.some((finding) => finding.axiom === "governance-as-code")).toBe(true)
  })

  it("flags an unpinned action", () => {
    const workflows = real.workflows.map((workflow) =>
      workflow.name === "ci.yml"
        ? {
            name: workflow.name,
            text: workflow.text.replace(
              /uses: actions\/checkout@[0-9a-f]{40}/,
              "uses: actions/checkout@v6",
            ),
          }
        : workflow,
    )
    const findings = checkSupplyChain({ workflows, bunVersionFileExists: true })
    expect(findings.some((finding) => finding.problem.includes("actions/checkout@v6"))).toBe(true)
  })

  it("flags a de-scheduled advisory scan (the quiet-repo blind spot)", () => {
    const workflows = real.workflows.map((workflow) => ({
      name: workflow.name,
      text: workflow.text.replace(/^\s*-\s*cron:.*$/gm, ""),
    }))
    const findings = checkScheduledAudit(workflows)
    expect(findings.some((finding) => finding.axiom === "advisories on a clock")).toBe(true)
  })

  it("flags a workspace outside the tsc -b graph", () => {
    const findings = checkTypecheckCoverage({
      workspaceDirs: [...real.workspaceDirs, "apps/daemon"],
      tsconfigReferences: real.tsconfigReferences,
    })
    expect(findings.some((finding) => finding.problem.includes("apps/daemon"))).toBe(true)
  })

  it("flags CLAUDE.md losing its @AGENTS.md redirect", () => {
    const findings = checkCanonRedirect({
      claudeMd: (real.claudeMd ?? "").replaceAll("@AGENTS.md", ""),
      agentsMd: real.agentsMd,
      docsSyncTestExists: real.docsSyncTestExists,
    })
    expect(findings.some((finding) => finding.problem.includes("CLAUDE.md"))).toBe(true)
  })

  it("flags the canon forked back into CLAUDE.md", () => {
    const findings = checkCanonRedirect({
      claudeMd: `${real.claudeMd ?? ""}\n${real.agentsMd ?? ""}`,
      agentsMd: real.agentsMd,
      docsSyncTestExists: real.docsSyncTestExists,
    })
    expect(findings.some((finding) => finding.problem.includes("forked"))).toBe(true)
  })

  it("flags an eval task with no asserts — a task the gates alone score for free", () => {
    const findings = checkEvalTasks({
      evalTasks: [{ id: "free-points", prompt: "do something" }],
      evalTasksFileExists: true,
    })
    expect(findings.some((finding) => finding.problem.includes("free-points"))).toBe(true)
  })

  it("flags a deleted eval grid", () => {
    const findings = checkEvalTasks({ evalTasks: [], evalTasksFileExists: false })
    expect(findings.some((finding) => finding.problem.includes("tasks.jsonl"))).toBe(true)
  })

  it("flags the doctor unwired from the test script", () => {
    const pkg = structuredClone(real.pkg) as { scripts: Record<string, string> }
    pkg.scripts.test = pkg.scripts.test.replace(" && bun run scripts/check-harness.ts", "")
    const findings = checkScriptWiring(pkg)
    expect(findings.some((finding) => finding.axiom === "harness checks itself")).toBe(true)
  })
})
