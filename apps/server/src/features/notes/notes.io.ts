/**
 * Imperative shell for the `notes` slice — the slice's I/O port (hexagonal
 * sense). Unlike health.io.ts's clock, this is a genuine repository: a
 * bun:sqlite-backed store behind the `NotesIo` Tag. Routes depend only on
 * the Tag; `NotesIoLive` is parameterized by `dbPath` so the composition
 * root can point at a real file while tests point at `:memory:` — same Tag,
 * real I/O either way.
 */
import { Database } from "bun:sqlite"
import type { Note } from "@ts-axioms/shared"
import { Context, Effect, Layer } from "effect"

export interface NotesIoApi {
  readonly count: () => Effect.Effect<number>
  readonly insert: (note: {
    readonly text: string
    readonly createdAt: number
  }) => Effect.Effect<Note>
  readonly findById: (id: number) => Effect.Effect<Note | undefined>
  readonly list: () => Effect.Effect<readonly Note[]>
}

export class NotesIo extends Context.Tag("NotesIo")<NotesIo, NotesIoApi>() {}

/**
 * Live implementation over bun:sqlite. Prepares each statement once at layer
 * construction and reuses it for the lifetime of the process; `Effect.sync`
 * wraps every call since bun:sqlite is synchronous.
 */
export const NotesIoLive = (opts: { readonly dbPath: string }): Layer.Layer<NotesIo> =>
  Layer.sync(NotesIo, () => {
    const db = new Database(opts.dbPath)
    db.run(
      "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at INTEGER NOT NULL)",
    )

    const countStmt = db.prepare<{ readonly total: number }, []>(
      "SELECT COUNT(*) AS total FROM notes",
    )
    const insertStmt = db.prepare<never, [string, number]>(
      "INSERT INTO notes (text, created_at) VALUES (?, ?)",
    )
    const findByIdStmt = db.prepare<Note, [number]>(
      "SELECT id, text, created_at AS createdAt FROM notes WHERE id = ?",
    )
    const listStmt = db.prepare<Note, []>(
      "SELECT id, text, created_at AS createdAt FROM notes ORDER BY id ASC",
    )

    return {
      count: () => Effect.sync(() => countStmt.get()?.total ?? 0),
      insert: (note) =>
        Effect.sync(() => {
          const { lastInsertRowid } = insertStmt.run(note.text, note.createdAt)
          return { id: Number(lastInsertRowid), text: note.text, createdAt: note.createdAt }
        }),
      findById: (id) => Effect.sync(() => findByIdStmt.get(id) ?? undefined),
      list: () => Effect.sync(() => listStmt.all()),
    }
  })
