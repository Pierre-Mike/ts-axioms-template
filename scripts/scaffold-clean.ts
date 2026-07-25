#!/usr/bin/env bun
/**
 * scaffold:clean — turn the full-stack template into a backend-only repo.
 *
 * Removes apps/web and apps/e2e (the optional UI + browser tiers), drops their
 * project references from the root tsconfig solution, strips them out of the
 * server Dockerfile / root dev script / CI workflow, and reinstalls so the
 * lockfile no longer carries their dependency trees. The server slice +
 * tooling plane (Biome/Lefthook/Fallow/Effect/Hono) and CI all keep working.
 *
 * Idempotent: every step first checks whether its target still mentions
 * web/e2e, so re-running after a clean is a no-op rather than an error.
 */
import { existsSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const removable = ["apps/web", "apps/e2e"] as const

for (const rel of removable) {
  rmSync(join(root, rel), { recursive: true, force: true })
  console.error(`removed ${rel}`)
}

// Prune the project references from the root tsconfig solution file. Exact
// segment match (not substring) — a substring check on "web" would also
// delete a future `apps/webhooks` reference.
const tsconfigPath = join(root, "tsconfig.json")
const tsconfig: unknown = await Bun.file(tsconfigPath).json()
const hasReferences = (
  value: unknown,
): value is { references: { path: string }[] } & Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  "references" in value &&
  Array.isArray((value as { references: unknown }).references)
const normalizeRefPath = (path: string): string => path.replace(/^\.\//, "").replace(/\/$/, "")
if (hasReferences(tsconfig)) {
  tsconfig.references = tsconfig.references.filter(
    (r) => !removable.some((rel) => normalizeRefPath(r.path) === rel),
  )
  await Bun.write(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  console.error("pruned root tsconfig references")
}

// Strip the web/e2e package.json COPY lines from the server Dockerfile —
// otherwise `docker build` (and infra:up, which builds that image) fails
// looking for directories scaffold:clean just removed.
const dockerfilePath = join(root, "apps/server/Dockerfile")
if (existsSync(dockerfilePath)) {
  const dockerfile = await Bun.file(dockerfilePath).text()
  const patchedDockerfile = dockerfile
    .split("\n")
    .filter((line) => !removable.some((rel) => line.startsWith(`COPY ${rel}/package.json `)))
    .join("\n")
  if (patchedDockerfile !== dockerfile) {
    await Bun.write(dockerfilePath, patchedDockerfile)
    console.error("stripped web/e2e COPY lines from apps/server/Dockerfile")
  }
}

// Drop the removed workspaces from the root `dev` script's `--filter` list —
// `bun --filter '@ts-axioms/web' dev` would otherwise fail to resolve.
const pkgPath = join(root, "package.json")
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
const pkg: unknown = await Bun.file(pkgPath).json()
if (isRecord(pkg) && isRecord(pkg.scripts) && typeof pkg.scripts.dev === "string") {
  const patchedDev = pkg.scripts.dev.replace(/\s*--filter\s+'@ts-axioms\/web'/, "")
  if (patchedDev !== pkg.scripts.dev) {
    pkg.scripts.dev = patchedDev
    await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    console.error("dropped the web filter from the root `dev` script")
  }
}

// Remove the e2e job from the CI workflow — apps/e2e is gone, so the job
// would fail every run otherwise. Structural removal (next top-level job key
// or EOF is the boundary) rather than a comment-text match, so it survives
// unrelated edits to the job's own comments.
//
// Each sub-step below is its own small, single-branch-family helper —
// `removeYamlJob` just sequences them — so no one function accumulates the
// branching of "find the job, trim its comments, find the next job, trim
// THAT job's comments" all at once.

const isJobKeyLine = (line: string | undefined): boolean => /^ {2}[A-Za-z_-]+:/.test(line ?? "")
const isCommentLine = (line: string | undefined): boolean => /^ {2}#/.test(line ?? "")

/** First index >= `from` that starts a new top-level job (or EOF). */
const findNextJobKeyIndex = (input: {
  readonly lines: readonly string[]
  readonly from: number
}): number => {
  let i = input.from
  while (i < input.lines.length && !isJobKeyLine(input.lines[i])) i += 1
  return i
}

type BoundedIndex = {
  readonly lines: readonly string[]
  readonly index: number
  readonly floor: number
}

/** Walk `index` back over consecutive comment lines, without crossing `floor`. */
const skipCommentBlock = (input: BoundedIndex): number => {
  let i = input.index
  while (i > input.floor) {
    if (!isCommentLine(input.lines[i - 1])) break
    i -= 1
  }
  return i
}

/** Step `index` back one line if it's a blank separator, without crossing `floor`. */
const skipBlankSeparator = (input: BoundedIndex): number => {
  if (input.index <= input.floor) return input.index
  return input.lines[input.index - 1] === "" ? input.index - 1 : input.index
}

/**
 * Walk `index` back over a leading comment block and its blank-line
 * separator, without crossing `floor`. Used both to trim a job's OWN
 * comments (floor 0) and to keep a removal boundary from swallowing the
 * NEXT job's comments (floor = that job's own header).
 */
const backOffPastCommentBlock = (input: BoundedIndex): number =>
  skipBlankSeparator({ ...input, index: skipCommentBlock(input) })

const removeYamlJob = (input: { readonly yaml: string; readonly jobName: string }): string => {
  const lines = input.yaml.split("\n")
  const header = lines.indexOf(`  ${input.jobName}:`)
  if (header === -1) return input.yaml

  const start = backOffPastCommentBlock({ lines, index: header, floor: 0 })
  const nextJobKey = findNextJobKeyIndex({ lines, from: header + 1 })
  const end = backOffPastCommentBlock({ lines, index: nextJobKey, floor: header + 1 })

  return [...lines.slice(0, start), ...lines.slice(end)].join("\n")
}
const ciPath = join(root, ".github/workflows/ci.yml")
if (existsSync(ciPath)) {
  const ci = await Bun.file(ciPath).text()
  const patchedCi = removeYamlJob({ yaml: ci, jobName: "e2e" })
  if (patchedCi !== ci) {
    await Bun.write(ciPath, patchedCi)
    console.error("removed the e2e job from .github/workflows/ci.yml")
  }
}

// Refresh the lockfile so web/e2e deps drop out.
const proc = Bun.spawnSync(["bun", "install"], { cwd: root, stdout: "inherit", stderr: "inherit" })
process.exit(proc.exitCode ?? 0)
