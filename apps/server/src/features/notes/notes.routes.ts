/**
 * Hono shell for the `notes` slice.
 *
 * POST / is the multi-step sandwich this slice exists to demonstrate: impure
 * read (parse + decode the body) -> pure decide (validate the text) -> impure
 * read+decide+write, atomically (guard capacity against the current count and
 * persist in one step — see notes.io.ts's `insertIfUnderCapacity`), then
 * respond. GET /:id runs the shorter impure read -> pure decide (404 guard)
 * -> respond shape. Every Left is lifted into Effect by `yield*`-ing it
 * directly, exactly like health.routes.ts, so a typed failure becomes the
 * shared 4xx envelope with no try/catch, no throwing.
 */
import { Clock, Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { runToOutcome } from "../../platform/http"
import {
  type InvalidNoteBody,
  parseCreateNoteRequest,
  parseNoteId,
  requireNote,
  validateText,
} from "./notes.core"
import { NotesIo } from "./notes.io"

/** Hardcoded here deliberately — the shell owns policy, not platform/config.ts. */
export const NOTE_LIMIT = 100

export type NotesRouteRuntime = Pick<ManagedRuntime.ManagedRuntime<NotesIo, never>, "runPromise">

export const buildNotesApp = (runtime: NotesRouteRuntime) =>
  new Hono()
    .post("/", async (c) => {
      const program = Effect.gen(function* () {
        // --- impure read (shell): parse the raw JSON body. Malformed JSON
        // (or no body at all) becomes a typed InvalidNoteBody failure here,
        // never a thrown SyntaxError — so it stays inside the shared
        // ApiErrorBody envelope instead of escaping as Hono's plaintext 400. ---
        const rawBody = yield* Effect.tryPromise({
          try: () => c.req.json<unknown>(),
          catch: (): InvalidNoteBody => ({ _tag: "InvalidNoteBody" }),
        })
        // --- pure decide: decode the body against the shared request contract ---
        const rawText = yield* parseCreateNoteRequest(rawBody)
        // --- pure decide: validate the text ---
        const text = yield* validateText(rawText)
        // --- impure read (shell): wall-clock for the new note's timestamp ---
        const createdAt = yield* Clock.currentTimeMillis
        // --- impure read+decide+write (shell), atomically: guard capacity
        // against the current count and persist in one step, so two
        // concurrent requests can't both pass the guard and overshoot the
        // limit (see notes.io.ts's `insertIfUnderCapacity`) ---
        const io = yield* NotesIo
        return yield* io.insertIfUnderCapacity({ text, createdAt, limit: NOTE_LIMIT })
      })

      const outcome = await runToOutcome({ runtime, program })
      if (!outcome.ok) return c.json(outcome.error.body, outcome.error.status)
      return c.json(outcome.value, 201)
    })
    .get("/", async (c) => {
      const program = Effect.gen(function* () {
        const io = yield* NotesIo
        return yield* io.list()
      })
      const outcome = await runToOutcome({ runtime, program })
      if (!outcome.ok) return c.json(outcome.error.body, outcome.error.status)
      return c.json(outcome.value)
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

      const outcome = await runToOutcome({ runtime, program })
      if (!outcome.ok) return c.json(outcome.error.body, outcome.error.status)
      return c.json(outcome.value)
    })
