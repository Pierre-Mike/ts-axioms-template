/**
 * Hono shell for the `notes` slice.
 *
 * POST / is the multi-step sandwich this slice exists to demonstrate: impure
 * read (parse the body, read the current note count) -> pure decide
 * (validate the text, guard capacity) -> impure write (persist), then
 * respond. GET /:id runs the shorter impure read -> pure decide (404 guard)
 * -> respond shape. Every Left is lifted into Effect by `yield*`-ing it
 * directly, exactly like health.routes.ts, so a typed failure becomes the
 * shared 4xx envelope with no try/catch, no throwing.
 */
import { Clock, Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { validator } from "hono/validator"
import { errorEnvelope } from "../../platform/http"
import { checkCapacity, parseNoteId, requireNote, validateText } from "./notes.core"
import { NotesIo } from "./notes.io"

/** Hardcoded here deliberately — the shell owns policy, not platform/config.ts. */
export const NOTE_LIMIT = 100

export type NotesRouteRuntime = Pick<ManagedRuntime.ManagedRuntime<NotesIo, never>, "runPromise">

export const buildNotesApp = (runtime: NotesRouteRuntime) =>
  new Hono()
    .post(
      "/",
      validator("json", (value) => {
        const record = value as { readonly text?: unknown }
        return { text: typeof record.text === "string" ? record.text : "" }
      }),
      async (c) => {
        const { text: rawText } = c.req.valid("json")
        const program = Effect.gen(function* () {
          // --- pure decide: validate the text ---
          const text = yield* validateText(rawText)
          // --- impure read (shell): current note count ---
          const io = yield* NotesIo
          const count = yield* io.count()
          // --- pure decide: capacity guard ---
          yield* checkCapacity({ count, limit: NOTE_LIMIT })
          // --- impure read (shell): wall-clock for the new note's timestamp ---
          const createdAt = yield* Clock.currentTimeMillis
          // --- impure write (shell): persist ---
          return yield* io.insert({ text, createdAt })
        })

        const result = await runtime.runPromise(Effect.either(program))
        if (result._tag === "Left") {
          const { body, status } = errorEnvelope(result.left)
          return c.json(body, status)
        }
        return c.json(result.right, 201)
      },
    )
    .get("/", async (c) => {
      const program = Effect.gen(function* () {
        const io = yield* NotesIo
        return yield* io.list()
      })
      const notes = await runtime.runPromise(program)
      return c.json(notes)
    })
    .get("/:id", async (c) => {
      const program = Effect.gen(function* () {
        // --- pure guard: parse the :id param ---
        const id = yield* parseNoteId(c.req.param("id"))
        // --- impure read (shell) ---
        const io = yield* NotesIo
        const found = yield* io.findById(id)
        // --- pure decide: 404 when missing ---
        return yield* requireNote({ id, found })
      })

      const result = await runtime.runPromise(Effect.either(program))
      if (result._tag === "Left") {
        const { body, status } = errorEnvelope(result.left)
        return c.json(body, status)
      }
      return c.json(result.right)
    })
