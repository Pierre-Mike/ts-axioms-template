import { describe, expect, it } from "bun:test"
import {
  isGeneratedPath,
  isInSlice,
  isUnsanctionedSliceFile,
  matchesSanctionedShape,
  SANCTIONED_SLICE_SHAPES,
  unsanctionedSliceFiles,
} from "./slice-shapes.core"

describe("isInSlice", () => {
  it("is true anywhere under a features directory, at any depth", () => {
    expect(isInSlice("apps/server/src/features/notes/notes.core.ts")).toBe(true)
    expect(isInSlice("apps/web/src/features/health/deep/nested/thing.ts")).toBe(true)
  })

  it("is false outside a slice", () => {
    expect(isInSlice("apps/server/src/platform/config.ts")).toBe(false)
    expect(isInSlice("shared/src/note.ts")).toBe(false)
    // a path that merely CONTAINS the substring is not a slice
    expect(isInSlice("apps/server/src/featuresque/thing.ts")).toBe(false)
  })
})

describe("matchesSanctionedShape", () => {
  it("accepts every sanctioned shape when a slice name precedes the suffix", () => {
    for (const shape of SANCTIONED_SLICE_SHAPES) {
      expect(matchesSanctionedShape(`apps/server/src/features/notes/notes${shape}`)).toBe(true)
    }
  })

  it("rejects a bare suffix with no name in front of it", () => {
    for (const shape of SANCTIONED_SLICE_SHAPES) {
      expect(matchesSanctionedShape(`apps/server/src/features/notes/${shape}`)).toBe(false)
    }
  })

  it("rejects the names domain logic actually hides in", () => {
    for (const name of ["utils.ts", "helpers.ts", "service.ts", "logic.ts", "types.ts"]) {
      expect(matchesSanctionedShape(`apps/server/src/features/notes/${name}`)).toBe(false)
    }
  })

  it("rejects a near-miss shape", () => {
    // `.repo.ts` / `.model.ts` are not sanctioned — I/O belongs in *.io.ts
    expect(matchesSanctionedShape("apps/server/src/features/notes/notes.repo.ts")).toBe(false)
    expect(matchesSanctionedShape("apps/server/src/features/notes/notes.model.ts")).toBe(false)
    // a *.route.ts (server) is not the web *.route.tsx shape
    expect(matchesSanctionedShape("apps/server/src/features/notes/notes.route.ts")).toBe(false)
  })
})

describe("isGeneratedPath", () => {
  it("treats tsc -b output as generated, not authored — it is shaped like a slice", () => {
    // `tsc -b` emits dist/features/<slice>/<slice>.core.d.ts; judging that as
    // source made the gate fail on a repo that had merely been built.
    expect(isGeneratedPath("apps/server/dist/features/notes/notes.core.d.ts")).toBe(true)
    expect(isGeneratedPath("apps/server/dist/features/notes/helpers.js")).toBe(true)
  })

  it("treats generated route trees and declarations as generated", () => {
    expect(isGeneratedPath("apps/web/src/routeTree.gen.ts")).toBe(true)
    expect(isGeneratedPath("apps/server/src/features/notes/notes.d.ts")).toBe(true)
  })

  it("leaves authored source alone", () => {
    expect(isGeneratedPath("apps/server/src/features/notes/notes.core.ts")).toBe(false)
    expect(isGeneratedPath("apps/server/src/features/notes/utils.ts")).toBe(false)
  })
})

describe("isUnsanctionedSliceFile", () => {
  it("flags the purity-by-filename hole: logic in a non-shape file inside a slice", () => {
    expect(isUnsanctionedSliceFile("apps/server/src/features/notes/utils.ts")).toBe(true)
  })

  it("leaves sanctioned slice files alone", () => {
    expect(isUnsanctionedSliceFile("apps/server/src/features/notes/notes.core.ts")).toBe(false)
    expect(isUnsanctionedSliceFile("apps/server/src/features/notes/notes.io.test.ts")).toBe(false)
    expect(isUnsanctionedSliceFile("apps/web/src/features/notes/notes.route.tsx")).toBe(false)
  })

  it("leaves files outside a slice alone — this gate governs slices only", () => {
    expect(isUnsanctionedSliceFile("apps/server/src/platform/http.ts")).toBe(false)
    expect(isUnsanctionedSliceFile("scripts/check-harness.ts")).toBe(false)
  })

  it("ignores non-TS files inside a slice (assets and docs are not governed)", () => {
    expect(isUnsanctionedSliceFile("apps/server/src/features/notes/README.md")).toBe(false)
    expect(isUnsanctionedSliceFile("apps/web/src/features/notes/notes.css")).toBe(false)
  })

  it("ignores build output so a built tree does not fail the gate", () => {
    expect(isUnsanctionedSliceFile("apps/server/dist/features/notes/notes.core.d.ts")).toBe(false)
  })
})

describe("unsanctionedSliceFiles", () => {
  it("returns only the violations, preserving input order", () => {
    expect(
      unsanctionedSliceFiles({
        paths: [
          "apps/server/src/features/notes/notes.core.ts",
          "apps/server/src/features/notes/helpers.ts",
          "apps/server/src/platform/config.ts",
          "apps/web/src/features/health/health.queries.ts",
          "apps/web/src/features/health/format.tsx",
        ],
      }),
    ).toEqual([
      "apps/server/src/features/notes/helpers.ts",
      "apps/web/src/features/health/format.tsx",
    ])
  })

  it("returns nothing for a clean set", () => {
    expect(
      unsanctionedSliceFiles({ paths: ["apps/server/src/features/notes/notes.routes.ts"] }),
    ).toEqual([])
  })
})
