/**
 * The `notes` list query, defined ONCE — mirrors health.queries.ts. Both the
 * route loader (prefetch) and the component (read) reference this same
 * `queryOptions`, so the key + fetcher never drift. The fetcher calls the
 * typed Hono RPC client — no raw fetch — and decodes the body against the
 * shared contract, so server/client drift fails loudly at the boundary
 * instead of silently in the UI.
 */
import { queryOptions } from "@tanstack/react-query"
import { decodeNoteList } from "@ts-axioms/shared"
import { api } from "../../lib/api"

export const notesQuery = queryOptions({
  queryKey: ["notes"],
  queryFn: async () => {
    const res = await api.notes.$get()
    if (!res.ok) throw new Error(`notes request failed: ${res.status}`)
    return decodeNoteList(await res.json())
  },
})
