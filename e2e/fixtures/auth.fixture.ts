import { test as base, type Browser, type Page } from "@playwright/test";
import { apiLogin, type LoginResponse } from "../helpers/api-client";
import {
  TEST_ADMIN,
  TEST_USER,
  STORAGE_KEYS,
  FRONTEND_URL,
} from "../helpers/constants";

// ─── Helper: inject auth tokens into an isolated page ───────

async function injectAuth(
  page: Page,
  loginData: LoginResponse,
): Promise<void> {
  await page.goto(FRONTEND_URL, { waitUntil: "commit" });

  await page.evaluate(
    ({ tokens, keys }) => {
      // Dismiss the first-visit language picker modal
      localStorage.setItem("majlisna-first-visit-complete", "true");
      localStorage.setItem(keys.token, tokens.access_token);
      localStorage.setItem(keys.refreshToken, tokens.refresh_token);
      localStorage.setItem(
        keys.tokenExpiry,
        String(Date.now() + 900 * 1000),
      );
      localStorage.setItem(
        keys.userData,
        JSON.stringify({
          id: tokens.user.id,
          username: tokens.user.username,
          email: tokens.user.email,
        }),
      );
    },
    { tokens: loginData, keys: STORAGE_KEYS },
  );
}

// ─── Factory: create an authenticated page in a new context ─

export async function createPlayerPage(
  browser: Browser,
  email: string,
  password: string,
): Promise<Page> {
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: FRONTEND_URL,
          localStorage: [
            { name: "majlisna-first-visit-complete", value: "true" },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();

  const loginData = await apiLogin(email, password);
  await injectAuth(page, loginData);

  return page;
}

// ─── Playwright Fixtures ────────────────────────────────────

type AuthFixtures = {
  authenticatedPage: Page;
  adminPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const loginData = await apiLogin(TEST_USER.email, TEST_USER.password);
    await injectAuth(page, loginData);
    await use(page);
  },

  adminPage: async ({ page }, use) => {
    const loginData = await apiLogin(TEST_ADMIN.email, TEST_ADMIN.password);
    await injectAuth(page, loginData);
    await use(page);
  },
});

export { expect } from "@playwright/test";
