/**
 * Probe decisions — PURE. Every judgement the functional probe makes about a
 * response (status allowed? header right? body contains enough?) and every
 * step-chain interpolation lives here as data-in / data-out, so the probe's
 * shell (evals/probe.ts) only does I/O.
 *
 * The eval harness holds itself to the same impureim sandwich it scores other
 * code against — including the part where the branching lives in a tested
 * core rather than in a shell nobody can unit-test.
 */

export type Json = unknown

/** `--expect-header 'content-type=text/event-stream'` -> name + needle. */
export const parseHeaderExpectation = (
  raw: string,
): { readonly name: string; readonly needle: string } => {
  const at = raw.indexOf("=")
  if (at === -1) return { name: raw.trim().toLowerCase(), needle: "" }
  return {
    name: raw.slice(0, at).trim().toLowerCase(),
    needle: raw
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  }
}

/** `--expect-match-count 'data:=2'` -> needle + minimum. */
export const parseCountExpectation = (
  raw: string,
): { readonly needle: string; readonly min: number } => {
  const at = raw.lastIndexOf("=")
  if (at === -1) return { needle: raw, min: 1 }
  const min = Number(raw.slice(at + 1))
  return { needle: raw.slice(0, at), min: Number.isFinite(min) ? min : 1 }
}

/** `--header 'X-API-Key: secret'` -> [name, value]. */
export const parseHeaderFlag = (raw: string): readonly [string, string] => {
  const at = raw.indexOf(":")
  if (at === -1) return [raw, ""]
  return [raw.slice(0, at).trim(), raw.slice(at + 1).trim()]
}

/** `--env KEY=value` -> [key, value]. */
export const parseEnvFlag = (raw: string): readonly [string, string] => {
  const at = raw.indexOf("=")
  if (at === -1) return [raw, ""]
  return [raw.slice(0, at), raw.slice(at + 1)]
}

/** `--expect-status 200,201` -> [200, 201]. An empty list means "don't care". */
export const parseStatuses = (raw: string | undefined): ReadonlyArray<number> =>
  raw === undefined
    ? []
    : raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value))

export const statusAllowed = (input: {
  readonly actual: number
  readonly allowed: ReadonlyArray<number>
}): boolean => input.allowed.length === 0 || input.allowed.includes(input.actual)

export const occurrences = (input: { readonly text: string; readonly needle: string }): number =>
  input.needle === "" ? 0 : input.text.split(input.needle).length - 1

/** Every unmet body expectation, as messages ready for stderr. Empty = pass. */
export const bodyMismatches = (input: {
  readonly text: string
  readonly contains: ReadonlyArray<string>
  readonly counts: ReadonlyArray<string>
}): ReadonlyArray<string> => [
  ...input.contains
    .filter((needle) => !input.text.includes(needle))
    .map((needle) => `expected response body to contain "${needle}"`),
  ...input.counts
    .map((raw) => parseCountExpectation(raw))
    .filter((expected) => occurrences({ text: input.text, needle: expected.needle }) < expected.min)
    .map(
      (expected) =>
        `expected >=${expected.min} occurrences of "${expected.needle}", got ${occurrences({
          text: input.text,
          needle: expected.needle,
        })}`,
    ),
]

export const headerMismatch = (input: {
  readonly expectation: string
  readonly actual: string
}): string | null => {
  const { name, needle } = parseHeaderExpectation(input.expectation)
  return input.actual.toLowerCase().includes(needle)
    ? null
    : `expected header ${name} to contain "${needle}", got "${input.actual}"`
}

const digOnce = (input: { readonly value: Json; readonly key: string }): Json =>
  typeof input.value === "object" && input.value !== null
    ? (input.value as Record<string, Json>)[input.key]
    : undefined

export const dig = (input: { readonly value: Json; readonly path: ReadonlyArray<string> }): Json =>
  input.path.reduce<Json>((acc, key) => digOnce({ value: acc, key }), input.value)

const TOKEN = /\{\{(\d+)\.([\w.]+)\}\}/g

/**
 * Replace `{{0.id}}` with step 0's response field, so a create -> update chain
 * is one probe invocation instead of a shell pipeline.
 */
export const interpolate = (input: {
  readonly text: string
  readonly responses: ReadonlyArray<Json>
}): string =>
  input.text.replace(TOKEN, (whole, indexRaw: string, pathRaw: string) => {
    const value = dig({
      value: input.responses[Number(indexRaw)],
      path: pathRaw.split("."),
    })
    return value === undefined ? whole : String(value)
  })

const interpolateEntries = (input: {
  readonly value: Record<string, Json>
  readonly responses: ReadonlyArray<Json>
}): Json =>
  Object.fromEntries(
    Object.entries(input.value).map(([key, item]) => [
      key,
      interpolateJson({ value: item, responses: input.responses }),
    ]),
  )

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null

/** Same interpolation, applied through a whole JSON body. */
export const interpolateJson = (input: {
  readonly value: Json
  readonly responses: ReadonlyArray<Json>
}): Json => {
  if (typeof input.value === "string") {
    return interpolate({ text: input.value, responses: input.responses })
  }
  if (Array.isArray(input.value)) {
    return input.value.map((item) => interpolateJson({ value: item, responses: input.responses }))
  }
  return isRecord(input.value)
    ? interpolateEntries({ value: input.value, responses: input.responses })
    : input.value
}
