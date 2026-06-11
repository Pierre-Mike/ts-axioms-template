#!/usr/bin/env bun
/**
 * PreToolUse hook (Bash): refuse to let the agent bypass the git hooks.
 *
 * The whole point of lefthook (conventional-commit gate, Biome autofix, Fallow
 * audit, typecheck) is that it runs on EVERY commit/push. `--no-verify` and
 * `LEFTHOOK=0` skip all of it — so an agent could land code that the gates
 * would have rejected. Block both. Exit code 2 feeds stderr back as a
 * correction the agent must act on; the fix is to make the gate pass, not to
 * route around it.
 *
 * Wired through `bun run hook:pre-tool-use` so the command is reusable: any
 * other hook event that wants this guard calls the same package.json script.
 */
interface HookInput {
  readonly tool_name?: string
  readonly tool_input?: { readonly command?: string }
}

const payload = (await Bun.stdin.json()) as HookInput

if (payload.tool_name !== "Bash") process.exit(0)

const command = payload.tool_input?.command ?? ""

const BYPASS: ReadonlyArray<readonly [RegExp, string]> = [
  [/--no-verify\b/, "--no-verify"],
  [/(^|\s)-[A-Za-z]*\bn\b(?=[\s=]|$)/, "-n (git commit shorthand for --no-verify)"],
  [/\bLEFTHOOK\s*=\s*(0|false)\b/, "LEFTHOOK=0"],
  [/\bHUSKY\s*=\s*0\b/, "HUSKY=0"],
]

// `-n` is only a hook bypass for `git commit`; it means other things elsewhere
// (e.g. `git log -n 5`, `grep -n`). Scope that one pattern to commit.
const isGitCommit = /\bgit\b[^&|;]*\bcommit\b/.test(command)

for (const [pattern, label] of BYPASS) {
  if (label.startsWith("-n") && !isGitCommit) continue
  if (pattern.test(command)) {
    console.error(`✖ blocked: "${label}" bypasses the git hooks (lefthook).`)
    console.error("  The commit-msg / Biome / audit / typecheck gates must run.")
    console.error("  Fix what the hook would reject, then commit normally.")
    process.exit(2)
  }
}

process.exit(0)
