#!/usr/bin/env bun
/**
 * Functional probe for eval asserts: boot the built server, drive real HTTP
 * against it, print the last response body on stdout, exit non-zero when an
 * expectation misses.
 *
 * Grepping the diff proves an agent typed the right words; this proves the
 * feature actually runs. Every task assert that says "responds 200 with ..."
 * goes through here, so a slice that typechecks but 500s scores zero.
 *
 * Usage (see evals/tasks.jsonl for live examples):
 *   bun evals/probe.ts --path /health --expect-status 200
 *   bun evals/probe.ts --steps '[{"method":"POST","path":"/notes","body":{"text":"x"},
 *                                 "expectStatus":201},{"path":"/digest"}]'
 *
 * Flags: --path --method --body --header 'K: V' --env K=V --expect-status
 *        200[,201] --expect-header 'k=substring' --expect-match TEXT
 *        --expect-match-count 'TEXT=N' --read-ms N (stream mode) --wait-ms N
 *        --steps JSON --server-cmd CMD --boot-timeout-ms N
 *
 * `{{0.id}}` inside a later step's path or body string interpolates step 0's
 * JSON response field, so CRUD chains (create -> patch) are one invocation.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Json } from "./probe.core"
import {
  bodyMismatches,
  headerMismatch,
  interpolate,
  interpolateJson,
  parseEnvFlag,
  parseHeaderExpectation,
  parseHeaderFlag,
  parseStatuses,
  statusAllowed,
} from "./probe.core"

interface Step {
  readonly method?: string
  readonly path?: string
  readonly body?: Json
  readonly headers?: Record<string, string>
  readonly expectStatus?: number | ReadonlyArray<number>
}

const argv = Bun.argv.slice(2)

const flagValues = (name: string): ReadonlyArray<string> =>
  argv.flatMap((arg, index) => (arg === `--${name}` ? [argv[index + 1] ?? ""] : []))

const flag = (name: string): string | undefined => flagValues(name).at(-1)

const numberFlag = (input: { readonly name: string; readonly fallback: number }): number => {
  const raw = flag(input.name)
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : input.fallback
}

const fail = (message: string): never => {
  console.error(`probe: ${message}`)
  process.exit(1)
}

const parseJsonFlag = (input: { readonly name: string; readonly raw: string }): Json => {
  try {
    return JSON.parse(input.raw)
  } catch (cause) {
    return fail(`--${input.name} is not valid JSON: ${String(cause)}`)
  }
}

const parseJsonOrUndefined = (text: string): Json => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// --- server lifetime -------------------------------------------------------

const freePort = async (): Promise<number> => {
  const probeServer = Bun.serve({ port: 0, fetch: () => new Response("") })
  const { port } = probeServer
  await probeServer.stop(true)
  return port
}

const entrypoint = (): string => {
  const explicit = flag("server-cmd")
  if (explicit !== undefined) return explicit
  // apps/server is the shipped name; the rename-survival task moves it to apps/api.
  const candidates = ["apps/server/src/main.ts", "apps/api/src/main.ts"]
  const found = candidates.find((candidate) => Bun.file(candidate).size > 0)
  return found ?? "apps/server/src/main.ts"
}

const envOverrides = (): Record<string, string> =>
  Object.fromEntries(flagValues("env").map((pair) => parseEnvFlag(pair)))

const waitForBoot = async (input: {
  readonly port: number
  readonly timeoutMs: number
  readonly alive: () => boolean
}): Promise<void> => {
  const deadline = Bun.nanoseconds() + input.timeoutMs * 1e6
  while (Bun.nanoseconds() < deadline) {
    if (!input.alive()) fail("server process exited during boot")
    try {
      // Any HTTP answer means the port is live — an auth task may 401 /health's
      // neighbours, and a 404 still proves the server is serving.
      await Bun.fetch(`http://127.0.0.1:${input.port}/health`, { signal: AbortSignal.timeout(500) })
      return
    } catch {
      await Bun.sleep(50)
    }
  }
  fail(`server did not answer on port ${input.port} within ${input.timeoutMs}ms`)
}

// --- expectations ----------------------------------------------------------

const checkStatus = (input: {
  readonly actual: number
  readonly allowed: ReadonlyArray<number>
  readonly label: string
}): void => {
  if (statusAllowed(input)) return
  fail(`${input.label}: expected status ${input.allowed.join("|")}, got ${input.actual}`)
}

const checkHeaders = (response: Response): void => {
  for (const expectation of flagValues("expect-header")) {
    const { name } = parseHeaderExpectation(expectation)
    const message = headerMismatch({ expectation, actual: response.headers.get(name) ?? "" })
    if (message !== null) fail(message)
  }
}

const checkBody = (text: string): void => {
  const messages = bodyMismatches({
    text,
    contains: flagValues("expect-match"),
    counts: flagValues("expect-match-count"),
  })
  const first = messages.at(0)
  if (first !== undefined) fail(first)
}

const drain = async (input: {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
}): Promise<string> => {
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const chunk = await input.reader.read().catch(() => ({ done: true, value: undefined }))
    if (chunk.done) return text
    text += decoder.decode(chunk.value, { stream: true })
  }
}

/** Stream mode: read for `--read-ms`, then cancel. SSE never ends on its own. */
const readForMs = async (input: {
  readonly response: Response
  readonly ms: number
}): Promise<string> => {
  const body = input.response.body
  if (body === null) return ""
  const reader = body.getReader()
  const stop = setTimeout(() => {
    void reader.cancel().catch(() => undefined)
  }, input.ms)
  const text = await drain({ reader })
  clearTimeout(stop)
  return text
}

const headerFlags = (): Record<string, string> =>
  Object.fromEntries(flagValues("header").map((raw) => parseHeaderFlag(raw)))

// --- main ------------------------------------------------------------------

const defaultMethod = (bodyRaw: string | undefined): string =>
  bodyRaw === undefined ? "GET" : "POST"

const singleStep = (): Step => {
  const bodyRaw = flag("body")
  return {
    method: flag("method") ?? defaultMethod(bodyRaw),
    path: flag("path") ?? "/health",
    body: bodyRaw === undefined ? undefined : parseJsonFlag({ name: "body", raw: bodyRaw }),
  }
}

const parseSteps = (): ReadonlyArray<Step> => {
  const raw = flag("steps")
  if (raw === undefined) return [singleStep()]
  const parsed = parseJsonFlag({ name: "steps", raw })
  return Array.isArray(parsed) ? (parsed as ReadonlyArray<Step>) : fail("--steps must be an array")
}

const stepStatuses = (step: Step): ReadonlyArray<number> => {
  if (step.expectStatus === undefined) return []
  return Array.isArray(step.expectStatus) ? step.expectStatus : [step.expectStatus]
}

const steps = parseSteps()

const port = await freePort()
const dataDir = mkdtempSync(join(tmpdir(), "eval-probe-"))
const server = Bun.spawn(["bun", entrypoint()], {
  env: {
    ...Bun.env,
    PORT: String(port),
    NODE_ENV: "test",
    NOTES_DB_PATH: join(dataDir, "app.sqlite"),
    DB_PATH: join(dataDir, "app.sqlite"),
    ...envOverrides(),
  },
  stdout: "pipe",
  stderr: "pipe",
})

let serverAlive = true
void server.exited.then(() => {
  serverAlive = false
})

const shutdown = async (): Promise<void> => {
  server.kill()
  await server.exited.catch(() => undefined)
}

await waitForBoot({
  port,
  timeoutMs: numberFlag({ name: "boot-timeout-ms", fallback: 30_000 }),
  alive: () => serverAlive,
})

const waitMs = numberFlag({ name: "wait-ms", fallback: 0 })
if (waitMs > 0) await Bun.sleep(waitMs)

const readMs = numberFlag({ name: "read-ms", fallback: 0 })
const responses: Json[] = []
let lastText = ""
let lastResponse: Response | undefined

for (const [index, step] of steps.entries()) {
  const path = interpolate({ text: step.path ?? "/health", responses })
  const method = (step.method ?? "GET").toUpperCase()
  const body =
    step.body === undefined
      ? undefined
      : JSON.stringify(interpolateJson({ value: step.body, responses }))
  const response = await Bun.fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headerFlags(),
      ...(step.headers ?? {}),
    },
    body,
    signal: readMs > 0 ? undefined : AbortSignal.timeout(15_000),
  }).catch(async (cause: unknown) => {
    await shutdown()
    return fail(`${method} ${path} failed: ${String(cause)}`)
  })

  const allowed = stepStatuses(step)
  if (!statusAllowed({ actual: response.status, allowed })) {
    const preview = await response.text().catch(() => "")
    await shutdown()
    fail(
      `step ${index} ${method} ${path}: expected ${allowed.join("|")}, got ${response.status} — ${preview.slice(0, 300)}`,
    )
  }

  lastResponse = response
  lastText = readMs > 0 ? await readForMs({ response, ms: readMs }) : await response.text()
  responses.push(parseJsonOrUndefined(lastText))
}

if (lastResponse !== undefined) {
  checkStatus({
    actual: lastResponse.status,
    allowed: parseStatuses(flag("expect-status")),
    label: "final response",
  })
  checkHeaders(lastResponse)
}
checkBody(lastText)

await shutdown()
await Bun.write(Bun.stdout, lastText.endsWith("\n") ? lastText : `${lastText}\n`)
