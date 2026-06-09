#!/usr/bin/env bun
/**
 * commit-msg gate: conventional commits, enforced by lefthook (no
 * commitlint dependency tree — one regex is the whole spec we need).
 * Machine-readable history feeds changelogs, release automation, and agents
 * summarizing or bisecting the repo.
 */
const file = process.argv[2]
if (!file) {
  console.error("usage: check-commit-msg.ts <commit-msg-file>")
  process.exit(2)
}

const firstLine = (await Bun.file(file).text()).split("\n")[0] ?? ""

const CONVENTIONAL =
  /^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([a-z0-9./-]+\))?!?: .{1,72}$/
const EXEMPT = /^(Merge |Revert |fixup! |squash! |Initial commit)/

if (EXEMPT.test(firstLine) || CONVENTIONAL.test(firstLine)) process.exit(0)

console.error(`✖ not a conventional commit subject: "${firstLine}"`)
console.error("  expected: type(scope)?: subject   (<=72 chars)")
console.error("  types: feat fix docs chore refactor perf test build ci style revert")
process.exit(1)
