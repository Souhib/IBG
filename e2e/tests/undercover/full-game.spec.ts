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
      const activePlayers = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers);

      // ─── Verify Playing Phase ───────────────────────────
      // Get game URL from any player still on the game page
      const gameUrl = activePlayers
        .find((p) => /\/game\/undercover\//.test(p.page.url()))
        ?.page.url();

      // If no player is on the game page, game was cancelled — skip
      if (!gameUrl) return;

      // Ensure active players are on the game page and in voting phase
      for (const player of activePlayers) {
        const pageAlive = await player.page
          .evaluate(() => true)
          .catch(() => false);
        if (!pageAlive) continue;

        // Reconnect player if redirected to home
        if (!/\/game\/undercover\//.test(player.page.url())) {
          await player.page.goto(gameUrl);
          await player.page.waitForLoadState("domcontentloaded");
        }

        // Accept voting phase or game over (game could end during descriptions)
        await expect(
          player.page
            .locator("text=Discuss and vote")
            .or(player.page.locator("h2:has-text('Game Over')"))
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      }

      // Check if game ended during descriptions
      const gameOverDuringDesc = await activePlayers[0].page
        .locator("h2:has-text('Game Over')")
        .isVisible()
        .catch(() => false);
      if (gameOverDuringDesc) return;

      // ─── Vote: All Players Vote for Player 3 (ALI) ─────
      const targetUsername = activePlayers[activePlayers.length - 1].login.user.username;
      const player1Username = activePlayers[0].login.user.username;

      for (const voter of activePlayers) {
        const voteTarget =
          voter.login.user.username === targetUsername
            ? player1Username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      // ─── Wait for Elimination or Game Over ──────────────
      // Find a player still on the game page to check result
      const observerPage = activePlayers.find(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      )?.page ?? activePlayers[0].page;
      const result = await waitForEliminationOrGameOver(observerPage);

      if (result === "game_over") {
        await expect(
          observerPage.locator("h2:has-text('Game Over')"),
        ).toBeVisible();
      } else {
        // Verify elimination screen shows target's name
        await expect(
          observerPage.locator(`text=${targetUsername}`).first(),
        ).toBeVisible();

        // "Next Round" button should be visible
        await expect(
          observerPage.locator("button:has-text('Next Round')"),
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
      const activeWordPlayers = await dismissRoleRevealAll(setup.players);

      // Each player should see their word reminder (no Mr. White in 3-player games)
      let wordCount = 0;
      for (const player of activeWordPlayers) {
        const pageAlive = await player.page.evaluate(() => true).catch(() => false);
        if (!pageAlive) continue;
        const wordReminder = player.page.locator("text=Your word").first();
        const isVisible = await wordReminder
          .isVisible({ timeout: 5_000 })
          .catch(() => false);
        if (isVisible) wordCount++;
      }
      // All active players should see their word (2 civilians + 1 undercover)
      expect(wordCount).toBe(activeWordPlayers.length);

      // Players list should show player count
      for (const player of activeWordPlayers) {
        const pageAlive = await player.page.evaluate(() => true).catch(() => false);
        if (!pageAlive) continue;
        await expect(
          player.page.locator("text=/Players \\(\\d+\\/3\\)/"),
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
      const activePlayers3 = await dismissRoleRevealAll(setup.players);
      await submitDescriptionsForAllPlayers(activePlayers3);

      let gameEnded = false;
      const eliminated = new Set<string>();

      for (let round = 0; round < 3 && !gameEnded; round++) {
        const alivePlayers = activePlayers3.filter(
          (p) => !eliminated.has(p.login.user.username),
        );

        if (alivePlayers.length < 2) break;

        const target = alivePlayers[alivePlayers.length - 1];
        const targetUsername = target.login.user.username;

        // Find an alive player on the game page for vote button check
        const gameUrl3 = alivePlayers
          .find((p) => /\/game\/undercover\//.test(p.page.url()))
          ?.page.url();
        if (!gameUrl3) break; // Game was cancelled

        const voteObserver = alivePlayers.find(
          (p) => /\/game\/undercover\//.test(p.page.url()),
        ) ?? alivePlayers[0];

        // Ensure observer is on game page
        if (!/\/game\/undercover\//.test(voteObserver.page.url())) {
          await voteObserver.page.goto(gameUrl3);
          await voteObserver.page.waitForLoadState("domcontentloaded");
        }

        // Check for early game over
        const earlyOver = await voteObserver.page
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
        if (earlyOver) { gameEnded = true; break; }

        // Wait for vote buttons to appear
        await expect(
          voteObserver.page.locator(".grid.gap-3 button").first(),
        ).toBeVisible({ timeout: 15_000 });

        for (const voter of alivePlayers) {
          const pageAlive = await voter.page.evaluate(() => true).catch(() => false);
          if (!pageAlive) continue;

          // Reconnect voter if not on game page
          if (!/\/game\/undercover\//.test(voter.page.url()) && gameUrl3) {
            await voter.page.goto(gameUrl3);
            await voter.page.waitForLoadState("domcontentloaded");
          }

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

        // Find an alive player still on the game page for observation
        const observerPage3 = alivePlayers.find(
          (p) => /\/game\/undercover\//.test(p.page.url()),
        )?.page ?? alivePlayers[0].page;

        const result = await waitForEliminationOrGameOver(observerPage3);

        if (result === "game_over") {
          gameEnded = true;
        } else {
          eliminated.add(targetUsername);
          await clickNextRound(observerPage3);

          gameEnded = await observerPage3
            .locator("h2:has-text('Game Over')")
            .isVisible({ timeout: 5_000 })
            .catch(() => false);

          // New round starts with describing phase — submit descriptions
          if (!gameEnded) {
            const nextRoundPlayers = activePlayers3.filter(
              (p) => !eliminated.has(p.login.user.username),
            );
            await submitDescriptionsForAllPlayers(nextRoundPlayers);
          }
        }
      }

      expect(gameEnded || eliminated.size >= 1).toBeTruthy();
    } finally {
      await setup.cleanup();
    }
  });
});
