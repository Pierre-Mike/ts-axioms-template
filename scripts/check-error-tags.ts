#!/usr/bin/env bun
/**
 * Gate: every tagged error a core returns has an HTTP status.
 *
 * "One error shape" is an axiom — failures cross HTTP as the shared
 * `ApiErrorBody` envelope, with the tag→status map in `platform/http.ts`
 * `STATUS_BY_TAG`. An unregistered tag silently falls through to the `?? 400`
 * default at request time; this makes that omission fail the build LOUDLY
 * instead (documented → enforced; no enforcement, no rule). Impure shell:
 * reads the source files, calls the pure core, exits. Runs in `bun run test`.
 */
import { join } from "node:path"
import { Glob } from "bun"
import { extractRegisteredTags, findUnregisteredTags } from "./error-tags.core"

const root = join(import.meta.dir, "..")

const httpSource = await Bun.file(join(root, "apps/server/src/platform/http.ts")).text()
const registered = extractRegisteredTags(httpSource)

const cores: { path: string; source: string }[] = []
const glob = new Glob("apps/server/src/features/**/*.core.{ts,tsx}")
for await (const file of glob.scan({ cwd: root })) {
  if (file.includes("node_modules") || file.includes(".stryker-tmp")) continue
  cores.push({ path: file, source: await Bun.file(join(root, file)).text() })
}

const unregistered = findUnregisteredTags({ cores, registered })

if (unregistered.length > 0) {
  console.error("✖ error tags returned by a core but missing from STATUS_BY_TAG (ts-axioms: one")
  console.error("  error shape) — an unmapped tag silently becomes HTTP 400 at runtime:")
  for (const u of unregistered) console.error(`  ${u.file} -> "${u.tag}"`)
  console.error("  fix: add each tag to apps/server/src/platform/http.ts STATUS_BY_TAG")
  process.exit(1)
}
console.error("✓ every cored Either.left tag is registered in STATUS_BY_TAG")
