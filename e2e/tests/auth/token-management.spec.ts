import { test, expect } from "@playwright/test";
import { test as authTest } from "../../fixtures/auth.fixture";
import { STORAGE_KEYS, ROUTES } from "../../helpers/constants";

authTest.describe("Auth — Token Management", () => {
  authTest(
    "tokens persist across page reload",
    async ({ authenticatedPage }) => {
      // Get token before reload
      const tokenBefore = await authenticatedPage.evaluate(
        (key) => localStorage.getItem(key),
        STORAGE_KEYS.token,
      );
      expect(tokenBefore).toBeTruthy();

      // Reload the page
      await authenticatedPage.reload();
      await authenticatedPage.waitForLoadState("domcontentloaded");

      // Token should still be present
      const tokenAfter = await authenticatedPage.evaluate(
        (key) => localStorage.getItem(key),
        STORAGE_KEYS.token,
      );
      expect(tokenAfter).toBe(tokenBefore);
    },
  );

  authTest(
    "user data persists across page reload",
    async ({ authenticatedPage }) => {
      const userDataBefore = await authenticatedPage.evaluate(
        (key) => localStorage.getItem(key),
        STORAGE_KEYS.userData,
      );
      expect(userDataBefore).toBeTruthy();

      await authenticatedPage.reload();
      await authenticatedPage.waitForLoadState("domcontentloaded");

      const userDataAfter = await authenticatedPage.evaluate(
        (key) => localStorage.getItem(key),
        STORAGE_KEYS.userData,
      );
      expect(userDataAfter).toBe(userDataBefore);
    },
  );

  authTest(
    "clearing tokens redirects to login on protected route",
    async ({ authenticatedPage }) => {
      // Clear all auth data
      await authenticatedPage.evaluate((keys) => {
        localStorage.removeItem(keys.token);
        localStorage.removeItem(keys.refreshToken);
        localStorage.removeItem(keys.tokenExpiry);
        localStorage.removeItem(keys.userData);
      }, STORAGE_KEYS);

      // Navigate to protected route
      await authenticatedPage.goto(ROUTES.rooms);

      // Should redirect to login
      await expect(authenticatedPage).toHaveURL(/\/auth\/login/, {
        timeout: 15_000,
      });
    },
  );
});

test.describe("Auth — Token Management (Unauthenticated)", () => {
  test("accessing protected route without token redirects to login", async ({
    page,
  }) => {
    await page.goto(ROUTES.rooms);

    // Should redirect to login
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  });
});
