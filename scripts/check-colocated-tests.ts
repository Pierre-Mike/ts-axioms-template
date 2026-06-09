#!/usr/bin/env bun
/**
 * Gate: every functional core has a co-located test.
 *
 * "Co-located tests" is an axiom; this makes it enforced rather than
 * documented — a `<x>.core.ts` without a sibling `<x>.core.test.ts` fails the
 * `test` CI job before any test runs. Runs in `bun run test` (see root
 * package.json).
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const root = join(import.meta.dir, "..")
const glob = new Glob("**/*.core.{ts,tsx}")
const missing: string[] = []

for await (const file of glob.scan({ cwd: root })) {
  if (file.includes("node_modules") || file.includes(".stryker-tmp")) continue
  const testFile = file.replace(/\.core\.(ts|tsx)$/, ".core.test.$1")
  if (!existsSync(join(root, testFile))) missing.push(`${file} -> expected ${testFile}`)
}

if (missing.length > 0) {
  console.error("✖ cores without a co-located test (ts-axioms: co-located tests):")
  for (const m of missing) console.error(`  ${m}`)
  process.exit(1)
}
console.error("✓ every *.core.ts has a co-located *.core.test.ts")
