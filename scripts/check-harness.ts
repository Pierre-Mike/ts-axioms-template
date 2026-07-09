#!/usr/bin/env bun
/**
 * Harness doctor — I/O shell. Reads the enforcement stack's config files,
 * hands plain parsed data to the pure checks in harness-doctor.core.ts, and
 * exits 1 with axiom-named findings when a gate has been deleted or unwired.
 *
 * Runs inside `bun run test` (the required `test` CI check, also pre-push via
 * verify), so removing a gate fails the most-watched pipeline in the repo.
 * Dependency-free and sync — it must stay fast enough to run on every test
 * invocation.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type DoctorInput, dig, isRecord, runDoctor, strings } from "./harness-doctor.core"

const textOrNull = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, "utf8") : null

const jsonOrNull = (path: string): unknown => {
  const text = textOrNull(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const yamlOrNull = (path: string): unknown => {
  const text = textOrNull(path)
  if (text === null) return null
  try {
    return Bun.YAML.parse(text)
  } catch {
    return null
  }
}

const isWorkspaceDir = (dir: string): boolean => existsSync(join(dir, "package.json"))

const expandPattern = (input: { readonly root: string; readonly pattern: string }): string[] => {
  if (!input.pattern.endsWith("/*")) {
    return isWorkspaceDir(join(input.root, input.pattern)) ? [input.pattern] : []
  }
  const parent = input.pattern.slice(0, -2)
  const parentAbs = join(input.root, parent)
  if (!existsSync(parentAbs)) return []
  return readdirSync(parentAbs)
    .filter((entry) => isWorkspaceDir(join(parentAbs, entry)))
    .map((entry) => `${parent}/${entry}`)
}

const expandWorkspaces = (input: {
  readonly root: string
  readonly patterns: ReadonlyArray<string>
}): string[] =>
  input.patterns.flatMap((pattern) => expandPattern({ root: input.root, pattern })).sort()

const tsconfigReferencesOf = (tsconfig: unknown): string[] => {
  const references = dig({ value: tsconfig, path: ["references"] })
  if (!Array.isArray(references)) return []
  return references
    .filter(isRecord)
    .flatMap((ref) => (typeof ref.path === "string" ? [ref.path] : []))
}

export const readDoctorInput = (root: string): DoctorInput => {
  const workflowsDir = join(root, ".github", "workflows")
  const workflowNames = existsSync(workflowsDir)
    ? readdirSync(workflowsDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    : []
  const workflows = workflowNames.map((name) => ({
    name,
    text: readFileSync(join(workflowsDir, name), "utf8"),
  }))
  const pkg = jsonOrNull(join(root, "package.json"))
  return {
    biome: jsonOrNull(join(root, "biome.json")),
    hooks: yamlOrNull(join(root, "lefthook.yml")),
    ci: yamlOrNull(join(workflowsDir, "ci.yml")),
    ruleset: jsonOrNull(join(root, ".github", "rulesets", "main.json")),
    pkg,
    workflows,
    bunVersionFileExists: existsSync(join(root, ".bun-version")),
    workspaceDirs: expandWorkspaces({
      root,
      patterns: strings(dig({ value: pkg, path: ["workspaces"] })),
    }),
    tsconfigReferences: tsconfigReferencesOf(jsonOrNull(join(root, "tsconfig.json"))),
    claudeMd: textOrNull(join(root, "CLAUDE.md")),
    agentsMd: textOrNull(join(root, "AGENTS.md")),
    docsSyncTestExists: existsSync(join(root, "scripts", "docs-sync.test.ts")),
  }
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..")
  const findings = runDoctor(readDoctorInput(root))
  if (findings.length > 0) {
    console.error("✖ the harness has decayed (ts-axioms: the harness checks itself):")
    for (const finding of findings) {
      console.error(`  ✖ [${finding.axiom}] ${finding.problem}\n      → ${finding.remedy}`)
    }
    process.exit(1)
  }
  console.error("✓ harness intact — every enforcement gate is present and wired")
}
