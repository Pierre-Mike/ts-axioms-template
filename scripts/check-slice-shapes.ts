#!/usr/bin/env bun
/**
 * Gate: a feature slice is a CLOSED SET of file shapes.
 *
 * Enforcement attaches to shape — `*.core.ts` is pure, `*.io.ts` /
 * `*.routes.ts` may do I/O. Without this gate the shapes were opt-in: a
 * `utils.ts` inside a slice matched no shape, so it got no purity rules AND no
 * required co-located test (that gate only looks at `*.core.ts`), which let
 * domain logic live in a slice with every axiom unenforced.
 *
 * Here the allowlist is the slice's whole vocabulary: any other `.ts`/`.tsx`
 * file under `features/` fails the required `test` check. Logic therefore has
 * nowhere to hide — it must take a shape, and every shape carries rules.
 * Biome independently treats an unsanctioned slice file as pure-by-default, so
 * both layers fail closed.
 */
import { join } from "node:path"
import { Glob } from "bun"
import { SANCTIONED_SLICE_SHAPES, unsanctionedSliceFiles } from "./slice-shapes.core"

const root = join(import.meta.dir, "..")
const glob = new Glob("**/features/**/*.{ts,tsx}")

const paths: string[] = []
for await (const file of glob.scan({ cwd: root })) {
  if (file.includes("node_modules") || file.includes(".stryker-tmp")) continue
  paths.push(file)
}

const violations = unsanctionedSliceFiles({ paths })

if (violations.length > 0) {
  console.error("✖ unsanctioned file shapes inside a feature slice (ts-axioms: impureim sandwich):")
  for (const violation of violations) console.error(`  ${violation}`)
  console.error("")
  console.error(`  a slice may only contain: ${SANCTIONED_SLICE_SHAPES.join(" ")}`)
  console.error(
    "  → pure domain logic goes in <feature>.core.ts (with its co-located test);\n" +
      "    I/O goes in <feature>.io.ts; the HTTP shell in <feature>.routes.ts;\n" +
      "    contracts shared with another module go in shared/src.",
  )
  process.exit(1)
}
console.error("✓ every file in a feature slice takes a sanctioned shape")
