import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
} from "../../helpers/ui-game-setup";
import { apiGetRoom, apiLeaveRoom, apiJoinRoom } from "../../helpers/api-client";

test.describe("Room Disconnect Behavior", () => {
  test("player refreshes in room and recovers state", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    // Verify both players see Players (2)
    await expect(
      setup.players[0].page.locator("text=Players (2)"),
    ).toBeVisible({ timeout: 15_000 });

    // Player 2 refreshes
    await setup.players[1].page.reload();
    await setup.players[1].page.waitForLoadState("domcontentloaded");

    // Player 2 should still see the room with correct player count
    await expect(
      setup.players[1].page.locator("text=Players (2)"),
    ).toBeVisible({ timeout: 15_000 });

    // Room code should still be visible
    await expect(
      setup.players[1].page.locator(`text=${setup.roomDetails.public_id}`),
    ).toBeVisible({ timeout: 10_000 });

    await setup.cleanup();
  });

  test("host leaves and ownership transfers to remaining player", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    // Verify both in room
    await expect(
      setup.players[0].page.locator("text=Players (2)"),
    ).toBeVisible({ timeout: 15_000 });

    const hostId = setup.players[0].login.user.id;
    const player2Id = setup.players[1].login.user.id;

    // Host (player 0) clicks leave
    const leaveBtn = setup.players[0].page.locator('button:has-text("Leave")');
    await leaveBtn.click();

    // Host should navigate away from room
    await expect(setup.players[0].page).toHaveURL(/\/rooms$/, { timeout: 10_000 });

    // Player 2 should now see Players (1) via polling
    await expect(
      setup.players[1].page.locator("text=Players (1)"),
    ).toBeVisible({ timeout: 15_000 });

    // Verify ownership transferred via API
    const room = await apiGetRoom(setup.roomId, setup.players[1].login.access_token);
    expect(room.owner_id).toBe(player2Id);
    expect(room.owner_id).not.toBe(hostId);

    await setup.cleanup();
  });

  test("host leaves and rejoins — is no longer host", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    await expect(
      setup.players[0].page.locator("text=Players (2)"),
    ).toBeVisible({ timeout: 15_000 });

    const player2Token = setup.players[1].login.access_token;
    const player1 = setup.players[0].login;

    // Host leaves via API
    await apiLeaveRoom(setup.roomId, player1.user.id, player1.access_token);

    // Verify ownership transferred to player 2
    const roomAfterLeave = await apiGetRoom(setup.roomId, player2Token);
    expect(roomAfterLeave.owner_id).toBe(setup.players[1].login.user.id);

    // Original host rejoins
    await apiJoinRoom(
      setup.roomDetails.public_id,
      player1.user.id,
      setup.roomDetails.password,
      player1.access_token,
    );

    // Original host should NOT be the owner anymore
    const roomAfterRejoin = await apiGetRoom(setup.roomId, player1.access_token);
    expect(roomAfterRejoin.owner_id).toBe(setup.players[1].login.user.id);
    expect(roomAfterRejoin.owner_id).not.toBe(player1.user.id);

    await setup.cleanup();
  });
});
