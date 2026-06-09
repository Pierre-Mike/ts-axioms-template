#!/usr/bin/env bun
/**
 * PostToolUse hook: instant axiom feedback after every agent edit.
 * Runs Biome on just the edited file so an impureim violation surfaces in the
 * SAME agent turn. Exit code 2 feeds stderr back to the agent as a correction.
 */
interface HookInput {
  readonly tool_input?: { readonly file_path?: string }
}

const payload = (await Bun.stdin.json()) as HookInput
const file = payload.tool_input?.file_path

if (!file || !/\.(ts|tsx|js|jsx|json|jsonc)$/.test(file)) process.exit(0)

const proc = Bun.spawnSync(["bunx", "biome", "check", "--no-errors-on-unmatched", file])

if (proc.exitCode !== 0) {
  console.error(proc.stdout.toString())
  console.error(proc.stderr.toString())
  process.exit(2)
}
