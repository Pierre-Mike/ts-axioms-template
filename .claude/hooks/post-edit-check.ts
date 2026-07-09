#!/usr/bin/env bun
/**
 * PostToolUse hook: instant axiom feedback after every agent edit.
 * Runs Biome on just the edited file so an impureim violation surfaces in the
 * SAME agent turn. Exit code 2 feeds stderr back to the agent as a correction.
 */
const payload: unknown = await Bun.stdin.json()
const record =
  typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
const toolInput =
  typeof record.tool_input === "object" && record.tool_input !== null
    ? (record.tool_input as Record<string, unknown>)
    : {}
const file = typeof toolInput.file_path === "string" ? toolInput.file_path : undefined

if (!file || !/\.(ts|tsx|js|jsx|json|jsonc)$/.test(file)) process.exit(0)

const proc = Bun.spawnSync(["bunx", "biome", "check", "--no-errors-on-unmatched", file])

if (proc.exitCode !== 0) {
  console.error(proc.stdout.toString())
  console.error(proc.stderr.toString())
  process.exit(2)
}
