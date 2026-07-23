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
  checkCanonSync,
  checkCiContract,
  checkHooks,
  checkScriptWiring,
  checkSupplyChain,
  checkTypecheckCoverage,
  type DoctorInput,
  dig,
  isRecord,
  runDoctor,
  strings,
} from "./harness-doctor.core"

const root = join(import.meta.dir, "..")
const real: DoctorInput = readDoctorInput(root)

const tamperedBiome = (mutate: (biome: Record<string, unknown>) => void): unknown => {
  const clone = structuredClone(real.biome) as Record<string, unknown>
  mutate(clone)
  return clone
}

/**
 * Small, single-purpose mutation helpers for the red-team fixtures below.
 * Each fixture composes these instead of inlining find/filter/optional-chain
 * logic in the `tamperedBiome` callback — keeps every callback a one-liner
 * (fallow flagged the inlined versions for cyclomatic/cognitive complexity).
 */
type OverrideLike = Record<string, unknown>

const asOverrides = (biome: Record<string, unknown>): OverrideLike[] =>
  (biome.overrides as OverrideLike[] | undefined) ?? []

const overrideIncluding = (query: {
  readonly overrides: ReadonlyArray<OverrideLike>
  readonly shape: string
}): OverrideLike | undefined =>
  query.overrides.find((override) => strings(override.includes).includes(query.shape))

const overrideWithSuffix = (query: {
  readonly overrides: ReadonlyArray<OverrideLike>
  readonly suffix: string
}): OverrideLike | undefined =>
  query.overrides.find((override) =>
    strings(override.includes).some((entry) => entry.endsWith(query.suffix)),
  )

const removePlugin = (query: {
  readonly override: OverrideLike | undefined
  readonly needle: string
}): void => {
  if (query.override === undefined) return
  query.override.plugins = strings(query.override.plugins).filter(
    (plugin) => !plugin.includes(query.needle),
  )
}

const addPlugin = (query: {
  readonly override: OverrideLike | undefined
  readonly plugin: string
}): void => {
  if (query.override === undefined) return
  query.override.plugins = [...strings(query.override.plugins), query.plugin]
}

const removeImportGroupEntry = (query: {
  readonly override: OverrideLike | undefined
  readonly entry: string
}): void => {
  const patterns = dig({
    value: query.override,
    path: ["linter", "rules", "style", "noRestrictedImports", "options", "patterns"],
  })
  if (!Array.isArray(patterns)) return
  for (const pattern of patterns.filter(isRecord)) {
    pattern.group = strings(pattern.group).filter((candidate) => candidate !== query.entry)
  }
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

  it('flags a core-purity noRestrictedGlobals rule flipped to level "off" (keys retained, enforcement dead)', () => {
    const biome = tamperedBiome((clone) => {
      const core = overrideIncluding({ overrides: asOverrides(clone), shape: "**/*.core.ts" })
      const rule = dig({
        value: core,
        path: ["linter", "rules", "style", "noRestrictedGlobals"],
      }) as { level?: string } | undefined
      if (rule) rule.level = "off"
    })
    const findings = checkBiome(biome)
    expect(
      findings.some(
        (finding) =>
          finding.problem.includes("**/*.core.ts") &&
          finding.problem.includes('not at level "error"'),
      ),
    ).toBe(true)
  })

  it("flags a LATER override that re-declares (empties) core-purity deniedGlobals — invisible to a first-match .find()", () => {
    const biome = tamperedBiome((clone) => {
      const overrides = clone.overrides as Array<Record<string, unknown>>
      overrides.push({
        includes: ["**/*.core.ts"],
        linter: {
          rules: {
            style: {
              noRestrictedGlobals: { level: "error", options: { deniedGlobals: {} } },
            },
          },
        },
      })
    })
    const findings = checkBiome(biome)
    expect(
      findings.some((finding) => finding.problem.includes("no longer denies the global")),
    ).toBe(true)
  })

  it("flags no-throw-in-core.grit registered on the WRONG override (moved off the *.core.ts scope)", () => {
    const biome = tamperedBiome((clone) => {
      const overrides = asOverrides(clone)
      removePlugin({
        override: overrideIncluding({ overrides, shape: "**/*.core.ts" }),
        needle: "no-throw-in-core",
      })
      addPlugin({
        override: overrideWithSuffix({ overrides, suffix: "*.io.ts" }),
        plugin: "./biome-plugins/no-throw-in-core.grit",
      })
    })
    const findings = checkBiome(biome)
    expect(
      findings.some(
        (finding) =>
          finding.problem.includes("no-throw-in-core.grit") &&
          finding.problem.includes("registered on the override scoped to **/*.core.ts"),
      ),
    ).toBe(true)
  })

  it("flags the sibling-slice ban pattern removed from the *.core.ts override's noRestrictedImports.patterns", () => {
    const biome = tamperedBiome((clone) => {
      removeImportGroupEntry({
        override: overrideIncluding({ overrides: asOverrides(clone), shape: "**/*.core.ts" }),
        entry: "../*/*.core",
      })
    })
    const findings = checkBiome(biome)
    expect(
      findings.some(
        (finding) =>
          finding.axiom === "modules talk through doors" && finding.problem.includes("*.core.ts"),
      ),
    ).toBe(true)
  })

  it("flags the *.io.ts override no longer denying `process` (typed-config-at-boot regression)", () => {
    const biome = tamperedBiome((clone) => {
      const io = overrideWithSuffix({ overrides: asOverrides(clone), suffix: "*.io.ts" })
      const denied = dig({
        value: io,
        path: ["linter", "rules", "style", "noRestrictedGlobals", "options", "deniedGlobals"],
      }) as Record<string, string> | undefined
      if (denied) delete denied.process
    })
    const findings = checkBiome(biome)
    expect(
      findings.some(
        (finding) =>
          finding.problem.includes("*.io.ts") &&
          finding.problem.includes("no longer denies `process`"),
      ),
    ).toBe(true)
  })

  it("flags a deleted **/main.ts override (previously invisible — no check existed for it)", () => {
    const biome = tamperedBiome((clone) => {
      clone.overrides = (clone.overrides as Array<{ includes?: string[] }>).filter(
        (override) => !(override.includes ?? []).includes("**/main.ts"),
      )
    })
    const findings = checkBiome(biome)
    expect(findings.some((finding) => finding.problem.includes("**/main.ts"))).toBe(true)
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

  it("flags a workspace outside the tsc -b graph", () => {
    const findings = checkTypecheckCoverage({
      workspaceDirs: [...real.workspaceDirs, "apps/daemon"],
      tsconfigReferences: real.tsconfigReferences,
    })
    expect(findings.some((finding) => finding.problem.includes("apps/daemon"))).toBe(true)
  })

  it("flags stripped canon markers", () => {
    const findings = checkCanonSync({
      claudeMd: (real.claudeMd ?? "").replaceAll("<!-- axioms:start -->", ""),
      agentsMd: real.agentsMd,
      docsSyncTestExists: real.docsSyncTestExists,
    })
    expect(findings.some((finding) => finding.problem.includes("CLAUDE.md"))).toBe(true)
  })

  it("flags the doctor unwired from the test script", () => {
    const pkg = structuredClone(real.pkg) as { scripts: Record<string, string> }
    pkg.scripts.test = pkg.scripts.test.replace(" && bun run scripts/check-harness.ts", "")
    const findings = checkScriptWiring(pkg)
    expect(findings.some((finding) => finding.axiom === "harness checks itself")).toBe(true)
  })
})
