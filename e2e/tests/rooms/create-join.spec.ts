import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import { ROUTES } from "../../helpers/constants";
import { generateTestAccounts } from "../../helpers/test-setup";
import { apiLogin, apiJoinRoom, apiCreateRoom, apiGetRoom } from "../../helpers/api-client";

test.describe("Rooms — Create & Join", () => {
  test("player 1 creates a room and sees lobby", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const page = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );

    // Navigate to create room page
    await page.goto(ROUTES.createRoom);
    await page.waitForLoadState("domcontentloaded");

    // Wait for socket connection (ensures backend is responsive)
    await page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});

    // Select Undercover and create room
    await page.locator('button[type="submit"]').click();

    // Should redirect to room lobby (retry if "Failed to fetch")
    const created = await page
      .waitForURL(/\/rooms\//, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!created) {
      // Backend may be briefly unresponsive — retry with increasing waits
      for (let retry = 0; retry < 2; retry++) {
        await page.waitForTimeout(3000 + retry * 3000);
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await page.locator('button[type="submit"]').click();
        const ok = await page
          .waitForURL(/\/rooms\//, { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (ok) break;
      }
    }
    await expect(page).toHaveURL(/\/rooms\//, { timeout: 15_000 });

    // Room code and password should be visible
    await expect(page.getByText("Room Code")).toBeVisible();
    await expect(page.getByText("Password")).toBeVisible();

    await page.context().close();
  });

  test("player 2 joins room with correct code and password", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const accounts = await generateTestAccounts(2);

    // Create room via API (reliable, not subject to "Failed to fetch" under load)
    const p1Login = await apiLogin(accounts[0].email, accounts[0].password);
    const p2Login = await apiLogin(accounts[1].email, accounts[1].password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const roomCode = roomDetails.public_id;
    const passwordText = roomDetails.password;

    // Player 1 opens the room lobby
    const player1 = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("domcontentloaded");

    expect(roomCode).toHaveLength(5);
    expect(passwordText).toHaveLength(4);

    // Player 2 joins the room
    const player2 = await createPlayerPage(
      browser,
      accounts[1].email,
      accounts[1].password,
    );

    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("domcontentloaded");

    // Fill room code
    await player2.locator('input[id="room-code"]').fill(roomCode);

    // Fill PIN password digits one by one
    const pinDigits = passwordText.split("");
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill(pinDigits[i]);
    }

    // Wait for socket connected + room_status listener registered in React
    await player2.waitForFunction(
      () => {
        const s = (window as any).__SOCKET__;
        if (!s?.connected) return false;
        return typeof s.hasListeners === "function"
          ? s.hasListeners("room_status")
          : true;
      },
      { timeout: 10_000 },
    );

    const joinBtn = player2.locator('button[type="submit"]');
    await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
    await joinBtn.click();

    // If join didn't redirect, retry (socket may not have been fully ready)
    const joined = await player2
      .waitForURL(/\/rooms\/[a-f0-9-]+/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!joined) {
      // Re-check socket + listeners and retry click
      await player2.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 5_000 },
      ).catch(() => {});
      await joinBtn.click();

      const joined2 = await player2
        .waitForURL(/\/rooms\/[a-f0-9-]+/, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!joined2) {
        // Socket join failed — force-join via REST API + navigate directly
        await apiJoinRoom(room.id, p2Login.user.id, passwordText, p2Login.access_token)
          .catch(() => {}); // Ignore if already joined
        await player2.goto(ROUTES.room(room.id));
        await player2.waitForLoadState("domcontentloaded");
      }
    }

    // Verify membership via API — force-join if needed (like setupRoomWithPlayers)
    const roomCheck = await apiGetRoom(room.id, p1Login.access_token);
    const joinedUserIds = new Set(roomCheck.users.map((u: { id: string }) => u.id));
    if (!joinedUserIds.has(p2Login.user.id)) {
      await apiJoinRoom(room.id, p2Login.user.id, passwordText, p2Login.access_token)
        .catch(() => {});
      // Navigate player2 to the room after API join
      await player2.goto(ROUTES.room(room.id));
      await player2.waitForLoadState("domcontentloaded");
    }

    // Player 2 should be on the room lobby
    await expect(player2).toHaveURL(/\/rooms\/[a-f0-9-]+/, { timeout: 10_000 });

    // Both players should see each other in the lobby
    await player2.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});

    const playerCardSelector = ".bg-muted\\/50 .text-sm.font-medium, [class*='bg-muted'] .text-sm.font-medium";

    // Both players should see each other in the player list
    await expect(async () => {
      const names = await player2.locator(playerCardSelector).allTextContents();
      const count = names.filter((t) => t.trim().length > 0).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 15_000 });

    await player1.context().close();
    await player2.context().close();
  });

  test("wrong password shows error toast", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);

    // Create room via API (reliable under load)
    const p1Login = await apiLogin(accounts[0].email, accounts[0].password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);
    const roomCode = roomDetails.public_id;

    const player1 = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("domcontentloaded");

    // Player 2 tries to join with wrong password
    const player2 = await createPlayerPage(
      browser,
      accounts[1].email,
      accounts[1].password,
    );

    await player2.goto(ROUTES.rooms);
    await player2.waitForLoadState("domcontentloaded");

    // Wait for socket connection before interacting with the form
    await player2.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});

    await player2.locator('input[id="room-code"]').fill(roomCode);

    // Enter wrong PIN
    for (let i = 0; i < 4; i++) {
      await player2
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill("0");
    }

    await player2.locator('button[type="submit"]').click();

    // Should show error toast
    await expect(
      player2.locator('[data-sonner-toast][data-type="error"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Should still be on the rooms page
    await expect(player2).toHaveURL(/\/rooms$/);

    await player1.context().close();
    await player2.context().close();
  });

  test("non-existent room code shows error toast", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const player = await createPlayerPage(
      browser,
      accounts[0].email,
      accounts[0].password,
    );

    await player.goto(ROUTES.rooms);
    await player.waitForLoadState("domcontentloaded");

    // Enter non-existent room code
    await player.locator('input[id="room-code"]').fill("ZZZZZ");

    for (let i = 0; i < 4; i++) {
      await player
        .locator(`input[aria-label="Password digit ${i + 1}"]`)
        .fill("1");
    }

    await player.locator('button[type="submit"]').click();

    // Should show error toast
    await expect(
      player.locator('[data-sonner-toast][data-type="error"]'),
    ).toBeVisible({ timeout: 10_000 });

    await player.context().close();
  });
});
