#!/usr/bin/env bun
/**
 * Gate: test-first ordering for functional cores (the enforceable slice of TDD).
 *
 * "Co-located tests" proves a test EXISTS; mutation testing proves it
 * CONSTRAINS behaviour. Neither proves the test came FIRST. Full
 * red-green-refactor as a *process* is unprovable post-hoc (squash-merge
 * flattens history; commits can be amended/reordered), so we don't claim to
 * enforce it. What IS enforceable is ordering at commit granularity:
 *
 *   By the time a `<x>.core.ts` first appears on a branch, its sibling
 *   `<x>.core.test.ts` must already exist on that branch — landed in an
 *   earlier branch commit, or at worst the SAME commit.
 *
 * Same-commit is the floor (intra-commit ordering can't be recovered from
 * git), and it is TDD-compatible: a red-green pair committed together still
 * has the test written first. Implementation landing in a commit whose branch
 * history contains no sibling test is the failure this catches.
 *
 * Scope: only NEW cores (first appearance on the branch). Refactors that touch
 * an existing core without touching its test pass — the test already exists.
 *
 * Runs against `base..HEAD` where base = merge-base(origin/main, HEAD). With no
 * resolvable base (offline, or on main with nothing ahead) it is a no-op, so
 * `bun run test` stays green locally and on push-to-main. CI gives it real
 * branch history via `fetch-depth: 0` on the `test` job.
 */
import { join } from "node:path"
import { $ } from "bun"

const root = join(import.meta.dir, "..")
$.cwd(root)

const CORE = /\.core\.(ts|tsx)$/
const isCore = (f: string) =>
  CORE.test(f) && !f.endsWith(".core.test.ts") && !f.endsWith(".core.test.tsx")
const testForCore = (f: string) => f.replace(CORE, ".core.test.$1")

async function resolveBase(): Promise<string | null> {
  try {
    const base = (await $`git merge-base origin/main HEAD`.quiet()).stdout.toString().trim()
    const head = (await $`git rev-parse HEAD`.quiet()).stdout.toString().trim()
    return base && base !== head ? base : null
  } catch {
    return null
  }
}

const base = await resolveBase()
if (!base) {
  console.error("• check-test-first: no branch commits ahead of origin/main — skipped")
  process.exit(0)
}

// Branch commits oldest -> newest, so "earlier commit" means earlier in this list.
const commits = (await $`git rev-list --reverse ${base}..HEAD`.quiet()).stdout
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean)

// A core is "tested as of commit C" once C (or an earlier branch commit) adds
// or modifies its sibling test. `git show --name-status` per commit, in order.
const tested = new Set<string>()
const violations: string[] = []

for (const sha of commits) {
  const raw = (await $`git show --no-renames --name-status --format= ${sha}`.quiet()).stdout
    .toString()
    .trim()
  const lines = raw ? raw.split("\n") : []
  const touched = lines
    .map((l) => l.split("\t"))
    .map(([status, ...path]) => ({ status, file: path.join("\t") }))

  // 1. Register tests touched in THIS commit before judging cores in it
  //    (same-commit test+impl is allowed).
  for (const { file } of touched) {
    if ((file.endsWith(".core.test.ts") || file.endsWith(".core.test.tsx")) && file) {
      tested.add(file.replace(/\.core\.test\.(ts|tsx)$/, ".core.$1"))
    }
  }

  // 2. A core ADDED ("A") in this commit must have a known sibling test by now.
  for (const { status, file } of touched) {
    if (status === "A" && isCore(file) && !tested.has(file)) {
      const short = sha.slice(0, 8)
      violations.push(
        `${file} added in ${short} with no sibling ${testForCore(file)} in that commit or earlier on the branch`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error("✖ implementation landed before its test (ts-axioms: test-first ordering):")
  for (const v of violations) console.error(`  ${v}`)
  console.error("\n  Add the failing test in the same commit as the core (or an earlier one).")
  process.exit(1)
}
console.error(
  `✓ every new *.core.ts on this branch had its test by the time it landed (${commits.length} commit(s) checked)`,
)
