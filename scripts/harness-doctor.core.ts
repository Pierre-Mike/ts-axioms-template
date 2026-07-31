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
  readonly evalTasks: ReadonlyArray<unknown>
  readonly evalTasksFileExists: boolean
}

type Rec = Record<string, unknown>

export const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const dig = (query: {
  readonly value: unknown
  readonly path: ReadonlyArray<string>
}): unknown => {
  let current = query.value
  for (const key of query.path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

export const strings = (value: unknown): ReadonlyArray<string> =>
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
  const core = overridesOf(biome).find((override) =>
    strings(override.includes).includes("**/*.core.ts"),
  )
  if (core === undefined) {
    return [
      {
        axiom: "impureim sandwich",
        problem: "biome.json has no override scoped to **/*.core.ts — core purity is unenforced",
        remedy:
          "restore the *.core.ts override: denied globals (Date/Promise/console/process/setTimeout/setInterval), the effect-runtime import ban, and the no-throw/no-await plugins",
      },
    ]
  }
  const denied = deniedGlobalsOf(core)
  const missingGlobals = CORE_DENIED_GLOBALS.filter((name) => !denied.includes(name)).map(
    (name) => ({
      axiom: "impureim sandwich",
      problem: `the **/*.core.ts override no longer denies the global \`${name}\``,
      remedy: `re-add \`${name}\` to deniedGlobals in the *.core.ts override — core must stay pure (data in, data out)`,
    }),
  )
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
  const missingImportBans = EFFECT_RUNTIME_NAMES.filter((name) => !importNames.includes(name)).map(
    (name) => ({
      axiom: "impureim sandwich",
      problem: `the **/*.core.ts override no longer bans importing \`${name}\` from effect`,
      remedy:
        "restore the effect-runtime import ban (Effect/Layer/Context/ManagedRuntime/Runtime) in the *.core.ts override",
    }),
  )
  return [...missingGlobals, ...missingImportBans]
}

const checkBiomePlugins = (biome: unknown): Finding[] => {
  const registered = [
    ...strings(dig({ value: biome, path: ["plugins"] })),
    ...overridesOf(biome).flatMap((override) => strings(override.plugins)),
  ]
  return REQUIRED_PLUGINS.filter(
    (plugin) => !registered.some((entry) => entry.endsWith(plugin)),
  ).map((plugin) => ({
    axiom: BIOME_AXIOM,
    problem: `grit plugin ${plugin} is not registered in biome.json`,
    remedy: `re-register ./biome-plugins/${plugin} (top-level or in the override that owns it) — deleting a plugin deletes the axiom it enforces`,
  }))
}

const checkBiomeGlobalDenials = (biome: unknown): Finding[] => {
  const topDenied = deniedGlobalsOf(biome)
  return ["fetch", "process"]
    .filter((name) => !topDenied.includes(name))
    .map((name) => ({
      axiom: BIOME_AXIOM,
      problem: `the global \`${name}\` is no longer denied at the top level of biome.json`,
      remedy: `deny \`${name}\` globally and re-allow only at sanctioned shapes — path-scoped denials fail OPEN when an app is renamed`,
    }))
}

const checkBiomeDoorBan = (biome: unknown): Finding[] => {
  const doorOverride = overridesOf(biome).find(
    (override) =>
      strings(override.includes).includes("**/features/**") &&
      importPatternGroupsOf(override).includes("../*/*.core"),
  )
  if (doorOverride !== undefined) return []
  return [
    {
      axiom: "modules talk through doors",
      problem:
        "biome.json has no **/features/** override banning cross-slice ../*/* internal imports",
      remedy:
        "restore the shape-scoped door-ban override so every app's feature slices — current and future — inherit module boundaries",
    },
  ]
}

const checkBiomeIoPort = (biome: unknown): Finding[] => {
  const ioOverride = overridesOf(biome).find((override) =>
    strings(override.includes).some((entry) => entry.endsWith("*.io.ts")),
  )
  if (ioOverride !== undefined && !deniedGlobalsOf(ioOverride).includes("fetch")) return []
  return [
    {
      axiom: BIOME_AXIOM,
      problem: "the *.io.ts override that re-allows fetch (the sanctioned I/O port) is missing",
      remedy:
        "restore the **/*.io.ts override re-declaring deniedGlobals without fetch — otherwise slices have no sanctioned place for external I/O",
    },
  ]
}

export const checkBiome = (biome: unknown): Finding[] => [
  ...checkBiomeGlobalDenials(biome),
  ...checkBiomeDoorBan(biome),
  ...checkBiomeIoPort(biome),
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

const HOOK_EXPECTATIONS = [
  { section: "pre-commit", needle: "biome", gate: "the Biome autofix gate" },
  { section: "commit-msg", needle: "check-commit-msg", gate: "the conventional-commit gate" },
  { section: "pre-push", needle: "tsc", gate: "the typecheck gate" },
  { section: "pre-push", needle: "audit", gate: "the fallow audit gate" },
] as const

export const checkHooks = (hooks: unknown): Finding[] =>
  HOOK_EXPECTATIONS.filter(
    (expected) =>
      !hookRuns({ hooks, section: expected.section }).some((run) => run.includes(expected.needle)),
  ).map((expected) => ({
    axiom: "hooks wired",
    problem: `lefthook.yml ${expected.section} no longer runs ${expected.gate}`,
    remedy: `restore the ${expected.section} job running \`${expected.needle}\` — hooks are the first line of the harness`,
  }))

const requiredContextsOf = (ruleset: Rec): ReadonlyArray<string> => {
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules.filter(isRecord) : []
  const statusRule = rules.find((rule) => rule.type === "required_status_checks")
  const checks = dig({ value: statusRule, path: ["parameters", "required_status_checks"] })
  if (!Array.isArray(checks)) return []
  return checks
    .filter(isRecord)
    .flatMap((check) => (typeof check.context === "string" ? [check.context] : []))
}

const missingRulesetFinding: Finding = {
  axiom: "governance-as-code",
  problem: ".github/rulesets/main.json is missing — branch protection has no committed contract",
  remedy: "restore the ruleset file and apply it with .github/scripts/apply-ruleset.sh",
}

const emptyContextsFinding: Finding = {
  axiom: "governance-as-code",
  problem: "the ruleset requires no status checks — any red PR can merge",
  remedy:
    "restore required_status_checks (lint/typecheck/test/audit) in .github/rulesets/main.json",
}

const ciJobsFindings = (jobNames: ReadonlyArray<string>): Finding[] =>
  jobNames.length > 0
    ? []
    : [
        {
          axiom: "CI↔ruleset contract",
          problem: "no CI workflow with jobs was found (.github/workflows/ci.yml)",
          remedy:
            "restore ci.yml — without it the ruleset's required checks never report and main is unmergeable",
        },
      ]

const unmatchedContextFindings = (input: {
  readonly contexts: ReadonlyArray<string>
  readonly jobNames: ReadonlyArray<string>
}): Finding[] =>
  input.contexts
    .filter((context) => !input.jobNames.includes(context))
    .map((context) => ({
      axiom: "CI↔ruleset contract",
      problem: `ruleset requires check \`${context}\` but ci.yml has no job with that name`,
      remedy:
        "rename the job and the ruleset context TOGETHER — a descendant repo lost a full day to merges blocking on a check that never reported",
    }))

export const checkCiContract = (input: {
  readonly ci: unknown
  readonly ruleset: unknown
}): Finding[] => {
  const jobs = dig({ value: input.ci, path: ["jobs"] })
  const jobNames = isRecord(jobs) ? Object.keys(jobs) : []
  if (!isRecord(input.ruleset)) return [...ciJobsFindings(jobNames), missingRulesetFinding]
  const contexts = requiredContextsOf(input.ruleset)
  const contextFindings: Finding[] = contexts.length > 0 ? [] : [emptyContextsFinding]
  return [
    ...ciJobsFindings(jobNames),
    ...contextFindings,
    ...unmatchedContextFindings({ contexts, jobNames }),
  ]
}

const USES_LINE = /uses:\s*([^\s#]+)/g
const SHA_PINNED = /@[0-9a-f]{40}$/

const isUnpinnedAction = (action: string): boolean =>
  !action.startsWith("./") && !action.startsWith("docker://") && !SHA_PINNED.test(action)

const workflowSupplyFindings = (workflow: WorkflowFile): Finding[] => {
  const unpinned = [...workflow.text.matchAll(USES_LINE)]
    .map((match) => match[1] ?? "")
    .filter(isUnpinnedAction)
    .map((action) => ({
      axiom: "supply chain pinned",
      problem: `${workflow.name} uses unpinned action \`${action}\``,
      remedy:
        "pin to a full 40-hex commit SHA (tag comments are fine) — tags are mutable, SHAs are not",
    }))
  const bunDrift =
    workflow.text.includes("setup-bun") && !workflow.text.includes("bun-version-file")
      ? [
          {
            axiom: "supply chain pinned",
            problem: `${workflow.name} sets up Bun without bun-version-file`,
            remedy: "point setup-bun at .bun-version so CI and local toolchains cannot drift apart",
          },
        ]
      : []
  return [...unpinned, ...bunDrift]
}

export const checkSupplyChain = (input: {
  readonly workflows: ReadonlyArray<WorkflowFile>
  readonly bunVersionFileExists: boolean
}): Finding[] => {
  const missingPin: Finding[] = input.bunVersionFileExists
    ? []
    : [
        {
          axiom: "supply chain pinned",
          problem: ".bun-version is missing — the toolchain version is no longer pinned",
          remedy: "restore .bun-version; workflows reference it via bun-version-file",
        },
      ]
  return [...input.workflows.flatMap(workflowSupplyFindings), ...missingPin]
}

const CRON_TRIGGER = /^\s*-\s*cron:/m
const BUN_AUDIT_RUN = /\bbun\s+audit\b/

/**
 * The `audit` gate is event-driven (PR / push), so a repo that goes weeks
 * between merges never learns about advisories published against code that
 * did not change — this repo accumulated 16 of them, one critical, over 2.5
 * quiet weeks. Matched by SHAPE (any workflow that runs `bun audit` on a
 * cron), not by filename, so renaming the workflow cannot fail it open.
 */
export const checkScheduledAudit = (workflows: ReadonlyArray<WorkflowFile>): Finding[] =>
  workflows.some(
    (workflow) => CRON_TRIGGER.test(workflow.text) && BUN_AUDIT_RUN.test(workflow.text),
  )
    ? []
    : [
        {
          axiom: "advisories on a clock",
          problem:
            "no workflow runs `bun audit` on a cron — advisories only surface when someone happens to open a PR",
          remedy:
            "restore the scheduled dependency-advisory workflow (.github/workflows/dependency-audit.yml) — an event-driven audit makes a quiet repo a blind one",
        },
      ]

const normalizeRef = (ref: string): string => ref.replace(/^\.\//, "").replace(/\/$/, "")

export const checkTypecheckCoverage = (input: {
  readonly workspaceDirs: ReadonlyArray<string>
  readonly tsconfigReferences: ReadonlyArray<string>
}): Finding[] => {
  const referenced = input.tsconfigReferences.map(normalizeRef)
  return input.workspaceDirs
    .filter((dir) => !referenced.includes(normalizeRef(dir)))
    .map((dir) => ({
      axiom: "typecheck coverage",
      problem: `workspace ${dir} is not referenced in the root tsconfig \`tsc -b\` graph`,
      remedy: `add { "path": "./${normalizeRef(dir)}" } to tsconfig.json references — a workspace outside the graph merges type errors silently`,
    }))
}

const CANON_HEADINGS = ["## Architecture: feature-first vertical slices", "## Gate commands"]

const checkAgentsCanon = (agentsMd: string | null): Finding[] => {
  if (agentsMd === null) {
    return [
      {
        axiom: "single canon",
        problem: "AGENTS.md is missing — it is the single source of the agent operating rules",
        remedy: "restore AGENTS.md; CLAUDE.md is only a redirect that @AGENTS.md-imports it",
      },
    ]
  }
  return CANON_HEADINGS.filter((heading) => !agentsMd.includes(heading)).map((heading) => ({
    axiom: "single canon",
    problem: `AGENTS.md lost its \`${heading}\` canon section`,
    remedy:
      "restore the section — AGENTS.md carries the full canon; scripts/docs-sync.test.ts gates it",
  }))
}

const checkClaudeRedirect = (claudeMd: string | null): Finding[] => {
  if (claudeMd === null) {
    return [
      {
        axiom: "single canon",
        problem: "CLAUDE.md is missing — Claude Code loads the canon through its @AGENTS.md import",
        remedy: "restore CLAUDE.md as a plain redirect containing an @AGENTS.md import line",
      },
    ]
  }
  const hasRedirect = claudeMd.split("\n").some((line) => line.trim() === "@AGENTS.md")
  const redirect: Finding[] = hasRedirect
    ? []
    : [
        {
          axiom: "single canon",
          problem: "CLAUDE.md lost its @AGENTS.md import — Claude Code no longer loads the canon",
          remedy: "add the @AGENTS.md line back; CLAUDE.md stays a plain redirect to the canon",
        },
      ]
  const fork: Finding[] = CANON_HEADINGS.filter((heading) => claudeMd.includes(heading)).map(
    (heading) => ({
      axiom: "single canon",
      problem: `CLAUDE.md carries its own \`${heading}\` section — the canon is forked out of AGENTS.md`,
      remedy: "delete the duplicated rules from CLAUDE.md and edit AGENTS.md instead",
    }),
  )
  return [...redirect, ...fork]
}

export const checkCanonRedirect = (input: {
  readonly claudeMd: string | null
  readonly agentsMd: string | null
  readonly docsSyncTestExists: boolean
}): Finding[] => {
  const syncTest: Finding[] = input.docsSyncTestExists
    ? []
    : [
        {
          axiom: "single canon",
          problem:
            "scripts/docs-sync.test.ts is missing — the CLAUDE.md → AGENTS.md redirect is unchecked",
          remedy:
            "restore the docs-sync test; it fails the build when the redirect breaks or the canon is forked",
        },
      ]
  return [...checkClaudeRedirect(input.claudeMd), ...checkAgentsCanon(input.agentsMd), ...syncTest]
}

const VERIFY_GATES = ["lint:ci", "typecheck", "test", "audit"]
const TEST_META_GATES = ["check-colocated-tests", "check-harness"]

export const checkScriptWiring = (pkg: unknown): Finding[] => {
  const scriptOf = (name: string): string => {
    const value = dig({ value: pkg, path: ["scripts", name] })
    return typeof value === "string" ? value : ""
  }
  const verifyFindings = VERIFY_GATES.filter((gate) => !scriptOf("verify").includes(gate)).map(
    (gate) => ({
      axiom: "gate wiring",
      problem: `package.json \`verify\` no longer chains \`${gate}\``,
      remedy:
        "keep verify = lint:ci + typecheck + test + audit — the one-shot local equivalent of the required CI checks",
    }),
  )
  const testFindings = TEST_META_GATES.filter((needle) => !scriptOf("test").includes(needle)).map(
    (needle) => ({
      axiom: "harness checks itself",
      problem: `package.json \`test\` no longer runs ${needle}`,
      remedy: `prepend \`bun run scripts/${needle}.ts\` to the test script — removal of a meta-gate must fail the required test check`,
    }),
  )
  const doctorFindings: Finding[] = scriptOf("doctor").includes("check-harness")
    ? []
    : [
        {
          axiom: "harness checks itself",
          problem: "package.json has no `doctor` script running check-harness",
          remedy: 'restore "doctor": "bun run scripts/check-harness.ts"',
        },
      ]
  return [...verifyFindings, ...testFindings, ...doctorFindings]
}

/**
 * The eval grid is the only gate on the non-deterministic half of the harness,
 * and it decays in one specific way: a task judged by the repo's gates alone
 * passes when the agent does nothing (`bun run verify` is green on an
 * untouched checkout). So every task must carry at least one task-specific
 * assert. This is structural, not a style rule — a task without asserts is
 * free points, and free points hide regressions.
 */
export const checkEvalTasks = (input: {
  readonly evalTasks: ReadonlyArray<unknown>
  readonly evalTasksFileExists: boolean
}): Finding[] => {
  if (!input.evalTasksFileExists) {
    return [
      {
        axiom: "evals close the loop",
        problem: "evals/tasks.jsonl is missing — the harness has no eval grid",
        remedy:
          "restore the frozen task set; without it a harness change cannot be scored (see evals/README.md)",
      },
    ]
  }
  return input.evalTasks
    .filter((task) => !Array.isArray(dig({ value: task, path: ["asserts"] })))
    .map((task) => {
      const id = dig({ value: task, path: ["id"] })
      return {
        axiom: "evals close the loop",
        problem: `eval task \`${typeof id === "string" ? id : "?"}\` has no \`asserts\``,
        remedy:
          "add at least one task-specific assert — a task judged only by the repo gates passes when the agent does nothing",
      }
    })
}

export const runDoctor = (input: DoctorInput): Finding[] => [
  ...checkEvalTasks({
    evalTasks: input.evalTasks,
    evalTasksFileExists: input.evalTasksFileExists,
  }),
  ...checkBiome(input.biome),
  ...checkHooks(input.hooks),
  ...checkCiContract({ ci: input.ci, ruleset: input.ruleset }),
  ...checkSupplyChain({
    workflows: input.workflows,
    bunVersionFileExists: input.bunVersionFileExists,
  }),
  ...checkScheduledAudit(input.workflows),
  ...checkTypecheckCoverage({
    workspaceDirs: input.workspaceDirs,
    tsconfigReferences: input.tsconfigReferences,
  }),
  ...checkCanonRedirect({
    claudeMd: input.claudeMd,
    agentsMd: input.agentsMd,
    docsSyncTestExists: input.docsSyncTestExists,
  }),
  ...checkScriptWiring(input.pkg),
]
