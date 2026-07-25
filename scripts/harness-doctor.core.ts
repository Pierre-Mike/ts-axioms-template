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

/** A Biome rule value is either shorthand (`"error"`) or `{ level, options }`. */
const ruleLevelOf = (rule: unknown): string | undefined => {
  if (typeof rule === "string") return rule
  return isRecord(rule) && typeof rule.level === "string" ? rule.level : undefined
}

/**
 * Positive scope entries only. A leading `!` is an EXCLUSION, so an override
 * that negates a shape out of its scope (`"!**\/*.io.ts"`) must not be read as
 * scoped TO it — otherwise the doctor folds the wrong override's rules and
 * reports a healthy config as decayed.
 */
const scopeEntriesOf = (override: Rec): ReadonlyArray<string> =>
  strings(override.includes).filter((entry) => !entry.startsWith("!"))

const includesShape =
  (shape: string) =>
  (override: Rec): boolean =>
    scopeEntriesOf(override).includes(shape)

const includesSuffix =
  (suffix: string) =>
  (override: Rec): boolean =>
    scopeEntriesOf(override).some((entry) => entry.endsWith(suffix))

/**
 * Biome applies overrides in array order; for a given rule path, the LAST
 * override matching a shape wins wholesale over the top-level declaration and
 * any earlier match (verified empirically against Biome 2.4 — rule options
 * replace wholesale per matching override). A plain `.find()` only sees the
 * FIRST match, which is blind to a later override that quietly weakens or
 * empties the same rule for the same shape.
 */
const effectiveRuleNode = (input: {
  readonly biome: unknown
  readonly matches: (override: Rec) => boolean
  readonly rulePath: ReadonlyArray<string>
}): unknown => {
  const path = ["linter", "rules", ...input.rulePath]
  let effective = dig({ value: input.biome, path })
  for (const override of overridesOf(input.biome).filter(input.matches)) {
    const candidate = dig({ value: override, path })
    if (candidate !== undefined) effective = candidate
  }
  return effective
}

const deniedGlobalNamesOf = (noRestrictedGlobalsRule: unknown): ReadonlyArray<string> => {
  const denied = dig({ value: noRestrictedGlobalsRule, path: ["options", "deniedGlobals"] })
  return isRecord(denied) ? Object.keys(denied) : []
}

const patternGroupsOf = (noRestrictedImportsRule: unknown): ReadonlyArray<string> => {
  const patterns = dig({ value: noRestrictedImportsRule, path: ["options", "patterns"] })
  if (!Array.isArray(patterns)) return []
  return patterns.flatMap((pattern) => (isRecord(pattern) ? strings(pattern.group) : []))
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

/** The sibling-slice ban entry that must survive in the *.core.ts override's patterns. */
const CORE_SIBLING_PATTERN = "../*/*.core"

const BIOME_AXIOM = "fail-closed lint scoping"

const CORE_SHAPE = "**/*.core.ts"
const IO_SHAPE_SUFFIX = "*.io.ts"
const MAIN_SHAPE = "**/main.ts"

/** The fail-closed catch-all: every slice file that is NOT a sanctioned shape. */
const SLICE_DEFAULT_SHAPE = "**/features/**/*.ts"
const SLICE_DOOR_SHAPE = "**/features/**"

/** Grit plugins that only enforce core purity if scoped to the *.core.ts override itself. */
const CORE_SCOPED_PLUGINS: ReadonlyArray<string> = [
  "no-throw-in-core.grit",
  "no-await-in-core.grit",
]

const levelFinding = (input: {
  readonly axiom: string
  readonly shape: string
  readonly rule: unknown
}): Finding[] =>
  ruleLevelOf(input.rule) === "error"
    ? []
    : [
        {
          axiom: input.axiom,
          problem: `the effective ${input.shape} noRestrictedGlobals rule is not at level "error" (found ${JSON.stringify(ruleLevelOf(input.rule) ?? null)}) — a trailing override or a flip to "off"/"warn" silently disables enforcement`,
          remedy: `keep noRestrictedGlobals at level "error" for every override matching ${input.shape} — check for a trailing override that weakens it`,
        },
      ]

const checkBiomeCoreOverride = (biome: unknown): Finding[] => {
  const matches = includesShape(CORE_SHAPE)
  const hasOverride = overridesOf(biome).some(matches)
  if (!hasOverride) {
    return [
      {
        axiom: "impureim sandwich",
        problem: "biome.json has no override scoped to **/*.core.ts — core purity is unenforced",
        remedy:
          "restore the *.core.ts override: denied globals (Date/Promise/console/process/setTimeout/setInterval), the effect-runtime import ban, and the no-throw/no-await plugins",
      },
    ]
  }
  const globalsRule = effectiveRuleNode({
    biome,
    matches,
    rulePath: ["style", "noRestrictedGlobals"],
  })
  const denied = deniedGlobalNamesOf(globalsRule)
  const missingGlobals = CORE_DENIED_GLOBALS.filter((name) => !denied.includes(name)).map(
    (name) => ({
      axiom: "impureim sandwich",
      problem: `the effective **/*.core.ts override no longer denies the global \`${name}\``,
      remedy: `re-add \`${name}\` to deniedGlobals in the *.core.ts override — core must stay pure (data in, data out)`,
    }),
  )
  const importsRule = effectiveRuleNode({
    biome,
    matches,
    rulePath: ["style", "noRestrictedImports"],
  })
  const importNames = strings(
    dig({ value: importsRule, path: ["options", "paths", "effect", "importNames"] }),
  )
  const missingImportBans = EFFECT_RUNTIME_NAMES.filter((name) => !importNames.includes(name)).map(
    (name) => ({
      axiom: "impureim sandwich",
      problem: `the effective **/*.core.ts override no longer bans importing \`${name}\` from effect`,
      remedy:
        "restore the effect-runtime import ban (Effect/Layer/Context/ManagedRuntime/Runtime) in the *.core.ts override",
    }),
  )
  const siblingBan: Finding[] = patternGroupsOf(importsRule).includes(CORE_SIBLING_PATTERN)
    ? []
    : [
        {
          axiom: "modules talk through doors",
          problem:
            "the effective **/*.core.ts override no longer bans importing a sibling slice's internals (../*/*.core pattern in noRestrictedImports.patterns)",
          remedy:
            "restore the sibling-slice ban pattern group in the *.core.ts override's noRestrictedImports.patterns",
        },
      ]
  return [
    ...missingGlobals,
    ...levelFinding({ axiom: "impureim sandwich", shape: CORE_SHAPE, rule: globalsRule }),
    ...missingImportBans,
    ...siblingBan,
  ]
}

const checkBiomePlugins = (biome: unknown): Finding[] => {
  const registeredAnywhere = [
    ...strings(dig({ value: biome, path: ["plugins"] })),
    ...overridesOf(biome).flatMap((override) => strings(override.plugins)),
  ]
  const anywhereFindings = REQUIRED_PLUGINS.filter(
    (plugin) => !CORE_SCOPED_PLUGINS.includes(plugin),
  )
    .filter((plugin) => !registeredAnywhere.some((entry) => entry.endsWith(plugin)))
    .map((plugin) => ({
      axiom: BIOME_AXIOM,
      problem: `grit plugin ${plugin} is not registered in biome.json`,
      remedy: `re-register ./biome-plugins/${plugin} (top-level or in the override that owns it) — deleting a plugin deletes the axiom it enforces`,
    }))
  const registeredOnCore = overridesOf(biome)
    .filter(includesShape(CORE_SHAPE))
    .flatMap((override) => strings(override.plugins))
  const coreScopedFindings = CORE_SCOPED_PLUGINS.filter(
    (plugin) => !registeredOnCore.some((entry) => entry.endsWith(plugin)),
  ).map((plugin) => ({
    axiom: BIOME_AXIOM,
    problem: `grit plugin ${plugin} is not registered on the override scoped to **/*.core.ts — registering it elsewhere doesn't enforce core purity`,
    remedy: `register ./biome-plugins/${plugin} on the **/*.core.ts override specifically`,
  }))
  return [...anywhereFindings, ...coreScopedFindings]
}

const checkBiomeGlobalDenials = (biome: unknown): Finding[] => {
  const rule = dig({ value: biome, path: ["linter", "rules", "style", "noRestrictedGlobals"] })
  const topDenied = deniedGlobalNamesOf(rule)
  const missing = ["fetch", "process"]
    .filter((name) => !topDenied.includes(name))
    .map((name) => ({
      axiom: BIOME_AXIOM,
      problem: `the global \`${name}\` is no longer denied at the top level of biome.json`,
      remedy: `deny \`${name}\` globally and re-allow only at sanctioned shapes — path-scoped denials fail OPEN when an app is renamed`,
    }))
  return [
    ...missing,
    ...levelFinding({ axiom: BIOME_AXIOM, shape: "the top-level biome.json", rule }),
  ]
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
  const matches = includesSuffix(IO_SHAPE_SUFFIX)
  const hasOverride = overridesOf(biome).some(matches)
  if (!hasOverride) {
    return [
      {
        axiom: BIOME_AXIOM,
        problem: "the *.io.ts override that re-allows fetch (the sanctioned I/O port) is missing",
        remedy:
          "restore the **/*.io.ts override re-declaring deniedGlobals without fetch — otherwise slices have no sanctioned place for external I/O",
      },
    ]
  }
  const rule = effectiveRuleNode({ biome, matches, rulePath: ["style", "noRestrictedGlobals"] })
  const denied = deniedGlobalNamesOf(rule)
  const fetchFinding: Finding[] = denied.includes("fetch")
    ? [
        {
          axiom: BIOME_AXIOM,
          problem:
            "the effective **/*.io.ts noRestrictedGlobals rule still denies `fetch` — the sanctioned I/O port has no way to make external calls",
          remedy: "the *.io.ts override must re-declare deniedGlobals without `fetch`",
        },
      ]
    : []
  const processFinding: Finding[] = denied.includes("process")
    ? []
    : [
        {
          axiom: BIOME_AXIOM,
          problem:
            "the effective **/*.io.ts noRestrictedGlobals rule no longer denies `process` — typed config at boot is unenforced for I/O services",
          remedy: "restore `process` in the *.io.ts override's deniedGlobals",
        },
      ]
  return [
    ...fetchFinding,
    ...processFinding,
    ...levelFinding({ axiom: BIOME_AXIOM, shape: "**/*.io.ts", rule }),
  ]
}

const checkBiomeMainOverride = (biome: unknown): Finding[] => {
  const matches = includesShape(MAIN_SHAPE)
  const hasOverride = overridesOf(biome).some(matches)
  if (!hasOverride) {
    return [
      {
        axiom: BIOME_AXIOM,
        problem:
          "biome.json has no override scoped to **/main.ts — the composition root's globals are unscoped",
        remedy:
          'restore the **/main.ts override denying `fetch` at level "error" (console is the sanctioned exception there)',
      },
    ]
  }
  const rule = effectiveRuleNode({ biome, matches, rulePath: ["style", "noRestrictedGlobals"] })
  const denied = deniedGlobalNamesOf(rule)
  const fetchFinding: Finding[] = denied.includes("fetch")
    ? []
    : [
        {
          axiom: BIOME_AXIOM,
          problem: "the effective **/main.ts noRestrictedGlobals rule no longer denies `fetch`",
          remedy:
            "restore `fetch` in the **/main.ts override's deniedGlobals — main.ts must still use the sanctioned *.io.ts port for external calls",
        },
      ]
  return [...fetchFinding, ...levelFinding({ axiom: BIOME_AXIOM, shape: MAIN_SHAPE, rule })]
}

/**
 * The fail-closed slice default. Without this override, purity is opt-in by
 * FILENAME: every purity rule is scoped to `**\/*.core.ts`, so a file inside a
 * slice named anything else (`utils.ts`, `service.ts`) matched no shape and
 * inherited no rules — domain logic could sit in a slice with the clock, the
 * env, `throw`, `await` and the Effect runtime all unguarded, and with no
 * required co-located test either (that gate only looks at `*.core.ts`).
 */
const sliceDefaultMissing: Finding = {
  axiom: "impureim sandwich",
  problem:
    "biome.json has no override scoped to **/features/**/*.ts — purity is opt-in by FILENAME again: a slice file whose name matches no sanctioned shape (utils.ts, helpers.ts, service.ts) inherits no purity rules",
  remedy:
    "restore the fail-closed slice-default override as the LAST entry in overrides: purity globals + the effect-runtime import ban + the no-throw/no-await plugins, with the sanctioned shapes (*.core.ts / *.io.ts / *.routes.ts / *.queries.ts / *.route.tsx / *.test.*) negated out",
}

const sliceDefaultGlobalFindings = (rule: unknown): Finding[] =>
  CORE_DENIED_GLOBALS.filter((name) => !deniedGlobalNamesOf(rule).includes(name)).map((name) => ({
    axiom: "impureim sandwich",
    problem: `the effective ${SLICE_DEFAULT_SHAPE} override no longer denies the global \`${name}\``,
    remedy: `re-add \`${name}\` to the slice-default override's deniedGlobals — an unsanctioned slice file must be treated as pure`,
  }))

const sliceDefaultImportFindings = (rule: unknown): Finding[] => {
  const importNames = strings(
    dig({ value: rule, path: ["options", "paths", "effect", "importNames"] }),
  )
  const effectBan = EFFECT_RUNTIME_NAMES.filter((name) => !importNames.includes(name)).map(
    (name) => ({
      axiom: "impureim sandwich",
      problem: `the effective ${SLICE_DEFAULT_SHAPE} override no longer bans importing \`${name}\` from effect`,
      remedy:
        "restore the effect-runtime import ban in the slice-default override — the Effect runtime belongs to *.io.ts / *.routes.ts / main.ts",
    }),
  )
  const doorBan: Finding[] = patternGroupsOf(rule).includes(CORE_SIBLING_PATTERN)
    ? []
    : [
        {
          axiom: "modules talk through doors",
          problem: `the effective ${SLICE_DEFAULT_SHAPE} override no longer bans a sibling slice's internals (${CORE_SIBLING_PATTERN})`,
          remedy:
            "restate the sibling-slice ban in the slice-default override — being last, it replaces the door override's patterns wholesale rather than inheriting them",
        },
      ]
  return [...effectBan, ...doorBan]
}

const sliceDefaultPluginFindings = (input: {
  readonly overrides: ReadonlyArray<Rec>
  readonly matches: (override: Rec) => boolean
}): Finding[] => {
  const registered = input.overrides
    .filter(input.matches)
    .flatMap((override) => strings(override.plugins))
  return CORE_SCOPED_PLUGINS.filter(
    (plugin) => !registered.some((entry) => entry.endsWith(plugin)),
  ).map((plugin) => ({
    axiom: BIOME_AXIOM,
    problem: `grit plugin ${plugin} is not registered on the ${SLICE_DEFAULT_SHAPE} override — an unsanctioned slice file could still throw/await`,
    remedy: `register ./biome-plugins/${plugin} on the slice-default override as well as the *.core.ts one`,
  }))
}

/**
 * Order matters: rule options replace wholesale on the LAST matching override,
 * so a door override declared after the slice default would silently drop the
 * purity rules for exactly the files this check exists to protect.
 */
const sliceDefaultOrderFindings = (input: {
  readonly overrides: ReadonlyArray<Rec>
  readonly index: number
}): Finding[] => {
  const doorIndex = input.overrides.findIndex(includesShape(SLICE_DOOR_SHAPE))
  return doorIndex === -1 || doorIndex < input.index
    ? []
    : [
        {
          axiom: BIOME_AXIOM,
          problem: `the ${SLICE_DEFAULT_SHAPE} override is declared BEFORE the ${SLICE_DOOR_SHAPE} override — the later one replaces its rules wholesale, so slice-default purity is dead config`,
          remedy: `move the slice-default override after the ${SLICE_DOOR_SHAPE} override (keep it last in the array)`,
        },
      ]
}

const checkBiomeSliceDefault = (biome: unknown): Finding[] => {
  const matches = includesShape(SLICE_DEFAULT_SHAPE)
  const overrides = overridesOf(biome)
  const index = overrides.findIndex(matches)
  if (index === -1) return [sliceDefaultMissing]
  const globalsRule = effectiveRuleNode({
    biome,
    matches,
    rulePath: ["style", "noRestrictedGlobals"],
  })
  return [
    ...sliceDefaultGlobalFindings(globalsRule),
    ...levelFinding({ axiom: "impureim sandwich", shape: SLICE_DEFAULT_SHAPE, rule: globalsRule }),
    ...sliceDefaultImportFindings(
      effectiveRuleNode({ biome, matches, rulePath: ["style", "noRestrictedImports"] }),
    ),
    ...sliceDefaultPluginFindings({ overrides, matches }),
    ...sliceDefaultOrderFindings({ overrides, index }),
  ]
}

export const checkBiome = (biome: unknown): Finding[] => [
  ...checkBiomeGlobalDenials(biome),
  ...checkBiomeDoorBan(biome),
  ...checkBiomeIoPort(biome),
  ...checkBiomeMainOverride(biome),
  ...checkBiomeCoreOverride(biome),
  ...checkBiomeSliceDefault(biome),
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
  const text = query.text
  return CANON_MARKERS.filter((marker) => !text.includes(marker)).map((marker) => ({
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
  const syncTest: Finding[] = input.docsSyncTestExists
    ? []
    : [
        {
          axiom: "canon sync",
          problem:
            "scripts/docs-sync.test.ts is missing — canon drift between CLAUDE.md and AGENTS.md is unchecked",
          remedy:
            "restore the docs-sync test; it fails the build when the marked canon regions differ",
        },
      ]
  return [
    ...checkCanonFile({ name: "CLAUDE.md", text: input.claudeMd }),
    ...checkCanonFile({ name: "AGENTS.md", text: input.agentsMd }),
    ...syncTest,
  ]
}

const VERIFY_GATES = ["lint:ci", "typecheck", "test", "audit"]
const TEST_META_GATES = ["check-colocated-tests", "check-slice-shapes", "check-harness"]

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
