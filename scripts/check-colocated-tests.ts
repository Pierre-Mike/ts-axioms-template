#!/usr/bin/env bun
/**
 * Gate: every functional core has a co-located, non-stub test.
 *
 * "Co-located tests" is an axiom; this makes it enforced rather than
 * documented — a `<x>.core.ts` without a sibling `<x>.core.test.ts` fails the
 * `test` CI job before any test runs. Runs in `bun run test` (see root
 * package.json). A test file that exists but contains no real test
 * invocation (e.g. a bare `export {}` stub) is treated the same as a missing
 * one — an empty stub satisfies `existsSync` while enforcing nothing.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const root = join(import.meta.dir, "..")
const glob = new Glob("**/*.core.{ts,tsx}")
const missing: string[] = []

const HAS_TEST_INVOCATION = /\b(test|it|describe|bench)\s*\(|\bexpect\s*\(|\btest\.each\b/

for await (const file of glob.scan({ cwd: root })) {
  if (file.includes("node_modules") || file.includes(".stryker-tmp")) continue
  const testFile = file.replace(/\.core\.(ts|tsx)$/, ".core.test.$1")
  const testPath = join(root, testFile)
  if (!existsSync(testPath)) {
    missing.push(`${file} -> expected ${testFile}`)
  } else if (!HAS_TEST_INVOCATION.test(readFileSync(testPath, "utf8"))) {
    missing.push(
      `${file} -> ${testFile} exists but has no test/it/describe/expect invocation (empty stub)`,
    )
  }
}

if (missing.length > 0) {
  console.error("✖ cores without a co-located test (ts-axioms: co-located tests):")
  for (const m of missing) console.error(`  ${m}`)
  process.exit(1)
}
console.error("✓ every *.core.ts has a co-located *.core.test.ts")
