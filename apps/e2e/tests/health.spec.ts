/**
 * End-to-end smoke: navigate to the web health route and assert it renders the
 * LIVE status served by the Hono `/health` endpoint. Passing this proves the
 * whole vertical slice — pure core -> Effect io/route -> Hono RPC -> TanStack
 * Query loader -> React component — works against real processes, and doubles
 * as the CI smoke test.
 */
import { expect, test } from "@playwright/test"

test("health route renders the live server status", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Service health" })).toBeVisible()

  // The component reads the live /health payload through the typed RPC client.
  await expect(page.getByTestId("health-status")).toHaveText("ok")

  // version + uptime come straight from the server's HealthClock.
  await expect(page.getByTestId("health-version")).not.toBeEmpty()
  const uptime = await page.getByTestId("health-uptime").innerText()
  expect(Number(uptime)).toBeGreaterThanOrEqual(0)
})
