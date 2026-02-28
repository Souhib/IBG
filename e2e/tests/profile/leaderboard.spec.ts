import { test, expect } from "../../fixtures/auth.fixture";
import { ROUTES } from "../../helpers/constants";

test.describe("Leaderboard — Data Display", () => {
  test("leaderboard page loads and shows sort tabs", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.leaderboard);
    await authenticatedPage.waitForLoadState("domcontentloaded");

    // Title is visible
    await expect(
      authenticatedPage.getByRole("heading", { name: "Leaderboard" }),
    ).toBeVisible({ timeout: 10_000 });

    // Sort tabs are present
    await expect(authenticatedPage.getByRole("button", { name: "Wins" })).toBeVisible();
    await expect(authenticatedPage.getByRole("button", { name: "Win Rate" })).toBeVisible();
    await expect(authenticatedPage.getByRole("button", { name: "Streak" })).toBeVisible();
  });

  test("leaderboard table has correct column headers", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.leaderboard);
    await authenticatedPage.waitForLoadState("domcontentloaded");

    // Wait for the table to render
    await expect(authenticatedPage.locator("table")).toBeVisible({
      timeout: 10_000,
    });

    // Verify column headers
    const headers = authenticatedPage.locator("thead th");
    await expect(headers).toHaveCount(6);
  });

  test("clicking sort tabs changes the active tab styling", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.leaderboard);
    await authenticatedPage.waitForLoadState("domcontentloaded");

    const winRateTab = authenticatedPage.getByRole("button", {
      name: "Win Rate",
    });
    await expect(winRateTab).toBeVisible({ timeout: 10_000 });
    await winRateTab.click();

    // After clicking, the Win Rate tab should have the active style
    await expect(winRateTab).toHaveClass(/bg-primary/);
  });
});
