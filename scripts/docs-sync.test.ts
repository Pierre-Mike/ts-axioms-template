/**
 * CLAUDE.md ⇄ AGENTS.md sync gate. Both files promise "must stay in sync";
 * this test makes the promise enforceable: each file wraps its canonical
 * operating rules in `<!-- axioms:start -->` / `<!-- axioms:end -->` markers,
 * and the marked regions must be byte-identical. File-specific preamble lives
 * outside the markers.
 */
import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

const canonOf = async (name: string): Promise<string> => {
  const text = await Bun.file(join(root, name)).text()
  const match = text.match(/<!-- axioms:start -->([\s\S]*?)<!-- axioms:end -->/)
  if (!match || match[1] === undefined) {
    throw new Error(`${name} is missing the <!-- axioms:start/end --> sync markers`)
  }
  return match[1].trim()
}

describe("agent docs", () => {
  it("CLAUDE.md and AGENTS.md share an identical canon section", async () => {
    const claude = await canonOf("CLAUDE.md")
    const agents = await canonOf("AGENTS.md")
    expect(agents).toBe(claude)
  })
})
