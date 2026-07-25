/**
 * Route-level test for the `notes` slice. Exercises the full impureim
 * sandwich over a FAKE `NotesIo` layer backed by a plain in-memory array
 * (the live `NotesIoLive` is swapped for a `Layer.sync` stub — same Tag,
 * fake I/O), plus tests against the real `NotesIoLive({ dbPath: ":memory:" })`
 * to prove the sqlite-backed live layer actually works — including that its
 * capacity guard is race-free under concurrent requests.
 */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeNote, decodeNoteList, type Note } from "@ts-axioms/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { checkCapacity } from "./notes.core"
import { NotesIo, type NotesIoApi, NotesIoLive } from "./notes.io"
import { buildNotesApp, NOTE_LIMIT } from "./notes.routes"

const postJson = (input: {
  readonly app: ReturnType<typeof buildNotesApp>
  readonly text: unknown
}) =>
  input.app.request("/", {
    method: "POST",
    body: JSON.stringify({ text: input.text }),
    headers: { "Content-Type": "application/json" },
  })

const postRaw = (input: {
  readonly app: ReturnType<typeof buildNotesApp>
  readonly body: string
}) =>
  input.app.request("/", {
    method: "POST",
    body: input.body,
    headers: { "Content-Type": "application/json" },
  })

/**
 * Same atomicity shape as `NotesIoLive`'s `insertIfUnderCapacityTx`: the
 * count read, the pure capacity decision, and the push happen inside one
 * synchronous callback with no `await`/yield in between, so no other fiber's
 * request can interleave mid-guard.
 */
const makeInMemoryNotesIo = (seed: readonly Note[] = []): NotesIoApi => {
  const notes: Note[] = [...seed]
  let nextId = Math.max(0, ...seed.map((note) => note.id)) + 1
  return {
    insertIfUnderCapacity: (note) =>
      Effect.gen(function* () {
        // Same shape as the pure guard in notes.routes.ts's old sandwich:
        // yield*-ing the Either directly turns a Left into a typed failure.
        yield* checkCapacity({ count: notes.length, limit: note.limit })
        const created: Note = { id: nextId, text: note.text, createdAt: note.createdAt }
        nextId += 1
        notes.push(created)
        return created
      }),
    findById: (id) => Effect.sync(() => notes.find((note) => note.id === id)),
    list: () => Effect.sync(() => notes),
  }
}

const freshApp = (seed: readonly Note[] = []) =>
  buildNotesApp(ManagedRuntime.make(Layer.sync(NotesIo, () => makeInMemoryNotesIo(seed))))

const makeFullSeed = (count: number = NOTE_LIMIT): Note[] => {
  const seed: Note[] = []
  for (let i = 0; i < count; i++) {
    seed.push({ id: i + 1, text: `seed ${i}`, createdAt: i })
  }
  return seed
}

describe("POST /notes", () => {
  it("creates a note and returns 201 with a body that decodes against the shared contract", async () => {
    const res = await postJson({ app: freshApp(), text: "buy milk" })
    expect(res.status).toBe(201)
    const note = decodeNote(await res.json())
    expect(note.text).toBe("buy milk")
    expect(typeof note.id).toBe("number")
    expect(typeof note.createdAt).toBe("number")
  })

  it("maps empty text to the shared 400 error envelope", async () => {
    const res = await postJson({ app: freshApp(), text: "   " })
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteText")
  })

  it("maps at-capacity to the shared 409 error envelope", async () => {
    const res = await postJson({ app: freshApp(makeFullSeed()), text: "one too many" })
    expect(res.status).toBe(409)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("NoteLimitReached")
  })
})

describe("POST /notes request-body validation", () => {
  it("maps malformed JSON to the shared 400 error envelope, not Hono's plaintext 400", async () => {
    const res = await postRaw({ app: freshApp(), body: "{ not valid json" })
    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteBody")
  })

  it("maps a missing text field to the shared 400 error envelope", async () => {
    const res = await postRaw({ app: freshApp(), body: JSON.stringify({}) })
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteBody")
  })

  it("maps a non-string text field to the shared 400 error envelope", async () => {
    const res = await postJson({ app: freshApp(), text: 42 })
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteBody")
  })

  it("maps an excess field on the body to the shared 400 error envelope", async () => {
    const res = await postRaw({
      app: freshApp(),
      body: JSON.stringify({ text: "hi", extra: true }),
    })
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteBody")
  })
})

describe("POST /notes capacity race", () => {
  it("never exceeds NOTE_LIMIT when two requests race at the capacity boundary", async () => {
    const app = freshApp(makeFullSeed(NOTE_LIMIT - 1))

    const [first, second] = await Promise.all([
      postJson({ app, text: "racer one" }),
      postJson({ app, text: "racer two" }),
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])

    const listRes = await app.request("/")
    expect(decodeNoteList(await listRes.json())).toHaveLength(NOTE_LIMIT)
  })
})

describe("GET /notes", () => {
  it("lists created notes, decoding against the shared contract", async () => {
    const app = freshApp()
    await postJson({ app, text: "first" })
    const res = await app.request("/")
    expect(res.status).toBe(200)
    const notes = decodeNoteList(await res.json())
    expect(notes.map((note) => note.text)).toEqual(["first"])
  })

  it("returns an empty list when there are no notes", async () => {
    const res = await freshApp().request("/")
    expect(decodeNoteList(await res.json())).toEqual([])
  })
})

describe("GET /notes/:id", () => {
  it("fetches a single note by id", async () => {
    const app = freshApp()
    const created = decodeNote(await (await postJson({ app, text: "findme" })).json())
    const res = await app.request(`/${created.id}`)
    expect(res.status).toBe(200)
    expect(decodeNote(await res.json())).toEqual(created)
  })

  it("maps a missing id to the shared 404 error envelope", async () => {
    const res = await freshApp().request("/999999")
    expect(res.status).toBe(404)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("NoteNotFound")
  })

  it("maps a non-numeric id to the shared 400 error envelope", async () => {
    const res = await freshApp().request("/not-a-number")
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("InvalidNoteId")
  })
})

describe("NotesIoLive (bun:sqlite)", () => {
  it("creates and lists a note through the real sqlite-backed layer", async () => {
    const liveApp = buildNotesApp(ManagedRuntime.make(NotesIoLive({ dbPath: ":memory:" })))

    const createRes = await postJson({ app: liveApp, text: "real db" })
    expect(createRes.status).toBe(201)

    const listRes = await liveApp.request("/")
    const notes = decodeNoteList(await listRes.json())
    expect(notes).toHaveLength(1)
    expect(notes[0]?.text).toBe("real db")
  })

  it("never exceeds NOTE_LIMIT when two requests race at the capacity boundary", async () => {
    const liveApp = buildNotesApp(ManagedRuntime.make(NotesIoLive({ dbPath: ":memory:" })))

    for (let i = 0; i < NOTE_LIMIT - 1; i++) {
      const seedRes = await postJson({ app: liveApp, text: `seed ${i}` })
      expect(seedRes.status).toBe(201)
    }

    const [first, second] = await Promise.all([
      postJson({ app: liveApp, text: "racer one" }),
      postJson({ app: liveApp, text: "racer two" }),
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])

    const listRes = await liveApp.request("/")
    expect(decodeNoteList(await listRes.json())).toHaveLength(NOTE_LIMIT)
  })
})
