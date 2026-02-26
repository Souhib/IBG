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
  voteForPlayer,
  waitForEliminationOrGameOver,
  clickNextRound,
} from "../../helpers/ui-game-setup";

test.beforeAll(async () => { await flushRedis() });

test.describe("Undercover — Full Game Flow (UI)", () => {
  test("3-player game: start → playing phase → vote → elimination/game over", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // ─── Verify Playing Phase ───────────────────────────
      for (const player of setup.players) {
        // "Discuss and vote to eliminate" should be visible
        await expect(
          player.page.locator("text=Discuss and vote").first(),
        ).toBeVisible({ timeout: 10_000 });
      }

      // ─── Vote: All Players Vote for Player 3 (ALI) ─────
      const targetUsername = setup.players[2].login.user.username;
      const player1Username = setup.players[0].login.user.username;

      // Players 1 and 2 vote for player 3
      await voteForPlayer(setup.players[0].page, targetUsername);
      await voteForPlayer(setup.players[1].page, targetUsername);
      // Player 3 votes for player 1
      await voteForPlayer(setup.players[2].page, player1Username);

      // ─── Wait for Elimination or Game Over ──────────────
      const result = await waitForEliminationOrGameOver(setup.players[0].page);

      if (result === "game_over") {
        await expect(
          setup.players[0].page.locator("h2:has-text('Game Over')"),
        ).toBeVisible();
      } else {
        // Verify elimination screen shows target's name
        await expect(
          setup.players[0].page.locator(`text=${targetUsername}`).first(),
        ).toBeVisible();

        // "Next Round" button should be visible
        await expect(
          setup.players[0].page.locator("button:has-text('Next Round')"),
        ).toBeVisible();
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("players see their word after game starts", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // Each player should see their word reminder (no Mr. White in 3-player games)
      let wordCount = 0;
      for (const player of setup.players) {
        const wordReminder = player.page.locator("text=Your word").first();
        const isVisible = await wordReminder
          .isVisible({ timeout: 5_000 })
          .catch(() => false);
        if (isVisible) wordCount++;
      }
      // All 3 players should see their word (2 civilians + 1 undercover)
      expect(wordCount).toBe(3);

      // Players list should show all 3 players
      for (const player of setup.players) {
        await expect(
          player.page.locator("text=Players (3/3)"),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("3-player game plays to game over through multiple rounds if needed", async ({
    browser,
  }) => {
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      let gameEnded = false;
      const eliminated = new Set<string>();

      for (let round = 0; round < 3 && !gameEnded; round++) {
        const alivePlayers = setup.players.filter(
          (p) => !eliminated.has(p.login.user.username),
        );

        if (alivePlayers.length < 2) break;

        const target = alivePlayers[alivePlayers.length - 1];
        const targetUsername = target.login.user.username;

        // Wait for vote buttons to appear for the first alive player
        await expect(
          alivePlayers[0].page.locator(".grid.gap-3 button").first(),
        ).toBeVisible({ timeout: 15_000 });

        for (const voter of alivePlayers) {
          const voteTarget =
            voter.login.user.username === targetUsername
              ? alivePlayers[0].login.user.username
              : targetUsername;

          // Check if vote buttons are available
          const hasVoteButtons = await voter.page
            .locator(".grid.gap-3 button")
            .first()
            .isVisible({ timeout: 5_000 })
            .catch(() => false);

          if (hasVoteButtons) {
            await voteForPlayer(voter.page, voteTarget);
          }
        }

        const result = await waitForEliminationOrGameOver(
          setup.players[0].page,
        );

        if (result === "game_over") {
          gameEnded = true;
        } else {
          eliminated.add(targetUsername);
          await clickNextRound(setup.players[0].page);

          gameEnded = await setup.players[0].page
            .locator("h2:has-text('Game Over')")
            .isVisible({ timeout: 5_000 })
            .catch(() => false);
        }
      }

      expect(gameEnded || eliminated.size >= 1).toBeTruthy();
    } finally {
      await setup.cleanup();
    }
  });
});
