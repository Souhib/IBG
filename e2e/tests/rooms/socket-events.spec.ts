import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import { apiLogin, apiCreateRoom, apiGetRoom } from "../../helpers/api-client";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  ROUTES,
} from "../../helpers/constants";

test.describe("Rooms — Socket Events", () => {
  test("player 1 sees join notification when player 2 joins", async ({
    browser,
  }) => {
    // Player 1 creates room via API and navigates to lobby
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");

    // Wait for socket connection and room load
    await player1.waitForTimeout(2000);

    // Player 2 joins via UI
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("networkidle");

    // Get room details for code and password
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    await player2.locator('input[id="room-code"]').fill(roomDetails.public_id);
    const pinDigits = roomDetails.password.split("");
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }
    await player2.locator('button[type="submit"]').click();

    // Player 2 should land in the lobby
    await expect(player2).toHaveURL(/\/rooms\//, { timeout: 15_000 });

    // Player 1 should see a toast about player joining
    await expect(
      player1.locator('[data-sonner-toast]'),
    ).toBeVisible({ timeout: 10_000 });

    // Both players should see each other in the player list
    await player1.waitForTimeout(1000);
    const p1PlayerNames = await player1
      .locator(".bg-muted\\/50 .text-sm.font-medium, [class*='bg-muted'] .text-sm.font-medium")
      .allTextContents();
    expect(p1PlayerNames.length).toBeGreaterThanOrEqual(2);

    await player1.context().close();
    await player2.context().close();
  });

  test("player 1 sees leave notification when player 2 leaves", async ({
    browser,
  }) => {
    // Setup: create room and have both players join
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

    // Player 2 disconnects by closing their page
    await player2.context().close();

    // Player 1 should eventually see a disconnected or left notification
    // Wait for the disconnect grace period event or permanent leave
    await expect(
      player1.locator('[data-sonner-toast]').last(),
    ).toBeVisible({ timeout: 15_000 });

    await player1.context().close();
  });

  test("ownership transfers when host leaves", async ({ browser }) => {
    // Player 1 (host) creates room
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

    // Host (player 1) disconnects
    await player1.context().close();

    // After grace period, player 2 should become host
    // Wait for "owner changed" toast or host badge to appear on player 2
    await player2.waitForTimeout(5_000); // Grace period is 3s in E2E

    // Player 2 should now see the host controls (game type selector + start button)
    await expect(
      player2.locator('text=Game Type'),
    ).toBeVisible({ timeout: 10_000 });

    await player2.context().close();
  });
});
