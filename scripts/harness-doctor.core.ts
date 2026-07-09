/**
 * Harness doctor — PURE checks over the enforcement stack itself.
 *
 * Every check takes plain parsed data (config objects, file texts) and returns
 * findings; the I/O shell is scripts/check-harness.ts. Checks are structural
 * (keys/shapes present), never byte-equality, so legitimate config evolution
 * doesn't false-positive — only *removal* of a gate does.
 *
 * Motivated by a descendant-repo audit (2026-07): every prose-only rule
 * decayed; every tool-enforced rule survived. The doctor makes deleting a gate
 * a loud, deliberate act instead of silent drift. It is deliberately
 * shape-agnostic — no app-path literals — so it keeps working in descendants
 * that rename or add apps.
 */

export interface Finding {
  readonly axiom: string
  readonly problem: string
  readonly remedy: string
}

export interface WorkflowFile {
  readonly name: string
  readonly text: string
}

export interface DoctorInput {
  readonly biome: unknown
  readonly hooks: unknown
  readonly ci: unknown
  readonly ruleset: unknown
  readonly pkg: unknown
  readonly workflows: ReadonlyArray<WorkflowFile>
  readonly bunVersionFileExists: boolean
  readonly workspaceDirs: ReadonlyArray<string>
  readonly tsconfigReferences: ReadonlyArray<string>
  readonly claudeMd: string | null
  readonly agentsMd: string | null
  readonly docsSyncTestExists: boolean
}

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const dig = (query: { readonly value: unknown; readonly path: ReadonlyArray<string> }): unknown => {
  let current = query.value
  for (const key of query.path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

const overridesOf = (biome: unknown): ReadonlyArray<Rec> => {
  const list = dig({ value: biome, path: ["overrides"] })
  return Array.isArray(list) ? list.filter(isRecord) : []
}

const deniedGlobalsOf = (node: unknown): ReadonlyArray<string> => {
  const denied = dig({
    value: node,
    path: ["linter", "rules", "style", "noRestrictedGlobals", "options", "deniedGlobals"],
  })
  return isRecord(denied) ? Object.keys(denied) : []
}

const importPatternGroupsOf = (node: unknown): ReadonlyArray<string> => {
  const patterns = dig({
    value: node,
    path: ["linter", "rules", "style", "noRestrictedImports", "options", "patterns"],
  })
  if (!Array.isArray(patterns)) return []
  return patterns.flatMap((pattern) => (isRecord(pattern) ? strings(pattern.group) : []))
}

/** Grit plugins the harness depends on, matched by basename (path-agnostic). */
export const REQUIRED_PLUGINS: ReadonlyArray<string> = [
  "max-one-param-declarations.grit",
  "no-throw-in-core.grit",
  "no-await-in-core.grit",
  "no-cast-json.grit",
]

const CORE_DENIED_GLOBALS: ReadonlyArray<string> = [
  "Date",
  "Promise",
  "console",
  "process",
  "setTimeout",
  "setInterval",
]

const EFFECT_RUNTIME_NAMES: ReadonlyArray<string> = ["Effect", "Layer", "Context"]

const BIOME_AXIOM = "fail-closed lint scoping"

const checkBiomeCoreOverride = (biome: unknown): Finding[] => {
  const findings: Finding[] = []
  const core = overridesOf(biome).find((override) =>
    strings(override.includes).includes("**/*.core.ts"),
  )
  if (core === undefined) {
    findings.push({
      axiom: "impureim sandwich",
      problem: "biome.json has no override scoped to **/*.core.ts — core purity is unenforced",
      remedy:
        "restore the *.core.ts override: denied globals (Date/Promise/console/process/setTimeout/setInterval), the effect-runtime import ban, and the no-throw/no-await plugins",
    })
    return findings
  }
  const denied = deniedGlobalsOf(core)
  for (const name of CORE_DENIED_GLOBALS) {
    if (!denied.includes(name)) {
      findings.push({
        axiom: "impureim sandwich",
        problem: `the **/*.core.ts override no longer denies the global \`${name}\``,
        remedy: `re-add \`${name}\` to deniedGlobals in the *.core.ts override — core must stay pure (data in, data out)`,
      })
    }
  }
  const importNames = strings(
    dig({
      value: core,
      path: [
        "linter",
        "rules",
        "style",
        "noRestrictedImports",
        "options",
        "paths",
        "effect",
        "importNames",
      ],
    }),
  )
  for (const name of EFFECT_RUNTIME_NAMES) {
    if (!importNames.includes(name)) {
      findings.push({
        axiom: "impureim sandwich",
        problem: `the **/*.core.ts override no longer bans importing \`${name}\` from effect`,
        remedy:
          "restore the effect-runtime import ban (Effect/Layer/Context/ManagedRuntime/Runtime) in the *.core.ts override",
      })
    }
  }
  return findings
}

const checkBiomePlugins = (biome: unknown): Finding[] => {
  const registered = [
    ...strings(dig({ value: biome, path: ["plugins"] })),
    ...overridesOf(biome).flatMap((override) => strings(override.plugins)),
  ]
  const findings: Finding[] = []
  for (const plugin of REQUIRED_PLUGINS) {
    if (!registered.some((entry) => entry.endsWith(plugin))) {
      findings.push({
        axiom: BIOME_AXIOM,
        problem: `grit plugin ${plugin} is not registered in biome.json`,
        remedy: `re-register ./biome-plugins/${plugin} (top-level or in the override that owns it) — deleting a plugin deletes the axiom it enforces`,
      })
    }
  }
  return findings
}

const checkBiomeScoping = (biome: unknown): Finding[] => {
  const findings: Finding[] = []
  const topDenied = deniedGlobalsOf(biome)
  for (const name of ["fetch", "process"]) {
    if (!topDenied.includes(name)) {
      findings.push({
        axiom: BIOME_AXIOM,
        problem: `the global \`${name}\` is no longer denied at the top level of biome.json`,
        remedy: `deny \`${name}\` globally and re-allow only at sanctioned shapes — path-scoped denials fail OPEN when an app is renamed`,
      })
    }
  }
  const doorOverride = overridesOf(biome).find(
    (override) =>
      strings(override.includes).includes("**/features/**") &&
      importPatternGroupsOf(override).includes("../*/*.core"),
  )
  if (doorOverride === undefined) {
    findings.push({
      axiom: "modules talk through doors",
      problem:
        "biome.json has no **/features/** override banning cross-slice ../*/* internal imports",
      remedy:
        "restore the shape-scoped door-ban override so every app's feature slices — current and future — inherit module boundaries",
    })
  }
  const ioOverride = overridesOf(biome).find((override) =>
    strings(override.includes).some((entry) => entry.endsWith("*.io.ts")),
  )
  if (ioOverride === undefined || deniedGlobalsOf(ioOverride).includes("fetch")) {
    findings.push({
      axiom: BIOME_AXIOM,
      problem: "the *.io.ts override that re-allows fetch (the sanctioned I/O port) is missing",
      remedy:
        "restore the **/*.io.ts override re-declaring deniedGlobals without fetch — otherwise slices have no sanctioned place for external I/O",
    })
  }
  return findings
}

export const checkBiome = (biome: unknown): Finding[] => [
  ...checkBiomeScoping(biome),
  ...checkBiomeCoreOverride(biome),
  ...checkBiomePlugins(biome),
]

const hookRuns = (query: {
  readonly hooks: unknown
  readonly section: string
}): ReadonlyArray<string> => {
  const jobs = dig({ value: query.hooks, path: [query.section, "jobs"] })
  if (!Array.isArray(jobs)) return []
  return jobs.flatMap((job) => (isRecord(job) && typeof job.run === "string" ? [job.run] : []))
}

export const checkHooks = (hooks: unknown): Finding[] => {
  const findings: Finding[] = []
  const expectations = [
    { section: "pre-commit", needle: "biome", gate: "the Biome autofix gate" },
    { section: "commit-msg", needle: "check-commit-msg", gate: "the conventional-commit gate" },
    { section: "pre-push", needle: "tsc", gate: "the typecheck gate" },
    { section: "pre-push", needle: "audit", gate: "the fallow audit gate" },
  ]
  for (const expected of expectations) {
    const runs = hookRuns({ hooks, section: expected.section })
    if (!runs.some((run) => run.includes(expected.needle))) {
      findings.push({
        axiom: "hooks wired",
        problem: `lefthook.yml ${expected.section} no longer runs ${expected.gate}`,
        remedy: `restore the ${expected.section} job running \`${expected.needle}\` — hooks are the first line of the harness`,
      })
    }
  }
  return findings
}

export const checkCiContract = (input: {
  readonly ci: unknown
  readonly ruleset: unknown
}): Finding[] => {
  const findings: Finding[] = []
  const jobs = dig({ value: input.ci, path: ["jobs"] })
  const jobNames = isRecord(jobs) ? Object.keys(jobs) : []
  if (jobNames.length === 0) {
    findings.push({
      axiom: "CI↔ruleset contract",
      problem: "no CI workflow with jobs was found (.github/workflows/ci.yml)",
      remedy:
        "restore ci.yml — without it the ruleset's required checks never report and main is unmergeable",
    })
  }
  if (!isRecord(input.ruleset)) {
    findings.push({
      axiom: "governance-as-code",
      problem:
        ".github/rulesets/main.json is missing — branch protection has no committed contract",
      remedy: "restore the ruleset file and apply it with .github/scripts/apply-ruleset.sh",
    })
    return findings
  }
  const rules = Array.isArray(input.ruleset.rules) ? input.ruleset.rules.filter(isRecord) : []
  const statusRule = rules.find((rule) => rule.type === "required_status_checks")
  const contexts = Array.isArray(
    dig({ value: statusRule, path: ["parameters", "required_status_checks"] }),
  )
    ? (dig({ value: statusRule, path: ["parameters", "required_status_checks"] }) as unknown[])
        .filter(isRecord)
        .flatMap((check) => (typeof check.context === "string" ? [check.context] : []))
    : []
  if (contexts.length === 0) {
    findings.push({
      axiom: "governance-as-code",
      problem: "the ruleset requires no status checks — any red PR can merge",
      remedy:
        "restore required_status_checks (lint/typecheck/test/audit) in .github/rulesets/main.json",
    })
  }
  for (const context of contexts) {
    if (!jobNames.includes(context)) {
      findings.push({
        axiom: "CI↔ruleset contract",
        problem: `ruleset requires check \`${context}\` but ci.yml has no job with that name`,
        remedy:
          "rename the job and the ruleset context TOGETHER — a descendant repo lost a full day to merges blocking on a check that never reported",
      })
    }
  }
  return findings
}

const USES_LINE = /uses:\s*([^\s#]+)/g
const SHA_PINNED = /@[0-9a-f]{40}$/

export const checkSupplyChain = (input: {
  readonly workflows: ReadonlyArray<WorkflowFile>
  readonly bunVersionFileExists: boolean
}): Finding[] => {
  const findings: Finding[] = []
  for (const workflow of input.workflows) {
    for (const match of workflow.text.matchAll(USES_LINE)) {
      const action = match[1] ?? ""
      if (action.startsWith("./") || action.startsWith("docker://")) continue
      if (!SHA_PINNED.test(action)) {
        findings.push({
          axiom: "supply chain pinned",
          problem: `${workflow.name} uses unpinned action \`${action}\``,
          remedy:
            "pin to a full 40-hex commit SHA (tag comments are fine) — tags are mutable, SHAs are not",
        })
      }
    }
    if (workflow.text.includes("setup-bun") && !workflow.text.includes("bun-version-file")) {
      findings.push({
        axiom: "supply chain pinned",
        problem: `${workflow.name} sets up Bun without bun-version-file`,
        remedy: "point setup-bun at .bun-version so CI and local toolchains cannot drift apart",
      })
    }
  }
  if (!input.bunVersionFileExists) {
    findings.push({
      axiom: "supply chain pinned",
      problem: ".bun-version is missing — the toolchain version is no longer pinned",
      remedy: "restore .bun-version; workflows reference it via bun-version-file",
    })
  }
  return findings
}

const normalizeRef = (ref: string): string => ref.replace(/^\.\//, "").replace(/\/$/, "")

export const checkTypecheckCoverage = (input: {
  readonly workspaceDirs: ReadonlyArray<string>
  readonly tsconfigReferences: ReadonlyArray<string>
}): Finding[] => {
  const referenced = input.tsconfigReferences.map(normalizeRef)
  const findings: Finding[] = []
  for (const dir of input.workspaceDirs) {
    if (!referenced.includes(normalizeRef(dir))) {
      findings.push({
        axiom: "typecheck coverage",
        problem: `workspace ${dir} is not referenced in the root tsconfig \`tsc -b\` graph`,
        remedy: `add { "path": "./${normalizeRef(dir)}" } to tsconfig.json references — a workspace outside the graph merges type errors silently`,
      })
    }
  }
  return findings
}

const CANON_MARKERS = ["<!-- axioms:start -->", "<!-- axioms:end -->"]

const checkCanonFile = (query: {
  readonly name: string
  readonly text: string | null
}): Finding[] => {
  if (query.text === null) {
    return [
      {
        axiom: "canon sync",
        problem: `${query.name} is missing`,
        remedy: `restore ${query.name} — CLAUDE.md and AGENTS.md carry the same canon between axioms:start/end markers`,
      },
    ]
  }
  const missing = CANON_MARKERS.filter((marker) => !(query.text ?? "").includes(marker))
  return missing.map((marker) => ({
    axiom: "canon sync",
    problem: `${query.name} lost its ${marker} sync marker`,
    remedy:
      "restore the axioms:start/end markers — scripts/docs-sync.test.ts gates canon identity through them",
  }))
}

export const checkCanonSync = (input: {
  readonly claudeMd: string | null
  readonly agentsMd: string | null
  readonly docsSyncTestExists: boolean
}): Finding[] => {
  const findings = [
    ...checkCanonFile({ name: "CLAUDE.md", text: input.claudeMd }),
    ...checkCanonFile({ name: "AGENTS.md", text: input.agentsMd }),
  ]
  if (!input.docsSyncTestExists) {
    findings.push({
      axiom: "canon sync",
      problem:
        "scripts/docs-sync.test.ts is missing — canon drift between CLAUDE.md and AGENTS.md is unchecked",
      remedy: "restore the docs-sync test; it fails the build when the marked canon regions differ",
    })
  }
  return findings
}

export const checkScriptWiring = (pkg: unknown): Finding[] => {
  const findings: Finding[] = []
  const scripts = dig({ value: pkg, path: ["scripts"] })
  const scriptOf = (name: string): string => {
    const value = isRecord(scripts) ? scripts[name] : undefined
    return typeof value === "string" ? value : ""
  }
  for (const gate of ["lint:ci", "typecheck", "test", "audit"]) {
    if (!scriptOf("verify").includes(gate)) {
      findings.push({
        axiom: "gate wiring",
        problem: `package.json \`verify\` no longer chains \`${gate}\``,
        remedy:
          "keep verify = lint:ci + typecheck + test + audit — the one-shot local equivalent of the required CI checks",
      })
    }
  }
  for (const needle of ["check-colocated-tests", "check-harness"]) {
    if (!scriptOf("test").includes(needle)) {
      findings.push({
        axiom: "harness checks itself",
        problem: `package.json \`test\` no longer runs ${needle}`,
        remedy: `prepend \`bun run scripts/${needle}.ts\` to the test script — removal of a meta-gate must fail the required test check`,
      })
    }
  }
  if (!scriptOf("doctor").includes("check-harness")) {
    findings.push({
      axiom: "harness checks itself",
      problem: "package.json has no `doctor` script running check-harness",
      remedy: 'restore "doctor": "bun run scripts/check-harness.ts"',
    })
  }
  return findings
}

export const runDoctor = (input: DoctorInput): Finding[] => [
  ...checkBiome(input.biome),
  ...checkHooks(input.hooks),
  ...checkCiContract({ ci: input.ci, ruleset: input.ruleset }),
  ...checkSupplyChain({
    workflows: input.workflows,
    bunVersionFileExists: input.bunVersionFileExists,
  }),
  ...checkTypecheckCoverage({
    workspaceDirs: input.workspaceDirs,
    tsconfigReferences: input.tsconfigReferences,
  }),
  ...checkCanonSync({
    claudeMd: input.claudeMd,
    agentsMd: input.agentsMd,
    docsSyncTestExists: input.docsSyncTestExists,
  }),
  ...checkScriptWiring(input.pkg),
]
