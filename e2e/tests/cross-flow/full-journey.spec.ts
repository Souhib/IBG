import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import {
  apiLogin,
  apiGetRoom,
} from "../../helpers/api-client";
import {
  createSocketClient,
  connectSocket,
  waitForEvent,
  disconnectSocket,
} from "../../helpers/socket-client";
import {
  TEST_PLAYER,
  TEST_ALI,
  ROUTES,
  STORAGE_KEYS,
  SOCKET_EVENTS,
} from "../../helpers/constants";

test.describe("Cross-Flow — Full Journey", () => {
  test("register → login → create room → join → start game → verify game state", async ({
    browser,
  }) => {
    // ─── Step 1: Register a new account via UI ──────────────

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    const uniqueEmail = `e2e-journey-${Date.now()}@test.com`;
    const uniqueUsername = `journey_${Date.now()}`;
    const password = "Journey123!";

    await page1.goto(ROUTES.register);
    await page1.waitForLoadState("networkidle");

    await page1.locator('input[id="username"]').fill(uniqueUsername);
    await page1.locator('input[id="email"]').fill(uniqueEmail);
    await page1.locator('input[id="password"]').fill(password);
    await page1.locator('button[type="submit"]').click();

    // Wait for registration to complete (redirect away from register page)
    await expect(page1).not.toHaveURL(/\/auth\/register/, {
      timeout: 15_000,
    });

    // ─── Step 2: Login with the new account ─────────────────

    // Navigate to login page (in case registration didn't auto-login)
    await page1.goto(ROUTES.login);
    await page1.waitForLoadState("networkidle");

    await page1.locator('input[id="email"]').fill(uniqueEmail);
    await page1.locator('input[id="password"]').fill(password);
    await page1.locator('button[type="submit"]').click();

    await page1.waitForURL("/", { timeout: 15_000 });

    // Verify we're authenticated
    const token = await page1.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEYS.token,
    );
    expect(token).toBeTruthy();
    expect(token).not.toBe("undefined");

    // ─── Step 3: Create a room ──────────────────────────────

    await page1.goto(ROUTES.createRoom);
    await page1.waitForLoadState("networkidle");

    // Select Undercover (default) and create
    await page1.locator('button[type="submit"]').click();

    // Should redirect to room lobby
    await expect(page1).toHaveURL(/\/rooms\//, { timeout: 15_000 });
    await page1.waitForLoadState("networkidle");

    // Extract room code and password
    await page1.waitForTimeout(2000);
    const roomCodeButton = page1.locator(
      'button:has(.tracking-widest):not(:has(.lucide-key-round))',
    );
    await expect(roomCodeButton).toBeVisible({ timeout: 5_000 });
    const roomCodeText = (await roomCodeButton.innerText())
      .replace(/\s/g, "")
      .slice(0, 5);
    const passwordButton = page1.locator('button:has(.lucide-key-round)');
    const passwordText = (await passwordButton.innerText()).replace(/\D/g, "");

    expect(roomCodeText).toHaveLength(5);
    expect(passwordText).toHaveLength(4);

    // ─── Step 4: Second player joins the room ───────────────

    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );

    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("networkidle");

    await player2.locator('input[id="room-code"]').fill(roomCodeText);
    const pinDigits = passwordText.split("");
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }
    await player2.locator('button[type="submit"]').click();

    await expect(player2).toHaveURL(/\/rooms\//, { timeout: 15_000 });
    await player2.waitForTimeout(1500);

    // ─── Step 5: Third player joins ─────────────────────────

    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    await player3.goto(ROUTES.rooms);
    await player3.waitForLoadState("networkidle");

    await player3.locator('input[id="room-code"]').fill(roomCodeText);
    for (let i = 0; i < 4; i++) {
      await player3
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }
    await player3.locator('button[type="submit"]').click();

    await expect(player3).toHaveURL(/\/rooms\//, { timeout: 15_000 });
    await player3.waitForTimeout(1500);

    // ─── Verify: All 3 players visible in lobby ─────────────

    await page1.waitForTimeout(2000);
    const playerElements = page1.locator(
      ".bg-muted\\/50 .text-sm.font-medium, [class*='bg-muted'] .text-sm.font-medium",
    );
    const playerCount = await playerElements.count();
    expect(playerCount).toBeGreaterThanOrEqual(3);

    // ─── Step 6: Start an Undercover game ───────────────────

    const startButton = page1.locator('button:has-text("Start")');
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();

    // All players should navigate to the game page
    for (const player of [page1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }

    // ─── Step 7: Verify game state consistency ──────────────

    // Wait for game state to load
    await page1.waitForTimeout(3000);

    // Each player should see the game heading "Undercover" or equivalent
    for (const player of [page1, player2, player3]) {
      // The game page should have a heading and round info
      const heading = player.locator("h1");
      await expect(heading).toBeVisible({ timeout: 10_000 });
    }

    // Verify all players see the same number of players in the player list
    for (const player of [page1, player2, player3]) {
      const playerList = player.locator(
        ".rounded-lg.px-4.py-2",
      );
      const count = await playerList.count();
      expect(count).toBeGreaterThanOrEqual(3);
    }

    // ─── Cleanup ────────────────────────────────────────────

    await context1.close();
    await player2.context().close();
    await player3.context().close();
  });

  test("multiple rooms can exist simultaneously", async ({ browser }) => {
    // Create two separate rooms with different hosts
    const p1Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p2Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    // Player 1 creates a room
    const player1 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    await player1.goto(ROUTES.createRoom);
    await player1.waitForLoadState("networkidle");
    await player1.locator('button[type="submit"]').click();
    await expect(player1).toHaveURL(/\/rooms\//, { timeout: 15_000 });

    // Player 2 creates a different room
    const player2 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );
    await player2.goto(ROUTES.createRoom);
    await player2.waitForLoadState("networkidle");
    await player2.locator('button[type="submit"]').click();
    await expect(player2).toHaveURL(/\/rooms\//, { timeout: 15_000 });

    // Both rooms should exist with different URLs
    expect(player1.url()).not.toBe(player2.url());

    // Both should show their own lobby
    await player1.waitForLoadState("networkidle");
    await player2.waitForLoadState("networkidle");

    for (const player of [player1, player2]) {
      await expect(player.getByText("Room Code")).toBeVisible();
    }

    await player1.context().close();
    await player2.context().close();
  });
});
