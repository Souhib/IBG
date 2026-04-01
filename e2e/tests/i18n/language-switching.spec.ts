import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import { FRONTEND_URL, ROUTES } from "../../helpers/constants";

test.describe("i18n Language Switching", () => {
  test("switching to French updates UI text", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const page = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );

    // Reset language to English first
    await page.evaluate(() => localStorage.setItem("majlisna-language", "en"));
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState("domcontentloaded");

    // Click the language switcher button
    const langButton = page.locator('button[aria-label="Switch language"]');
    await expect(langButton).toBeVisible({ timeout: 10_000 });
    await langButton.click();

    // Select French from the dropdown
    const frenchOption = page.locator('button:has-text("Fran")').first();
    await expect(frenchOption).toBeVisible({ timeout: 5_000 });
    await frenchOption.click();

    // Verify French text appears — "Salons" is French for "Rooms"
    await expect(
      page.locator("text=Salons").first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.context().close();
  });

  test("switching to Arabic enables RTL layout", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const page = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );

    // Reset language to English first
    await page.evaluate(() => localStorage.setItem("majlisna-language", "en"));
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState("domcontentloaded");

    // Click the language switcher button
    const langButton = page.locator('button[aria-label="Switch language"]');
    await expect(langButton).toBeVisible({ timeout: 10_000 });
    await langButton.click();

    // Select Arabic from the dropdown
    const arabicOption = page.locator('button:has-text("العربية")');
    await expect(arabicOption).toBeVisible({ timeout: 5_000 });
    await arabicOption.click();

    // Wait for the language to apply
    await page.waitForTimeout(1000);

    // Verify the HTML element has dir="rtl"
    await expect.poll(
      async () => page.locator("html").getAttribute("dir"),
      { timeout: 10_000 },
    ).toBe("rtl");

    await page.context().close();
  });

  test("language persists across page navigation", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const page = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );

    // Reset language to English first
    await page.evaluate(() => localStorage.setItem("majlisna-language", "en"));
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState("domcontentloaded");

    // Switch to French
    const langButton = page.locator('button[aria-label="Switch language"]');
    await expect(langButton).toBeVisible({ timeout: 10_000 });
    await langButton.click();

    const frenchOption = page.locator('button:has-text("Fran")').first();
    await expect(frenchOption).toBeVisible({ timeout: 5_000 });
    await frenchOption.click();

    // Verify French is active
    await expect(
      page.locator("text=Salons").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Navigate to the leaderboard page
    await page.goto(`${FRONTEND_URL}${ROUTES.leaderboard}`);
    await page.waitForLoadState("domcontentloaded");

    // Verify French text is still shown — nav should show "Salons" not "Rooms"
    await expect(
      page.locator("text=Salons").first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.context().close();
  });
});
