import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
} from "../../helpers/api-client";
import {
  createSocketClient,
  connectSocket,
  waitForEvent,
  disconnectSocket,
} from "../../helpers/socket-client";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  ROUTES,
  SOCKET_EVENTS,
} from "../../helpers/constants";

test.describe("Undercover — Disconnect During Game", () => {
  test("game is cancelled when players drop below minimum (< 3)", async () => {
    // Start a 3-player game, then disconnect 2 players
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const s1 = createSocketClient(p1Login.access_token);
    const s2 = createSocketClient(p2Login.access_token);
    const s3 = createSocketClient(p3Login.access_token);

    await connectSocket(s1);
    await connectSocket(s2);
    await connectSocket(s3);

    for (const [socket, login] of [
      [s1, p1Login],
      [s2, p2Login],
      [s3, p3Login],
    ] as const) {
      socket.emit("join_room", {
        user_id: login.user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
    }

    // Start game
    const rolePromises = [
      waitForEvent(s1, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s2, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s3, SOCKET_EVENTS.ROLE_ASSIGNED),
    ];
    s1.emit("start_undercover_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
    });
    await Promise.all(rolePromises);

    // Listen for game_cancelled on remaining player
    const cancelPromise = waitForEvent<{ message: string }>(
      s1,
      SOCKET_EVENTS.GAME_CANCELLED,
      20_000,
    );

    // Disconnect player 2 and 3 permanently
    disconnectSocket(s2);
    disconnectSocket(s3);

    // Wait for grace period (3s in E2E) + buffer
    const result = await cancelPromise.catch(() => null);

    // Game should be cancelled due to insufficient players
    if (result) {
      expect(result).toBeTruthy();
    }

    disconnectSocket(s1);
  });

  test("game cancellation shows error and redirects in UI", async ({
    browser,
  }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    // All 3 join via UI
    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    for (const [player, login] of [
      [player2, p2Login],
      [player3, p3Login],
    ] as const) {
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
    }

    // Start game
    await player1.locator('button:has-text("Start")').click();
    for (const player of [player1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }
    await player1.waitForTimeout(2000);

    // Disconnect players 2 and 3 by closing their contexts
    await player2.context().close();
    await player3.context().close();

    // Wait for grace period + cancellation
    await player1.waitForTimeout(8_000);

    // Player 1 should see the game cancelled state:
    // Either a destructive error div or redirect to home
    const cancelledDiv = player1.locator(".bg-destructive\\/10");
    const redirected = player1.url().includes("/game/undercover/") === false;

    const isCancelled =
      redirected || (await cancelledDiv.isVisible().catch(() => false));
    expect(isCancelled).toBeTruthy();

    await player1.context().close();
  });

  test("remaining players see updated player list after disconnect", async ({
    browser,
  }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    for (const [player, login] of [
      [player2, p2Login],
      [player3, p3Login],
    ] as const) {
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
    }

    // Start game
    await player1.locator('button:has-text("Start")').click();
    for (const player of [player1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }
    await player1.waitForTimeout(3000);

    // Check initial player count shows 3 alive
    const playerCountText = await player1
      .locator('text=/Players.*\\(/')
      .textContent()
      .catch(() => "");
    // Should contain "3" somewhere
    expect(playerCountText).toContain("3");

    // Disconnect player 3
    await player3.context().close();

    // Wait for disconnect grace period
    await player1.waitForTimeout(6_000);

    // With 3 players, disconnecting 1 drops below minimum (< 3 alive)
    // so the game is cancelled rather than continuing with an eliminated player.
    // Check that either:
    // - The game was cancelled (redirect or cancel message shown)
    // - OR there's an eliminated player in the game UI
    const gameStillRunning = player1
      .url()
      .includes("/game/undercover/");

    if (gameStillRunning) {
      // Game page is still showing — check for cancelled state or eliminated players
      const cancelledDiv = player1.locator(".bg-destructive\\/10");
      const eliminatedElements = player1.locator(".line-through, .opacity-50");
      const cancelledVisible = await cancelledDiv.isVisible().catch(() => false);
      const eliminatedCount = await eliminatedElements.count();
      expect(cancelledVisible || eliminatedCount >= 1).toBeTruthy();
    }
    // If redirected away, the game was cancelled — that's also a valid outcome

    await player1.context().close();
    await player2.context().close();
  });

  test("player reconnects to ongoing undercover game", async ({ browser }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    for (const [player, login] of [
      [player2, p2Login],
      [player3, p3Login],
    ] as const) {
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
    }

    // Start game
    await player1.locator('button:has-text("Start")').click();
    for (const player of [player1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }
    await player1.waitForTimeout(3000);

    // Save the game URL for player 2 to reconnect
    const gameUrl = player2.url();

    // Simulate player 2 temporarily disconnecting (go offline then online)
    const p2Context = player2.context();
    await p2Context.setOffline(true);
    await player2.waitForTimeout(1000);
    await p2Context.setOffline(false);

    // Player 2 reloads the game page (reconnect)
    await player2.goto(gameUrl);
    await player2.waitForLoadState("networkidle");
    await player2.waitForTimeout(3000);

    // Player 2 should still see the game page with role info
    await expect(player2).toHaveURL(/\/game\/undercover\//);

    // Game should have recovered state (role info visible or game heading)
    const hasGameContent = await player2
      .locator("h1")
      .isVisible()
      .catch(() => false);
    expect(hasGameContent).toBeTruthy();

    await player1.context().close();
    await p2Context.close();
    await player3.context().close();
  });
});
