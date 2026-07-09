#!/usr/bin/env bun
/**
 * scaffold:slice — generate a new feature slice in the canonical shape.
 *
 * `bun run scaffold:slice <feature>` (kebab-case) emits the slice files
 * (pure core, co-located tests, Effect io service, Hono routes), mounts the
 * route in api.ts over the shared appRuntime, and registers the live Layer in
 * platform/runtime.ts. Deterministic scaffolding beats a prose recipe: humans
 * and agents get the exact same, gate-passing shape every time.
 */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

const fail = (msg: string): never => {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

const name = process.argv[2] ?? ""
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  fail("usage: bun run scaffold:slice <feature>  (kebab-case, e.g. user-profile)")
}

const pascal = name
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join("")

const sliceDir = join(root, "apps/server/src/features", name)
if (existsSync(sliceDir)) fail(`slice already exists: apps/server/src/features/${name}`)

// --- slice templates (mirror the canonical `health` slice) -----------------

const coreTs = `/**
 * Functional core for the \`${name}\` slice — PURE.
 *
 * Plain data in, plain data out; failures are values (Either). No Effect
 * runtime, no I/O, no clock — the shell (*.io.ts / *.routes.ts) reads the
 * world and passes it in.
 */
import { Either } from "effect"

export interface ${pascal}Result {
  readonly id: string
  readonly message: string
}

export interface Invalid${pascal}Id {
  readonly _tag: "Invalid${pascal}Id"
  readonly received: string
}

/** Parse the \`?id=\` query param; invalid input is a Left, never a throw. */
export const parse${pascal}Id = (
  raw: string | undefined,
): Either.Either<string, Invalid${pascal}Id> => {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return Either.left({ _tag: "Invalid${pascal}Id", received: raw ?? "" })
  return Either.right(trimmed)
}

/** Build the response payload from already-read inputs. Pure, total. */
export const build${pascal} = (input: { readonly id: string }): ${pascal}Result => ({
  id: input.id,
  message: "${name} works",
})
`

const coreTestTs = `import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import { build${pascal}, parse${pascal}Id } from "./${name}.core"

describe("parse${pascal}Id", () => {
  it("accepts a non-empty id", () => {
    expect(parse${pascal}Id("abc")).toEqual(Either.right("abc"))
  })

  it("returns a tagged Left for a missing id (error-as-value, no throw)", () => {
    const result = parse${pascal}Id(undefined)
    expect(Either.isLeft(result)).toBe(true)
  })
})

describe("build${pascal}", () => {
  it("echoes the id", () => {
    expect(build${pascal}({ id: "abc" })).toEqual({ id: "abc", message: "${name} works" })
  })
})
`

const ioTs = `/**
 * Imperative shell for the \`${name}\` slice — the slice's I/O port (hexagonal
 * sense). Replace the in-memory stub with real I/O; routes depend only on the
 * Tag.
 */
import { Context, Effect, Layer } from "effect"

export interface ${pascal}IoApi {
  readonly findById: (id: string) => Effect.Effect<{ readonly id: string }>
}

export class ${pascal}Io extends Context.Tag("${pascal}Io")<${pascal}Io, ${pascal}IoApi>() {}

export const ${pascal}IoLive: Layer.Layer<${pascal}Io> = Layer.succeed(${pascal}Io, {
  findById: (id) => Effect.succeed({ id }),
})
`

const routesTs = `/**
 * Hono shell for the \`${name}\` slice — the impureim sandwich: impure read
 * through the Effect service, pure core in the middle, shared error envelope
 * on the Left branch. Exports only the builder; api.ts injects the live
 * appRuntime (tests inject a stub runtime over a fake Layer).
 */
import { Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { errorEnvelope } from "../../platform/http"
import { build${pascal}, parse${pascal}Id } from "./${name}.core"
import { ${pascal}Io } from "./${name}.io"

export type ${pascal}RouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<${pascal}Io, never>,
  "runPromise"
>

export const build${pascal}App = (runtime: ${pascal}RouteRuntime) =>
  new Hono().get("/", async (c) => {
    const program = Effect.gen(function* () {
      const id = yield* parse${pascal}Id(c.req.query("id"))
      const io = yield* ${pascal}Io
      const entity = yield* io.findById(id)
      return build${pascal}({ id: entity.id })
    })

    const result = await runtime.runPromise(Effect.either(program))
    if (result._tag === "Left") {
      const { body, status } = errorEnvelope(result.left)
      return c.json(body, status)
    }
    return c.json(result.right)
  })
`

const routesTestTs = `/**
 * Route-level test: the full impureim sandwich over a stubbed io Layer
 * (same Tag, fake I/O) — both the happy path and the shared error envelope.
 */
import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ${pascal}Io, type ${pascal}IoApi } from "./${name}.io"
import { build${pascal}App } from "./${name}.routes"

const stubIo: ${pascal}IoApi = {
  findById: (id) => Effect.succeed({ id }),
}

const app = build${pascal}App(ManagedRuntime.make(Layer.succeed(${pascal}Io, stubIo)))

describe("GET /${name}", () => {
  it("returns the payload for a valid id", async () => {
    const res = await app.request("/?id=abc")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", message: "${name} works" })
  })

  it("maps a missing id to the shared 400 error envelope", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: { _tag: string } }
    expect(body.ok).toBe(false)
    expect(body.error._tag).toBe("Invalid${pascal}Id")
  })
})
`

// --- write files ------------------------------------------------------------

await mkdir(sliceDir, { recursive: true })
const files: Record<string, string> = {
  [`${name}.core.ts`]: coreTs,
  [`${name}.core.test.ts`]: coreTestTs,
  [`${name}.io.ts`]: ioTs,
  [`${name}.routes.ts`]: routesTs,
  [`${name}.routes.test.ts`]: routesTestTs,
}
for (const [file, content] of Object.entries(files)) {
  await Bun.write(join(sliceDir, file), content)
  console.error(`created apps/server/src/features/${name}/${file}`)
}

// --- mount in api.ts ---------------------------------------------------------

const apiPath = join(root, "apps/server/src/api.ts")
let api = await Bun.file(apiPath).text()
const importLine = `import { build${pascal}App } from "./features/${name}/${name}.routes"`
const lastFeatureImport = api.match(
  /import \{ build\w+App \} from "\.\/features\/[^\n]*\n(?![\s\S]*import \{ build\w+App \})/,
)
if (!lastFeatureImport || lastFeatureImport.index === undefined) {
  fail(
    'api.ts anchor not found: expected an existing `import { build<X>App } from "./features/..."` line',
  )
}
const importEnd = (lastFeatureImport?.index ?? 0) + (lastFeatureImport?.[0].length ?? 0)
api = `${api.slice(0, importEnd)}${importLine}\n${api.slice(importEnd)}`

const lastRoute = api.match(
  /\n(\s*)\.route\("[^"]+", build\w+App\(appRuntime\)\)(?![\s\S]*\.route\()/,
)
if (!lastRoute || lastRoute.index === undefined) {
  fail(
    'api.ts anchor not found: expected an existing `.route("/<x>", build<X>App(appRuntime))` call',
  )
}
const routeEnd = (lastRoute?.index ?? 0) + (lastRoute?.[0].length ?? 0)
api = `${api.slice(0, routeEnd)}\n${lastRoute?.[1] ?? "  "}.route("/${name}", build${pascal}App(appRuntime))${api.slice(routeEnd)}`
await Bun.write(apiPath, api)
console.error(`mounted /${name} in apps/server/src/api.ts`)

// --- register the live Layer in platform/runtime.ts --------------------------

const runtimePath = join(root, "apps/server/src/platform/runtime.ts")
let runtime = await Bun.file(runtimePath).text()
if (!runtime.includes("Layer.mergeAll(")) {
  fail("runtime.ts anchor not found: expected `Layer.mergeAll(...)`")
}
runtime = runtime.replace(
  /import \{ (\w+IoLive) \} from "\.\.\/features\/([^\n]*)\n(?![\s\S]*import \{ \w+IoLive \})/,
  (m) => `${m}import { ${pascal}IoLive } from "../features/${name}/${name}.io"\n`,
)
// Prepend as the FIRST mergeAll argument: appending before the closing paren
// would need paren-balanced matching (`[^)]*` breaks on nested calls like
// `NotesIoLive({ dbPath: ... })`); after the opening paren is position-stable
// no matter what the existing layer expressions contain.
runtime = runtime.replace(/Layer\.mergeAll\(/, `Layer.mergeAll(${pascal}IoLive, `)
await Bun.write(runtimePath, runtime)
console.error(`registered ${pascal}IoLive in apps/server/src/platform/runtime.ts`)

// --- register the generated tag in platform/http.ts STATUS_BY_TAG ------------
// STATUS_BY_TAG is an ALLOWLIST: an unregistered tag comes back as a redacted
// InternalServerError 500, so the scaffolded slice's Invalid<X>Id must be
// declared client-safe here or its generated routes test fails on status.

const httpPath = join(root, "apps/server/src/platform/http.ts")
let http = await Bun.file(httpPath).text()
const statusAnchor = /const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = \{\n/
if (!statusAnchor.test(http)) {
  fail("http.ts anchor not found: expected `const STATUS_BY_TAG: Record<...> = {`")
}
http = http.replace(statusAnchor, (m) => `${m}  Invalid${pascal}Id: 400,\n`)
await Bun.write(httpPath, http)
console.error(`registered Invalid${pascal}Id: 400 in apps/server/src/platform/http.ts`)

// --- register a stub OpenAPI path in scripts/generate-openapi.ts -------------
// The generator's route<->spec parity check fails on any undocumented route,
// and verify chains openapi:check — so the scaffolded GET /<name> must be
// documented and openapi.json regenerated for "scaffold -> verify" to be
// green by construction.

const openapiScriptPath = join(root, "scripts/generate-openapi.ts")
let openapiScript = await Bun.file(openapiScriptPath).text()
const pathsAnchor = /\n {2}paths: \{\n/
if (!pathsAnchor.test(openapiScript)) {
  fail("generate-openapi.ts anchor not found: expected `paths: {`")
}
// Prepend as the FIRST paths entry — position-stable regardless of what the
// existing entries contain (same trick as the runtime.ts mergeAll insert).
const specEntry = `    "/${name}": {
      get: {
        summary: "Scaffolded ${name} stub",
        parameters: [
          {
            name: "id",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Echoed id; missing or blank fails as Invalid${pascal}Id (400).",
          },
        ],
        responses: {
          "200": {
            description: "Scaffolded ${name} payload.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" }, message: { type: "string" } },
                  required: ["id", "message"],
                },
              },
            },
          },
          "400": errorResponse,
        },
      },
    },
`
openapiScript = openapiScript.replace(pathsAnchor, (m) => `${m}${specEntry}`)
await Bun.write(openapiScriptPath, openapiScript)
console.error(`registered GET /${name} in scripts/generate-openapi.ts`)

// --- normalize formatting so the result is lint:ci-clean out of the box ------

Bun.spawnSync(
  [
    "bunx",
    "biome",
    "check",
    "--write",
    "--no-errors-on-unmatched",
    sliceDir,
    apiPath,
    runtimePath,
    httpPath,
    openapiScriptPath,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
)

// --- regenerate openapi.json so openapi:check (inside verify) stays green ----

const gen = Bun.spawnSync(["bun", "run", openapiScriptPath], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if (gen.exitCode !== 0) {
  fail("openapi.json regeneration failed — check scripts/generate-openapi.ts")
}

console.error(`
next steps:
  1. replace the stub I/O in ${name}.io.ts with the real thing
  2. grow the pure logic in ${name}.core.ts (+ its co-located test)
  3. map any NEW error tags in platform/http.ts STATUS_BY_TAG (Invalid${pascal}Id is
     already registered; the allowlist redacts unregistered tags to a 500)
  4. (web) add ${name}.queries.ts + ${name}.route.tsx; promote contracts to shared/
  5. grow the stub GET /${name} entry in scripts/generate-openapi.ts as the route
     surface evolves (it is already registered and openapi.json regenerated),
     then re-run: bun run openapi:gen
  6. bun run verify
`)
