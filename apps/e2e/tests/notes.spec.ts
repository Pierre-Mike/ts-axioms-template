/**
 * End-to-end smoke: navigate to the web notes route, create a note through
 * the form, and assert it appears in the list — proves the whole vertical
 * slice (pure core -> Effect io/route -> Hono RPC -> TanStack Query -> React)
 * works against real processes, mirroring health.spec.ts.
 */
import { expect, test } from "@playwright/test"

test("notes route creates a note and lists it", async ({ page }) => {
  await page.goto("/notes")

  const uniqueText = `note ${Date.now()}`
  await page.getByTestId("note-input").fill(uniqueText)
  await page.getByTestId("note-submit").click()

  await expect(page.getByTestId("note-list")).toContainText(uniqueText)
})
