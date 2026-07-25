/**
 * Pure classifier for feature-slice file SHAPES.
 *
 * The impureim-sandwich rules attach to file shape (`*.core.ts` is pure,
 * `*.io.ts` / `*.routes.ts` may do I/O). That leaves a hole: a file inside a
 * slice with an UNSANCTIONED name (`utils.ts`, `helpers.ts`, `service.ts`)
 * matched no shape, so domain logic could live there with purity unenforced
 * and — because the co-located-test gate only looks at `*.core.ts` — with no
 * required test either.
 *
 * This module closes it by making the slice a closed set: only the shapes
 * below may exist under `features/`. Anything else fails the `test` gate, so
 * logic has nowhere to hide outside a shape that carries rules. Biome
 * additionally treats any unsanctioned slice file as pure-by-default, so the
 * two layers fail closed independently.
 */

/** Filename suffixes allowed inside a `features/` slice. */
export const SANCTIONED_SLICE_SHAPES: ReadonlyArray<string> = [
  // server slice: pure core, its I/O port, its Hono shell (+ their tests)
  ".core.ts",
  ".core.tsx",
  ".core.test.ts",
  ".core.test.tsx",
  ".io.ts",
  ".io.test.ts",
  ".routes.ts",
  ".routes.test.ts",
  // web slice: queryOptions module and route component (+ their tests)
  ".queries.ts",
  ".queries.test.ts",
  ".route.tsx",
  ".route.test.tsx",
]

/** Extensions this gate governs; assets/docs inside a slice are none of its business. */
const GOVERNED_EXTENSIONS: ReadonlyArray<string> = [".ts", ".tsx"]

/**
 * Directory segments holding build output rather than source. `tsc -b` emits
 * `dist/features/<slice>/<slice>.core.d.ts` — shaped like a slice, but
 * generated, so it must not be judged as authored code.
 */
const BUILD_SEGMENTS: ReadonlyArray<string> = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".stryker-tmp",
  ".vite",
  ".tanstack",
]

/** Suffixes that mark a file as generated rather than hand-written. */
const GENERATED_SUFFIXES: ReadonlyArray<string> = [".d.ts", ".d.tsx", ".gen.ts", ".gen.tsx"]

/** True for build output or generated code — not this gate's business. */
export const isGeneratedPath = (path: string): boolean => {
  const segments = path.split("/")
  return (
    BUILD_SEGMENTS.some((segment) => segments.includes(segment)) ||
    GENERATED_SUFFIXES.some((suffix) => path.endsWith(suffix))
  )
}

const basenameOf = (path: string): string => {
  const segments = path.split("/")
  return segments[segments.length - 1] ?? ""
}

/** True when the path sits anywhere under a directory literally named `features`. */
export const isInSlice = (path: string): boolean => path.split("/").includes("features")

export const isGovernedFile = (path: string): boolean =>
  GOVERNED_EXTENSIONS.some((ext) => path.endsWith(ext))

/**
 * A shape matches only when there is an actual name in front of the suffix —
 * a bare `.core.ts` with no slice name is not a sanctioned shape.
 */
export const matchesSanctionedShape = (path: string): boolean => {
  const basename = basenameOf(path)
  return SANCTIONED_SLICE_SHAPES.some(
    (shape) => basename.endsWith(shape) && basename.length > shape.length,
  )
}

/**
 * The gate's decision for one path: a governed file inside a slice whose name
 * matches no sanctioned shape is a violation.
 */
export const isUnsanctionedSliceFile = (path: string): boolean =>
  isInSlice(path) && isGovernedFile(path) && !isGeneratedPath(path) && !matchesSanctionedShape(path)

/** Every violating path in the scanned set, input order preserved. */
export const unsanctionedSliceFiles = (input: {
  readonly paths: ReadonlyArray<string>
}): ReadonlyArray<string> => input.paths.filter(isUnsanctionedSliceFile)
