import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import { setupRoomWithPlayersViaUI } from "../../helpers/ui-game-setup";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import { apiLogin, apiCreateRoom, apiGetRoom } from "../../helpers/api-client";
import { ROUTES, FRONTEND_URL } from "../../helpers/constants";

test.describe("Room Management", () => {
  test("create room and see lobby with room code", async ({ browser }) => {
    const accounts = await generateTestAccounts(1);
    const login = await apiLogin(accounts[0].email, accounts[0].password);
    const room = await apiCreateRoom(login.access_token);

    const page = await createPlayerPage(browser, accounts[0].email, accounts[0].password);
    await page.goto(ROUTES.room(room.id));
    await page.waitForLoadState("domcontentloaded");

    // Verify room code is displayed
    await expect(page.locator(`text=${room.public_id}`)).toBeVisible({ timeout: 10_000 });
    // Verify player count
    await expect(page.locator("text=Players (1)")).toBeVisible({ timeout: 10_000 });

    await page.context().close();
  });

  test("join room with correct code and PIN", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayersViaUI(browser, accounts);

    // Both players should see Players (2)
    await expect(setup.players[0].page.locator("text=Players (2)")).toBeVisible({ timeout: 15_000 });
    await expect(setup.players[1].page.locator("text=Players (2)")).toBeVisible({ timeout: 15_000 });

    await setup.cleanup();
  });

  test("wrong PIN shows error toast", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const login1 = await apiLogin(accounts[0].email, accounts[0].password);
    const room = await apiCreateRoom(login1.access_token);
    const roomDetails = await apiGetRoom(room.id, login1.access_token);

    const page = await createPlayerPage(browser, accounts[1].email, accounts[1].password);
    await page.goto(ROUTES.rooms);
    await page.waitForLoadState("domcontentloaded");

    // Fill room code
    await page.locator('input[id="room-code"]').fill(roomDetails.public_id);
    // Fill wrong PIN
    for (let j = 0; j < 4; j++) {
      await page.locator(`input[aria-label="Password digit ${j + 1}"]`).fill("0");
    }
    const joinBtn = page.locator('button[type="submit"]');
    await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
    await joinBtn.click();

    // Should show error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 10_000 });

    await page.context().close();
  });

  test("leave room returns to rooms list", async ({ browser }) => {
    const accounts = await generateTestAccounts(2);
    const setup = await setupRoomWithPlayersViaUI(browser, accounts);

    // Player 2 clicks leave
    const leaveBtn = setup.players[1].page.locator('button:has-text("Leave")');
    await leaveBtn.click();

    // Player 2 navigated to rooms
    await expect(setup.players[1].page).toHaveURL(/\/rooms$/, { timeout: 10_000 });

    // Host should see player count decrease (via polling)
    await expect(setup.players[0].page.locator("text=Players (1)")).toBeVisible({ timeout: 15_000 });

    await setup.cleanup();
  });

  test("host starts game and all players navigate to game page", async ({ browser }) => {
    const accounts = await generateTestAccounts(3);
    const setup = await setupRoomWithPlayersViaUI(browser, accounts);

    // Host starts game
    const startButton = setup.players[0].page.locator('button:has-text("Start")');
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();

    // All players should navigate to game page
    for (const player of setup.players) {
      await expect(player.page).toHaveURL(/\/game\/undercover\//, { timeout: 15_000 });
    }

    await setup.cleanup();
  });
});
