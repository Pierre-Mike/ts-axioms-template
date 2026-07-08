/**
 * Playwright config. Boots BOTH tiers via `webServer` (the Bun/Hono server on
 * :8787 and the Vite dev server on :5173) so the spec exercises the full
 * type-safe RPC path end-to-end. Browsers must be installed once with
 * `bunx playwright install` (a documented prerequisite — not run during the
 * template build / CI bootstrap).
 */
import { defineConfig, devices } from "@playwright/test"

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173"
const repoRoot = new URL("../../", import.meta.url).pathname

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Bun/Hono API. NOTES_DB_PATH is ":memory:" so e2e runs don't
      // accumulate notes in a local sqlite file across runs.
      command: "bun run dev:server",
      cwd: repoRoot,
      env: { NOTES_DB_PATH: ":memory:" },
      url: "http://localhost:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Vite web app.
      command: "bun run dev:web",
      cwd: repoRoot,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
