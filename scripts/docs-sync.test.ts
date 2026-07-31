/**
 * CLAUDE.md → AGENTS.md redirect gate. AGENTS.md is the single, tool-neutral
 * canon of agent operating rules; CLAUDE.md must stay a plain redirect that
 * `@AGENTS.md`-imports it for Claude Code. This test fails the build if the
 * redirect is dropped or a copy of the canon is forked back into CLAUDE.md.
 */
import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

const CANON_HEADINGS = [
  "## Architecture: feature-first vertical slices",
  "## The impureim sandwich (critical)",
  "## Other axioms (each enforced by a tool)",
  "## How to add a feature slice",
  "## Gate commands",
]

describe("agent docs", () => {
  it("AGENTS.md carries the full canon", async () => {
    const agents = await Bun.file(join(root, "AGENTS.md")).text()
    for (const heading of CANON_HEADINGS) {
      expect(agents).toContain(heading)
    }
  })

  it("CLAUDE.md is a plain redirect to the AGENTS.md canon", async () => {
    const claude = await Bun.file(join(root, "CLAUDE.md")).text()
    const lines = claude.split("\n").map((line) => line.trim())
    expect(lines).toContain("@AGENTS.md")
    for (const heading of CANON_HEADINGS) {
      expect(claude).not.toContain(heading)
    }
  })
})
