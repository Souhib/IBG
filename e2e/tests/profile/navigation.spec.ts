import { test as baseTest, expect as baseExpect } from "@playwright/test";
import { test, expect } from "../../fixtures/auth.fixture";
import { ROUTES } from "../../helpers/constants";

test.describe("Profile — Authenticated Navigation", () => {
  test("profile page shows user info", async ({ authenticatedPage }) => {
    await authenticatedPage.goto(ROUTES.profile);
    await authenticatedPage.waitForLoadState("networkidle");

    // Should see the user's avatar (initial letter circle)
    const avatar = authenticatedPage.locator(
      ".rounded-full.bg-primary\\/10",
    );
    await expect(avatar).toBeVisible({ timeout: 10_000 });

    // Should see the user's email
    await expect(
      authenticatedPage.getByText("user@test.com"),
    ).toBeVisible();
  });

  test("profile page has links to stats, achievements, rooms", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.profile);
    await authenticatedPage.waitForLoadState("networkidle");

    // Stats link (in main content area, not nav)
    await expect(
      authenticatedPage.locator('main a[href="/stats"]'),
    ).toBeVisible({ timeout: 10_000 });

    // Achievements link
    await expect(
      authenticatedPage.locator('main a[href="/achievements"]'),
    ).toBeVisible();

    // Rooms link (scoped to main to avoid matching the nav link)
    await expect(
      authenticatedPage.locator('main a[href="/rooms"]'),
    ).toBeVisible();
  });

  test("clicking rooms link from profile navigates correctly", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.profile);
    await authenticatedPage.waitForLoadState("networkidle");

    await authenticatedPage.locator('main a[href="/rooms"]').click();
    await expect(authenticatedPage).toHaveURL(/\/rooms/, {
      timeout: 10_000,
    });
  });
});

test.describe("Leaderboard — Public Page", () => {
  test("leaderboard page loads and shows table structure", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(ROUTES.leaderboard);
    await authenticatedPage.waitForLoadState("networkidle");

    // Should see the leaderboard title
    await expect(
      authenticatedPage.getByRole("heading", { name: "Leaderboard" }),
    ).toBeVisible({ timeout: 10_000 });

    // Should see table headers or empty state
    const hasTable = await authenticatedPage
      .locator("table, .bg-muted\\/50")
      .first()
      .isVisible()
      .catch(() => false);

    const hasEmptyState = await authenticatedPage
      .getByText(/No players yet/i)
      .isVisible()
      .catch(() => false);

    // Either table or empty state should be visible
    expect(hasTable || hasEmptyState).toBeTruthy();
  });
});

test.describe("Navigation — Protected Routes", () => {
  test("authenticated user can navigate between all main pages", async ({
    authenticatedPage,
  }) => {
    // Home
    await authenticatedPage.goto("/");
    await expect(authenticatedPage).toHaveURL("/");

    // Rooms
    await authenticatedPage.goto(ROUTES.rooms);
    await authenticatedPage.waitForLoadState("networkidle");
    await expect(authenticatedPage).toHaveURL(/\/rooms/);

    // Create Room
    await authenticatedPage.goto(ROUTES.createRoom);
    await authenticatedPage.waitForLoadState("networkidle");
    await expect(authenticatedPage).toHaveURL(/\/rooms\/create/);

    // Profile
    await authenticatedPage.goto(ROUTES.profile);
    await authenticatedPage.waitForLoadState("networkidle");
    await expect(authenticatedPage).toHaveURL(/\/profile/);

    // Leaderboard
    await authenticatedPage.goto(ROUTES.leaderboard);
    await authenticatedPage.waitForLoadState("networkidle");
    await expect(authenticatedPage).toHaveURL(/\/leaderboard/);
  });

  test("navigating to non-existent game ID shows error or redirect", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(
      "/game/undercover/00000000-0000-0000-0000-000000000000",
    );
    await authenticatedPage.waitForLoadState("networkidle");
    await authenticatedPage.waitForTimeout(3000);

    // Should either show an error, redirect, or show loading state
    // (not crash or show blank page)
    const hasContent = await authenticatedPage
      .locator("body")
      .textContent();
    expect(hasContent).toBeTruthy();
    expect(hasContent!.length).toBeGreaterThan(0);
  });

  test("navigating to non-existent room ID shows error or redirect", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto(
      "/rooms/00000000-0000-0000-0000-000000000000",
    );
    await authenticatedPage.waitForLoadState("networkidle");
    await authenticatedPage.waitForTimeout(3000);

    // Should show error state (not crash)
    const hasContent = await authenticatedPage
      .locator("body")
      .textContent();
    expect(hasContent).toBeTruthy();
  });
});

baseTest.describe("Navigation — Unauthenticated Redirects", () => {
  baseTest(
    "unauthenticated user is redirected from /profile",
    async ({ page }) => {
      await page.goto("/profile");
      await baseExpect(page).toHaveURL(/\/auth\/login/, {
        timeout: 15_000,
      });
    },
  );

  baseTest(
    "unauthenticated user is redirected from /rooms/create",
    async ({ page }) => {
      await page.goto("/rooms/create");
      await baseExpect(page).toHaveURL(/\/auth\/login/, {
        timeout: 15_000,
      });
    },
  );

  baseTest(
    "unauthenticated user can access /leaderboard",
    async ({ page }) => {
      await page.goto("/leaderboard");
      await page.waitForLoadState("networkidle");

      // Leaderboard is a public page — should NOT redirect to login
      await baseExpect(page).toHaveURL(/\/leaderboard/);
    },
  );
});
