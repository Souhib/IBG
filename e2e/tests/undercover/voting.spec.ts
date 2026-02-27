import { test, expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
  dismissRoleRevealAll,
  submitDescriptionsForAllPlayers,
  voteForPlayer,
  getAliveVoteTargets,
  waitForEliminationOrGameOver,
} from "../../helpers/ui-game-setup";

test.beforeAll(async () => { await flushRedis() });

test.describe("Undercover — Voting Rules (UI)", () => {
  test("voting buttons do not include the current player (no self-vote)", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      for (const player of setup.players) {
        const targets = await getAliveVoteTargets(player.page);
        expect(targets).toHaveLength(2);
        expect(targets).not.toContain(player.login.user.username);
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("player sees word reminder in playing phase", async ({ browser }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      // Find game URL from a player still on the game page
      const gameUrl = setup.players
        .find((p) => /\/game\/undercover\//.test(p.page.url()))
        ?.page.url();

      // All 3 players should see "Your word:" reminder (no Mr. White in 3-player games)
      let wordCount = 0;
      for (const player of setup.players) {
        // Recover players redirected away during the describing→voting transition
        if (!/\/game\/undercover\//.test(player.page.url()) && gameUrl) {
          await player.page.goto(gameUrl);
          await player.page.waitForLoadState("domcontentloaded");
        }

        const wordReminder = player.page.locator("text=Your word").first();
        let isVisible = await wordReminder
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);

        // Reload to trigger get_undercover_state reconnection handler
        if (!isVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          isVisible = await wordReminder
            .waitFor({ state: "visible", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
        }

        if (isVisible) wordCount++;
      }
      expect(wordCount).toBe(3);
    } finally {
      await setup.cleanup();
    }
  });

  test("vote selection highlights chosen target and disables buttons", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      const voter = setup.players[0];
      const target1 = setup.players[1].login.user.username;

      const voteButton = voter.page.locator(
        `button:has(.font-medium:text("${target1}"))`,
      );
      await expect(voteButton).toBeEnabled({ timeout: 5_000 });

      // Click to SELECT (not vote yet)
      await voteButton.click();

      // "Selected" text should appear on the chosen card
      await expect(
        voter.page.locator("text=Selected").first(),
      ).toBeVisible({ timeout: 5_000 });

      // Buttons should still be enabled (not voted yet)
      await expect(voteButton).toBeEnabled();

      // Click "Vote to Eliminate" to CONFIRM the vote
      const confirmBtn = voter.page.locator("button:has-text('Vote to Eliminate')");
      await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
      await confirmBtn.click();

      // After confirming: all vote buttons should be disabled
      const allVoteButtons = voter.page.locator(".grid.gap-3 button");
      const count = await allVoteButtons.count();
      for (let i = 0; i < count; i++) {
        await expect(allVoteButtons.nth(i)).toBeDisabled({ timeout: 10_000 });
      }

      // "Waiting for other players to vote..." message should appear
      await expect(
        voter.page.locator("text=Waiting for other players"),
      ).toBeVisible({ timeout: 5_000 });

      // "Voted" indicator should be visible
      await expect(
        voter.page.locator("text=Voted").first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await setup.cleanup();
    }
  });

  test("elimination occurs after all alive players vote via UI", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      const targetUsername = setup.players[2].login.user.username;
      const player1Username = setup.players[0].login.user.username;

      await voteForPlayer(setup.players[0].page, targetUsername);
      await voteForPlayer(setup.players[1].page, targetUsername);
      await voteForPlayer(setup.players[2].page, player1Username);

      for (const player of setup.players) {
        await expect(
          player.page
            .locator(".lucide-skull, h2:has-text('Game Over')")
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("players list shows correct count for 3 players via UI", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      // Player list should show 3/3 alive
      for (const player of setup.players) {
        await expect(
          player.page.locator("text=Players (3/3)"),
        ).toBeVisible({ timeout: 10_000 });
      }

      // Each player should see 2 vote targets (not self)
      for (const player of setup.players) {
        const targets = await getAliveVoteTargets(player.page);
        expect(targets).toHaveLength(2);
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("voted indicator shows which players have voted", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      const targetUsername = setup.players[2].login.user.username;
      await voteForPlayer(setup.players[0].page, targetUsername);

      await expect(
        setup.players[0].page.locator("text=Voted").first(),
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        setup.players[0].page.locator("text=Waiting for other players"),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await setup.cleanup();
    }
  });
});
