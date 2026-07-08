/**
 * Route-level test for the `notes` slice. Exercises the full impureim
 * sandwich over a FAKE `NotesIo` layer backed by a plain in-memory array
 * (the live `NotesIoLive` is swapped for a `Layer.sync` stub — same Tag,
 * fake I/O), plus one test against the real `NotesIoLive({ dbPath: ":memory:" })`
 * to prove the sqlite-backed live layer actually works.
 */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeNote, decodeNoteList, type Note } from "@ts-axioms/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
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

const makeInMemoryNotesIo = (seed: readonly Note[] = []): NotesIoApi => {
  const notes: Note[] = [...seed]
  let nextId = Math.max(0, ...seed.map((note) => note.id)) + 1
  return {
    count: () => Effect.sync(() => notes.length),
    insert: (note) =>
      Effect.sync(() => {
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

const makeFullSeed = (): Note[] => {
  const seed: Note[] = []
  for (let i = 0; i < NOTE_LIMIT; i++) {
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
})
