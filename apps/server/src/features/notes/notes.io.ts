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
import { Context, Data, Effect, Either, Layer } from "effect"
import { checkCapacity, type NoteLimitReached } from "./notes.core"

/**
 * Typed failure for the sqlite-backed operations below. bun:sqlite calls are
 * synchronous and can throw (e.g. a corrupt file, a disk error); wrapping
 * every call in `Effect.try` turns that throw into this tagged value instead
 * of letting it escape as a defect that bypasses the `Either` boundary
 * entirely (ts-axioms: one error shape). Deliberately left OUT of
 * platform/http.ts's `STATUS_BY_TAG` allowlist: `cause` is an intentionally
 * open, unvalidated payload (whatever bun:sqlite/JS threw) and the allowlist
 * sends a registered tag's full payload to the client verbatim — so this
 * redacts to the generic `InternalServerError` 500 (same client-visible
 * shape a defect would have produced), while still being a proper typed
 * value internally: `Effect.either` can observe it, and tests can assert on
 * it without needing to trigger a real defect.
 */
export class NotesDbError extends Data.TaggedError("NotesDbError")<{
  readonly cause: unknown
}> {}

export interface NotesIoApi {
  /**
   * Atomically check capacity and insert. The capacity check (read count)
   * and the write (insert) must happen as one indivisible step — otherwise
   * two concurrent callers can both read a count just under `limit`, both
   * pass the guard, and both insert, overshooting it (a classic
   * check-then-act race). See `NotesIoLive` below for how the single
   * bun:sqlite transaction enforces that.
   */
  readonly insertIfUnderCapacity: (note: {
    readonly text: string
    readonly createdAt: number
    readonly limit: number
  }) => Effect.Effect<Note, NoteLimitReached | NotesDbError>
  readonly findById: (id: number) => Effect.Effect<Note | undefined, NotesDbError>
  readonly list: () => Effect.Effect<readonly Note[], NotesDbError>
}

export class NotesIo extends Context.Tag("NotesIo")<NotesIo, NotesIoApi>() {}

/**
 * Live implementation over bun:sqlite. Prepares each statement once at layer
 * construction and reuses it for the lifetime of the process; `Effect.try`
 * wraps every call since bun:sqlite is synchronous and can throw.
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

    /**
     * The count read, the pure capacity decision, and the insert run inside
     * ONE bun:sqlite transaction — a single synchronous JS function from
     * start to finish. That single-function shape is what actually closes
     * the race: the whole read-decide-write sequence is one step from the
     * Effect fiber scheduler's point of view (wrapped below in one
     * `Effect.try`), so no other fiber's request can interleave between the
     * count read and the insert; `db.transaction` additionally gives the
     * same guarantee at the SQLite layer (rollback on error, consistent
     * view) rather than relying solely on JS's single-threaded run-to-
     * completion semantics.
     */
    const insertIfUnderCapacityTx = db.transaction(
      (note: {
        readonly text: string
        readonly createdAt: number
        readonly limit: number
      }): Either.Either<Note, NoteLimitReached> => {
        const count = countStmt.get()?.total ?? 0
        const guarded = checkCapacity({ count, limit: note.limit })
        if (Either.isLeft(guarded)) {
          return Either.left(guarded.left)
        }
        const { lastInsertRowid } = insertStmt.run(note.text, note.createdAt)
        return Either.right({
          id: Number(lastInsertRowid),
          text: note.text,
          createdAt: note.createdAt,
        })
      },
    )

    return {
      insertIfUnderCapacity: (note) =>
        Effect.gen(function* () {
          const guarded = yield* Effect.try({
            try: () => insertIfUnderCapacityTx(note),
            catch: (cause) => new NotesDbError({ cause }),
          })
          return yield* guarded
        }),
      findById: (id) =>
        Effect.try({
          try: () => findByIdStmt.get(id) ?? undefined,
          catch: (cause) => new NotesDbError({ cause }),
        }),
      list: () =>
        Effect.try({
          try: () => listStmt.all(),
          catch: (cause) => new NotesDbError({ cause }),
        }),
    }
  })
