/**
 * Functional core for the error-tag gate — PURE (data-in / data-out).
 *
 * String parsing only: no I/O, no clock, no Effect runtime. The shell
 * (`check-error-tags.ts`) reads the source files and feeds them in. Keeping
 * even a build script as an impureim sandwich is the point of this template.
 */

export interface CoreFile {
  readonly path: string
  readonly source: string
}

export interface UnregisteredTag {
  readonly file: string
  readonly tag: string
}

/** Distinct first-capture-group matches of `re` in `source`. */
const captures = (input: { readonly source: string; readonly re: RegExp }): string[] => {
  const out = new Set<string>()
  for (const match of input.source.matchAll(input.re)) {
    if (match[1] !== undefined) out.add(match[1])
  }
  return [...out]
}

/**
 * Every tag a core constructs via `Either.left({ _tag: "X", ... })`. These are
 * the failures that cross HTTP through `errorEnvelope`, so each one needs a
 * status. Tags on success-side unions (not built in an `Either.left`) are
 * deliberately ignored — they never reach the envelope.
 */
export const extractLeftTags = (source: string): readonly string[] =>
  captures({ source, re: /Either\.left\(\s*\{[^}]*?_tag:\s*"([^"]+)"/g })

/** The tags registered in `platform/http.ts` `STATUS_BY_TAG` (its object keys). */
export const extractRegisteredTags = (httpSource: string): readonly string[] => {
  const block = httpSource.match(/const STATUS_BY_TAG[^{]*\{([\s\S]*?)\}/)
  return block?.[1] === undefined
    ? []
    : captures({ source: block[1], re: /(?:^|\n)\s*["']?([A-Za-z_]\w*)["']?\s*:/g })
}

/**
 * The gate's verdict: every cored `Either.left` tag that has no `STATUS_BY_TAG`
 * entry. Non-empty means the build should fail — those tags would silently
 * fall through to the `?? 400` default at runtime.
 */
export const findUnregisteredTags = (input: {
  readonly cores: readonly CoreFile[]
  readonly registered: readonly string[]
}): readonly UnregisteredTag[] => {
  const known = new Set(input.registered)
  const out: UnregisteredTag[] = []
  for (const core of input.cores) {
    for (const tag of extractLeftTags(core.source)) {
      if (!known.has(tag)) out.push({ file: core.path, tag })
    }
  }
  return out
}
