import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
} from "../../helpers/ui-game-setup";

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

  test("host leaves and player count decreases for remaining player", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayers(browser, accounts);

    // Verify both in room
    await expect(
      setup.players[0].page.locator("text=Players (2)"),
    ).toBeVisible({ timeout: 15_000 });

    // Host (player 0) clicks leave
    const leaveBtn = setup.players[0].page.locator('button:has-text("Leave")');
    await leaveBtn.click();

    // Host should navigate away from room
    await expect(setup.players[0].page).toHaveURL(/\/rooms$/, { timeout: 10_000 });

    // Player 2 should now see Players (1) via polling
    await expect(
      setup.players[1].page.locator("text=Players (1)"),
    ).toBeVisible({ timeout: 15_000 });

    await setup.cleanup();
  });
});
