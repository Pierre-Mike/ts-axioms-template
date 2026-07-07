/**
 * Notes route. Mirrors health.route.tsx's Router(loader)+Query(cache) split:
 * the loader prefetches via `ensureQueryData` and the component reads with
 * `useSuspenseQuery` against the SAME `notesQuery`. The create form is a
 * `useMutation` over the typed RPC client; on success it invalidates the
 * list query so the new note shows up without a manual refetch.
 */
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createRoute } from "@tanstack/react-router"
import { decodeNote } from "@ts-axioms/shared"
import { useState } from "react"
import { api } from "../../lib/api"
import { rootRoute } from "../../root-route"
import { notesQuery } from "./notes.queries"

function NotesComponent() {
  const { data: notes } = useSuspenseQuery(notesQuery)
  const queryClient = useQueryClient()
  const [text, setText] = useState("")

  const createNote = useMutation({
    mutationFn: async (noteText: string) => {
      const res = await api.notes.$post({ json: { text: noteText } })
      if (!res.ok) throw new Error(`create note failed: ${res.status}`)
      return decodeNote(await res.json())
    },
    onSuccess: () => {
      setText("")
      void queryClient.invalidateQueries({ queryKey: notesQuery.queryKey })
    },
  })

  return (
    <main>
      <h1>Notes</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          createNote.mutate(text)
        }}
      >
        <input
          data-testid="note-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button data-testid="note-submit" type="submit">
          Add
        </button>
      </form>
      <ul data-testid="note-list">
        {notes.map((note) => (
          <li key={note.id} data-testid="note-item">
            {note.text}
          </li>
        ))}
      </ul>
    </main>
  )
}

export const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  loader: ({ context }) => context.queryClient.ensureQueryData(notesQuery),
  component: NotesComponent,
})
