#!/usr/bin/env bun
/**
 * scaffold:clean — turn the full-stack template into a backend-only repo.
 *
 * Removes apps/web and apps/e2e (the optional UI + browser tiers), drops their
 * project references from the root tsconfig solution, and reinstalls so the
 * lockfile no longer carries their dependency trees. The server slice +
 * tooling plane (Biome/Lefthook/Fallow/Effect/Hono) and CI all keep working.
 */
import { rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const removable = ["apps/web", "apps/e2e"] as const

for (const rel of removable) {
  rmSync(join(root, rel), { recursive: true, force: true })
  console.error(`removed ${rel}`)
}

// Prune the project references from the root tsconfig solution file.
const tsconfigPath = join(root, "tsconfig.json")
const tsconfig = (await Bun.file(tsconfigPath).json()) as {
  references?: { path: string }[]
}
if (Array.isArray(tsconfig.references)) {
  tsconfig.references = tsconfig.references.filter(
    (r) => !removable.some((rel) => r.path.includes(rel.replace("apps/", ""))),
  )
  await Bun.write(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  console.error("pruned root tsconfig references")
}

// Refresh the lockfile so web/e2e deps drop out.
const proc = Bun.spawnSync(["bun", "install"], { cwd: root, stdout: "inherit", stderr: "inherit" })
process.exit(proc.exitCode ?? 0)
