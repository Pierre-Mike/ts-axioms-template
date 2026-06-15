#!/usr/bin/env bun
/**
 * scaffold:slice — generate a new feature slice in the canonical shape.
 *
 * `bun run scaffold:slice <feature>` (kebab-case) emits the slice files
 * (pure core, co-located tests, Effect repo, Hono routes), mounts the route in
 * api.ts over the shared appRuntime, and registers the live Layer in
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
 * runtime, no I/O, no clock — the shell (*.repo.ts / *.routes.ts) reads the
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

const repoTs = `/**
 * Imperative shell for the \`${name}\` slice — the I/O boundary.
 * Replace the in-memory stub with real I/O; routes depend only on the Tag.
 */
import { Context, Effect, Layer } from "effect"

export interface ${pascal}RepoApi {
  readonly findById: (id: string) => Effect.Effect<{ readonly id: string }>
}

export class ${pascal}Repo extends Context.Tag("${pascal}Repo")<${pascal}Repo, ${pascal}RepoApi>() {}

export const ${pascal}RepoLive: Layer.Layer<${pascal}Repo> = Layer.succeed(${pascal}Repo, {
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
import { ${pascal}Repo } from "./${name}.repo"

export type ${pascal}RouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<${pascal}Repo, never>,
  "runPromise"
>

export const build${pascal}App = (runtime: ${pascal}RouteRuntime) =>
  new Hono().get("/", async (c) => {
    const program = Effect.gen(function* () {
      const id = yield* parse${pascal}Id(c.req.query("id"))
      const repo = yield* ${pascal}Repo
      const entity = yield* repo.findById(id)
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
 * Route-level test: the full impureim sandwich over a stubbed repo Layer
 * (same Tag, fake I/O) — both the happy path and the shared error envelope.
 */
import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ${pascal}Repo, type ${pascal}RepoApi } from "./${name}.repo"
import { build${pascal}App } from "./${name}.routes"

const stubRepo: ${pascal}RepoApi = {
  findById: (id) => Effect.succeed({ id }),
}

const app = build${pascal}App(ManagedRuntime.make(Layer.succeed(${pascal}Repo, stubRepo)))

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
  [`${name}.repo.ts`]: repoTs,
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
  /import \{ (\w+RepoLive) \} from "\.\.\/features\/([^\n]*)\n(?![\s\S]*import \{ \w+RepoLive \})/,
  (m) => `${m}import { ${pascal}RepoLive } from "../features/${name}/${name}.repo"\n`,
)
runtime = runtime.replace(/Layer\.mergeAll\(([^)]*)\)/, `Layer.mergeAll($1, ${pascal}RepoLive)`)
await Bun.write(runtimePath, runtime)
console.error(`registered ${pascal}RepoLive in apps/server/src/platform/runtime.ts`)

// --- register the generated error tag in platform/http.ts STATUS_BY_TAG ------
// Deterministic > prose: the slice ships an `Invalid<X>Id` tagged error, so it
// gets its status here automatically. The check-error-tags gate fails the build
// for any tag this step (or a hand-added one) leaves unmapped — an unmapped tag
// would silently fall through to 400.

const httpPath = join(root, "apps/server/src/platform/http.ts")
let http = await Bun.file(httpPath).text()
if (!/const STATUS_BY_TAG[^{]*\{/.test(http)) {
  fail("http.ts anchor not found: expected `const STATUS_BY_TAG ... = {`")
}
http = http.replace(/(const STATUS_BY_TAG[^{]*\{\n)/, `$1  Invalid${pascal}Id: 400,\n`)
await Bun.write(httpPath, http)
console.error(`registered Invalid${pascal}Id -> 400 in apps/server/src/platform/http.ts`)

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
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
)

console.error(`
next steps:
  1. replace the stub I/O in ${name}.repo.ts with the real thing
  2. grow the pure logic in ${name}.core.ts (+ its co-located test)
  3. Invalid${pascal}Id is registered in platform/http.ts STATUS_BY_TAG; map any
     further error tags there too (the check-error-tags gate fails the build otherwise)
  4. (web) add ${name}.queries.ts + ${name}.route.tsx; promote contracts to shared/
  5. bun run openapi:gen   # register the path in scripts/generate-openapi.ts
  6. bun run verify
`)
