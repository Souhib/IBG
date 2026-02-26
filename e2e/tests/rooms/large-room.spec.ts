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
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
  ROUTES,
  SOCKET_EVENTS,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";

test.beforeAll(() => { flushRedis() });

const SIX_ACCOUNTS = [
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
] as const;

test.describe("Rooms — Large Room (4-6 Players)", () => {
  test("6 players join room and see each other in lobby", async ({
    browser,
  }) => {
    // Player 1 creates room via API
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    // Create browser page for player 1 (host)
    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    // Players 2-6 join via room code + password
    const otherPages: Awaited<ReturnType<typeof createPlayerPage>>[] = [];
    for (const account of SIX_ACCOUNTS.slice(1)) {
      const page = await createPlayerPage(
        browser,
        account.email,
        account.password,
      );
      await page.goto(ROUTES.rooms);
      await page.waitForLoadState("networkidle");
      await page.locator('input[id="room-code"]').fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await page
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await page.waitForTimeout(1500);
      otherPages.push(page);
    }

    const allPages = [player1, ...otherPages];

    // Wait for all join events to propagate
    await player1.waitForTimeout(2000);

    // All 6 players should see "Players (6)" or at least 6 player entries
    for (const page of allPages) {
      const playerEntries = page.locator(
        ".bg-muted\\/50 .text-sm.font-medium, [class*='bg-muted'] .text-sm.font-medium",
      );
      await expect(playerEntries).toHaveCount(6, { timeout: 10_000 });
    }

    // Cleanup
    for (const page of allPages) {
      await page.context().close();
    }
  });

  test("owner transfer chain across multiple disconnects", async () => {
    test.setTimeout(120_000);
    // 4 players in room via socket
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA];
    const logins = await Promise.all(
      accounts.map((a) => apiLogin(a.email, a.password)),
    );

    const room = await apiCreateRoom(logins[0].access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, logins[0].access_token);

    const sockets = logins.map((l) => createSocketClient(l.access_token));
    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    // Use sockets[3] (last player, never disconnected) as the stable listener
    // to avoid race conditions with broadcast event delivery.

    // Player 1 (owner) disconnects → ownership transfers
    const ownerChange1Promise = waitForEvent<{
      new_owner_id: string;
      new_owner_username: string;
    }>(sockets[3], SOCKET_EVENTS.OWNER_CHANGED, 15_000);

    disconnectSocket(sockets[0]);

    const ownerChange1 = await ownerChange1Promise;
    expect(ownerChange1.new_owner_id).toBeTruthy();
    expect(ownerChange1.new_owner_id).not.toBe(logins[0].user.id);

    // Find the new owner and disconnect them
    const newOwner1Idx = logins.findIndex(
      (l) => l.user.id === ownerChange1.new_owner_id,
    );
    expect(newOwner1Idx).toBeGreaterThan(0);

    // Set up second listener before disconnecting new owner
    const ownerChange2Promise = waitForEvent<{
      new_owner_id: string;
      new_owner_username: string;
    }>(sockets[3], SOCKET_EVENTS.OWNER_CHANGED, 15_000);

    disconnectSocket(sockets[newOwner1Idx]);

    const ownerChange2 = await ownerChange2Promise;
    expect(ownerChange2.new_owner_id).toBeTruthy();

    // Two different players became owner in succession
    expect(ownerChange1.new_owner_id).not.toBe(ownerChange2.new_owner_id);

    // Cleanup remaining sockets
    for (let i = 0; i < sockets.length; i++) {
      if (i !== 0 && i !== newOwner1Idx) {
        disconnectSocket(sockets[i]);
      }
    }
  });
});
