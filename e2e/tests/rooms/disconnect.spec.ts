import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import { apiLogin, apiCreateRoom, apiGetRoom } from "../../helpers/api-client";
import {
  TEST_USER,
  TEST_PLAYER,
  ROUTES,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";

test.beforeAll(() => { flushRedis() });

test.describe("Rooms — Disconnect / Reconnect", () => {
  test("player disconnect shows reconnecting status, reconnect clears it", async ({
    browser,
  }) => {
    // Setup room with 2 players
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    // Player 2 joins
    const p2Context = await browser.newContext();
    const player2 = await p2Context.newPage();

    // Inject auth for player 2
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    await player2.goto(ROUTES.rooms, { waitUntil: "commit" });
    await player2.evaluate(
      ({ tokens, keys }) => {
        localStorage.setItem(keys.token, tokens.access_token);
        localStorage.setItem(keys.refreshToken, tokens.refresh_token);
        localStorage.setItem(keys.tokenExpiry, String(Date.now() + 900_000));
        localStorage.setItem(
          keys.userData,
          JSON.stringify({
            id: tokens.user.id,
            username: tokens.user.username,
            email: tokens.user.email,
          }),
        );
      },
      {
        tokens: p2Login,
        keys: {
          token: "ibg-token",
          refreshToken: "ibg-refresh-token",
          tokenExpiry: "ibg-token-expiry",
          userData: "ibg-user-data",
        },
      },
    );

    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("networkidle");
    await player2.locator('input[id="room-code"]').fill(roomDetails.public_id);
    const pinDigits = roomDetails.password.split("");
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }
    await player2.locator('button[type="submit"]').click();
    await expect(player2).toHaveURL(/\/rooms\//, { timeout: 15_000 });
    await player2.waitForTimeout(2000);

    // Simulate player 2 disconnect by closing the socket
    await player2.evaluate(() => {
      (window as any).__SOCKET__?.disconnect();
    });

    // Player 1 should see "Reconnecting..." status for player 2
    await expect(
      player1.locator('text=Reconnecting...'),
    ).toBeVisible({ timeout: 10_000 });

    // Reconnect player 2
    await player2.evaluate(() => {
      (window as any).__SOCKET__?.connect();
    });

    // "Reconnecting..." should disappear after reconnection
    await expect(
      player1.locator('text=Reconnecting...'),
    ).not.toBeVisible({ timeout: 15_000 });

    await player1.context().close();
    await p2Context.close();
  });

  test("player removed after grace period expires", async ({ browser }) => {
    // Setup room with 2 players
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    // Player 2 joins
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("networkidle");
    await player2.locator('input[id="room-code"]').fill(roomDetails.public_id);
    const pinDigits = roomDetails.password.split("");
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }
    await player2.locator('button[type="submit"]').click();
    await expect(player2).toHaveURL(/\/rooms\//, { timeout: 15_000 });
    await player2.waitForTimeout(2000);

    // Count players before disconnect
    const playersBeforeTexts = await player1
      .locator(".text-sm.font-medium")
      .allTextContents();
    const playerCountBefore = playersBeforeTexts.filter(
      (t) => t.trim().length > 0,
    ).length;

    // Player 2 permanently disconnects (close the context entirely)
    await player2.context().close();

    // Wait for the grace period to expire (3 seconds in E2E + buffer)
    await player1.waitForTimeout(6_000);

    // Player 1 should see the permanently left toast
    // and the player count should decrease
    const playersAfterTexts = await player1
      .locator(".bg-muted\\/50 .text-sm.font-medium, [class*='bg-muted'] .text-sm.font-medium")
      .allTextContents();
    const playerCountAfter = playersAfterTexts.filter(
      (t) => t.trim().length > 0,
    ).length;

    expect(playerCountAfter).toBeLessThan(playerCountBefore);

    await player1.context().close();
  });
});
