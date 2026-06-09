/**
 * Typed Hono RPC client. `AppType` is imported type-only from the server, so
 * the network surface is fully typed end-to-end with zero runtime coupling and
 * no raw `fetch` (Biome's noRestrictedGlobals bans the global; hc owns it).
 */
import type { AppType } from "@ts-axioms/server/types"
import { hc } from "hono/client"

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787"

export const api = hc<AppType>(API_URL)
