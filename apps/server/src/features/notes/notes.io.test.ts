/**
 * Direct test of the `notes` slice's I/O port. The route test drives the io
 * layer through the HTTP sandwich; this exercises the `NotesIo` service on
 * its own — the real `NotesIoLive({ dbPath: ":memory:" })` behind the Tag —
 * and pins the typed failure contract (`NotesDbError`) the error channel
 * promises.
 */
import { describe, expect, it } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { NotesDbError, NotesIo, NotesIoLive } from "./notes.io"

const runLive = <A, E>(program: Effect.Effect<A, E, NotesIo>) =>
  ManagedRuntime.make(NotesIoLive({ dbPath: ":memory:" })).runPromise(program)

describe("NotesDbError", () => {
  it("is a tagged error that carries the underlying cause verbatim", () => {
    const cause = new Error("disk is on fire")
    const err = new NotesDbError({ cause })
    expect(err._tag).toBe("NotesDbError")
    expect(err.cause).toBe(cause)
  })
})

describe("NotesIoLive service", () => {
  it("inserts, finds by id, and lists through the real sqlite-backed layer", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const io = yield* NotesIo
        const created = yield* io.insertIfUnderCapacity({ text: "hi", createdAt: 7, limit: 10 })
        const found = yield* io.findById(created.id)
        const all = yield* io.list()
        return { created, found, all }
      }),
    )

    expect(typeof result.created.id).toBe("number")
    expect(result.created.text).toBe("hi")
    expect(result.found).toEqual(result.created)
    expect(result.all).toHaveLength(1)
  })

  it("fails with NoteLimitReached (not a defect) when the store is at capacity", async () => {
    const outcome = await runLive(
      Effect.gen(function* () {
        const io = yield* NotesIo
        return yield* Effect.either(
          io.insertIfUnderCapacity({ text: "over", createdAt: 1, limit: 0 }),
        )
      }),
    )

    expect(outcome._tag).toBe("Left")
    if (outcome._tag === "Left") {
      expect(outcome.left._tag).toBe("NoteLimitReached")
    }
  })
})
