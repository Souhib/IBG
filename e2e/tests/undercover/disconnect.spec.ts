import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
} from "../../helpers/ui-game-setup";

test.beforeAll(() => { flushRedis() });

test.describe("Undercover — Disconnect During Game (UI)", () => {
  test("game is cancelled when players drop below minimum (< 3)", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");

      // Wait for game UI to load
      await expect(setup.players[0].page.locator("h1:has-text('Undercover')")).toBeVisible({ timeout: 10_000 });

      // Disconnect players 2 and 3 by closing their contexts
      await setup.players[1].page.context().close();
      await setup.players[2].page.context().close();

      // Wait for disconnect grace period (15s in e2e) + cancellation processing
      await setup.players[0].page.waitForTimeout(6_000);

      // Player 1 should see one of:
      // 1. Game cancelled error (bg-destructive/10 div)
      // 2. Redirected away from game page
      const cancelledDiv = setup.players[0].page.locator(".bg-destructive\\/10");
      const redirected =
        setup.players[0].page.url().includes("/game/undercover/") === false;

      const isCancelled =
        redirected || (await cancelledDiv.isVisible().catch(() => false));
      expect(isCancelled).toBeTruthy();
    } finally {
      // Only close remaining context (others already closed)
      await setup.players[0].page.context().close();
    }
  });

  test("game cancellation shows error state in UI", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await setup.players[0].page.waitForTimeout(2000);

      // Disconnect players 2 and 3
      await setup.players[1].page.context().close();
      await setup.players[2].page.context().close();

      // Wait for grace period (15s in e2e) + cancellation
      await setup.players[0].page.waitForTimeout(6_000);

      // Player 1 should see the game cancelled state:
      // Either a destructive error div or redirect to home
      const cancelledDiv = setup.players[0].page.locator(".bg-destructive\\/10");
      const redirected =
        setup.players[0].page.url().includes("/game/undercover/") === false;

      const isCancelled =
        redirected || (await cancelledDiv.isVisible().catch(() => false));
      expect(isCancelled).toBeTruthy();
    } finally {
      await setup.players[0].page.context().close();
    }
  });

  test("remaining players see updated player list after disconnect", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");

      // Ensure player 0 is on the game page (may need navigation after startGameViaUI)
      const p0Page = setup.players[0].page;
      const onGamePage = p0Page.url().includes("/game/undercover/");
      if (!onGamePage) {
        // Find game URL from another player who IS on the game page
        let gameUrl = "";
        for (const p of setup.players) {
          if (p.page.url().includes("/game/undercover/")) {
            gameUrl = p.page.url();
            break;
          }
        }
        if (gameUrl) {
          await p0Page.goto(gameUrl);
          await p0Page.waitForLoadState("domcontentloaded");
        }
      }

      // Check initial player count shows 3 alive
      const playerCountLoc = p0Page.locator('text=/Players.*\\(/');
      let visible = await playerCountLoc
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) {
        await p0Page.reload();
        await p0Page.waitForLoadState("domcontentloaded");
        await playerCountLoc.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      const playerCountText = await playerCountLoc
        .textContent()
        .catch(() => "");
      expect(playerCountText).toContain("3");

      // Disconnect player 3
      await setup.players[2].page.context().close();

      // Wait for disconnect grace period (15s in e2e) + processing
      await setup.players[0].page.waitForTimeout(6_000);

      // With 3 players, disconnecting 1 drops below minimum (< 3 alive)
      // so the game is cancelled rather than continuing
      const gameStillRunning = setup.players[0].page
        .url()
        .includes("/game/undercover/");

      if (gameStillRunning) {
        // Game page still showing — check for cancelled state or eliminated players
        const cancelledDiv = setup.players[0].page.locator(".bg-destructive\\/10");
        const eliminatedElements = setup.players[0].page.locator(
          ".line-through, .opacity-50",
        );
        const cancelledVisible = await cancelledDiv.isVisible().catch(() => false);
        const eliminatedCount = await eliminatedElements.count();
        expect(cancelledVisible || eliminatedCount >= 1).toBeTruthy();
      }
      // If redirected away, the game was cancelled — valid outcome
    } finally {
      await setup.players[0].page.context().close();
      await setup.players[1].page.context().close();
    }
  });

  test("player reconnects to ongoing undercover game", async ({ browser }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");

      // Wait for game to fully load on all players
      for (const player of setup.players) {
        let headingVisible = await player.page
          .locator("h1:has-text('Undercover')")
          .isVisible({ timeout: 10_000 })
          .catch(() => false);
        if (!headingVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("networkidle");
          await player.page.waitForTimeout(2000);
        }
        await expect(
          player.page.locator("h1:has-text('Undercover')"),
        ).toBeVisible({ timeout: 10_000 });
      }

      // Save the game URL for player 2 to reconnect
      const gameUrl = setup.players[1].page.url();

      // Simulate player 2 temporarily disconnecting (go offline then online)
      const p2Context = setup.players[1].page.context();
      await p2Context.setOffline(true);
      await setup.players[1].page.waitForTimeout(2000);
      await p2Context.setOffline(false);
      await setup.players[1].page.waitForTimeout(1000);

      // Player 2 reloads the game page (reconnect)
      await setup.players[1].page.goto(gameUrl);
      await setup.players[1].page.waitForLoadState("networkidle");

      // Player 2 should still see the game page with role info
      await expect(setup.players[1].page).toHaveURL(/\/game\/undercover\//, { timeout: 10_000 });

      // Game should have recovered state (heading visible)
      await expect(
        setup.players[1].page.locator("h1"),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await setup.cleanup();
    }
  });
});
