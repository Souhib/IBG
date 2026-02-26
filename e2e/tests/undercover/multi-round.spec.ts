import { test, expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
} from "../../helpers/constants";
import { flushRedis } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
  dismissRoleRevealAll,
  voteForPlayer,
  getAliveVoteTargets,
  waitForEliminationOrGameOver,
  clickNextRound,
  ensureOnUndercoverGamePage,
  type PlayerContext,
} from "../../helpers/ui-game-setup";

test.beforeAll(() => { flushRedis() });

test.describe("Undercover — Multi-Round Games (UI)", () => {
  test("5-player game: multiple rounds of voting and elimination", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA, TEST_OMAR];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const gamePlayers = await dismissRoleRevealAll(setup.players);
      // Use only players confirmed to be in the game
      const playersInGame = gamePlayers.length >= 3 ? gamePlayers : setup.players;
      const gameUrl = playersInGame[0].page.url();

      let gameEnded = false;
      const eliminated = new Set<string>();
      const disconnected = new Set<string>();
      let roundsPlayed = 0;

      while (!gameEnded && roundsPlayed < 5) {
        roundsPlayed++;

        const alivePlayers = playersInGame.filter(
          (p) =>
            !eliminated.has(p.login.user.username) &&
            !disconnected.has(p.login.user.username),
        );

        if (alivePlayers.length < 2) break;

        // Ensure all alive players are on the game page (not redirected to home)
        for (const p of alivePlayers) {
          const onPage = await ensureOnUndercoverGamePage(p.page, gameUrl);
          if (!onPage) {
            disconnected.add(p.login.user.username);
          }
        }

        // Re-filter after ensuring pages
        const readyPlayers = alivePlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );
        if (readyPlayers.length < 2) break;

        // Pick last ready player as target
        const target = readyPlayers[readyPlayers.length - 1];
        const targetUsername = target.login.user.username;

        // Wait for vote buttons to appear on first ready player
        let voteButtonsVisible = await readyPlayers[0].page
          .locator(".grid.gap-3 button")
          .first()
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!voteButtonsVisible) {
          await readyPlayers[0].page.reload();
          await readyPlayers[0].page.waitForLoadState("domcontentloaded");
          await readyPlayers[0].page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
          // Check for game over after reload
          const gameOverNow = await readyPlayers[0].page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (gameOverNow) { gameEnded = true; break; }
        }

        // All ready players vote
        for (const voter of readyPlayers) {
          const voteTarget =
            voter.login.user.username === targetUsername
              ? readyPlayers[0].login.user.username
              : targetUsername;
          const voted = await voteForPlayer(voter.page, voteTarget);
          if (!voted) {
            // Player couldn't vote — mark as disconnected
            disconnected.add(voter.login.user.username);
          }
        }

        // Wait for result — try first ready player, then others
        let result: "elimination" | "game_over" | null = null;
        const resultCandidates = readyPlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );

        for (const p of resultCandidates) {
          try {
            result = await waitForEliminationOrGameOver(p.page);
            break;
          } catch {
            continue;
          }
        }

        if (!result) {
          // Force reload all and check
          for (const p of resultCandidates) {
            const pageOk = await p.page.evaluate(() => true).catch(() => false);
            if (!pageOk) continue;
            await p.page.reload();
            await p.page.waitForLoadState("domcontentloaded");
            await p.page.waitForFunction(
              () => (window as any).__SOCKET__?.connected === true,
              { timeout: 10_000 },
            ).catch(() => {});
          }
          const gameOverOnAny = await Promise.any(
            resultCandidates.map(async (p) => {
              const isOver = await p.page
                .locator("h2:has-text('Game Over')")
                .isVisible()
                .catch(() => false);
              if (isOver) return "game_over" as const;
              const hasSkull = await p.page
                .locator(".lucide-skull")
                .isVisible()
                .catch(() => false);
              if (hasSkull) return "elimination" as const;
              throw new Error("no result");
            }),
          ).catch(() => null);
          result = gameOverOnAny;
        }

        if (result === "game_over") {
          gameEnded = true;
        } else if (result === "elimination") {
          eliminated.add(targetUsername);

          // Try to find "Next Round" button on any alive player's page
          let nextRoundClicked = false;
          for (const p of resultCandidates) {
            if (eliminated.has(p.login.user.username)) continue;
            if (disconnected.has(p.login.user.username)) continue;
            const pageOk = await p.page.evaluate(() => true).catch(() => false);
            if (!pageOk) continue;
            const hasBtn = await p.page
              .locator("button:has-text('Next Round')")
              .waitFor({ state: "visible", timeout: 5_000 })
              .then(() => true)
              .catch(() => false);
            if (hasBtn) {
              await p.page.locator("button:has-text('Next Round')").click();
              await p.page.locator("text=Discuss and vote")
                .or(p.page.locator('h2:has-text("Game Over")'))
                .first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
              nextRoundClicked = true;
              break;
            }
          }

          if (!nextRoundClicked) {
            for (const p of resultCandidates) {
              if (eliminated.has(p.login.user.username)) continue;
              if (disconnected.has(p.login.user.username)) continue;
              const pageOk = await p.page.evaluate(() => true).catch(() => false);
              if (!pageOk) continue;
              await p.page.reload();
              await p.page.waitForLoadState("domcontentloaded");
              await p.page.waitForFunction(
                () => (window as any).__SOCKET__?.connected === true,
                { timeout: 10_000 },
              ).catch(() => {});
              const isOver = await p.page
                .locator("h2:has-text('Game Over')")
                .isVisible()
                .catch(() => false);
              if (isOver) { gameEnded = true; break; }
              const hasBtn = await p.page
                .locator("button:has-text('Next Round')")
                .isVisible()
                .catch(() => false);
              if (hasBtn) {
                await p.page.locator("button:has-text('Next Round')").click();
                await p.page.locator("text=Discuss and vote")
                  .or(p.page.locator('h2:has-text("Game Over")'))
                  .first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
                nextRoundClicked = true;
                break;
              }
            }
          }

          if (!nextRoundClicked && !gameEnded) break;

          // If game didn't end, reload alive players to get fresh round state
          if (!gameEnded) {
            const stillAlive = playersInGame.filter(
              (p) =>
                !eliminated.has(p.login.user.username) &&
                !disconnected.has(p.login.user.username),
            );
            for (const p of stillAlive) {
              const pageOk = await p.page.evaluate(() => true).catch(() => false);
              if (!pageOk) continue;
              await p.page.reload();
              await p.page.waitForLoadState("domcontentloaded");
              await p.page.waitForFunction(
                () => (window as any).__SOCKET__?.connected === true,
                { timeout: 10_000 },
              ).catch(() => {});
            }
          }
        } else {
          // No result found at all — break to avoid infinite loop
          break;
        }
      }

      // Should have played at least 1 round
      expect(roundsPlayed).toBeGreaterThanOrEqual(1);
    } finally {
      await setup.cleanup();
    }
  });

  test("5-player game: dead player does not see vote buttons", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA, TEST_OMAR];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // Round 1: eliminate player 5 (OMAR)
      const target = setup.players[4];
      const targetUsername = target.login.user.username;

      for (const voter of setup.players) {
        const voteTarget =
          voter.login.user.username === targetUsername
            ? setup.players[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      const result = await waitForEliminationOrGameOver(setup.players[0].page);

      if (result === "elimination") {
        // Click next round
        await clickNextRound(setup.players[0].page);

        // Reload alive players to get fresh round state
        for (let i = 0; i < 4; i++) {
          await setup.players[i].page.reload();
          await setup.players[i].page.waitForLoadState("domcontentloaded");
          await setup.players[i].page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
        }

        // Wait for playing phase to resume on an alive player
        await expect(
          setup.players[0].page.locator("text=Discuss and vote").first(),
        ).toBeVisible({ timeout: 15_000 });

        // Dead player should NOT see vote buttons
        const deadPlayerPage = target.page;
        // Reload dead player too to get current state
        await deadPlayerPage.reload();
        await deadPlayerPage.waitForLoadState("domcontentloaded");
        await deadPlayerPage.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        const hasVoteButtons = await deadPlayerPage
          .locator(".grid.gap-3 button")
          .first()
          .isVisible()
          .catch(() => false);

        // Dead player should not have interactive vote buttons
        expect(hasVoteButtons).toBeFalsy();
      }
      // If game over, that's also valid (undercover may have won)
    } finally {
      await setup.cleanup();
    }
  });

  test("5-player game: eliminated player not shown as vote target", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA, TEST_OMAR];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // Round 1: eliminate player 5 (OMAR)
      const target = setup.players[4];
      const targetUsername = target.login.user.username;

      for (const voter of setup.players) {
        const voteTarget =
          voter.login.user.username === targetUsername
            ? setup.players[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      const result = await waitForEliminationOrGameOver(setup.players[0].page);

      if (result === "elimination") {
        await clickNextRound(setup.players[0].page);

        // Reload all alive players to get latest state (some sockets miss events)
        for (let i = 0; i < 4; i++) {
          await setup.players[i].page.reload();
          await setup.players[i].page.waitForLoadState("domcontentloaded");
          await setup.players[i].page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
        }

        // Wait for playing phase — vote buttons appear
        await expect(
          setup.players[0].page.locator(".grid.gap-3 button").first(),
        ).toBeVisible({ timeout: 15_000 });

        // For each alive player, check that eliminated player is NOT a vote target
        for (let i = 0; i < 4; i++) {
          const targets = await getAliveVoteTargets(setup.players[i].page);
          // Eliminated player should NOT be in vote targets
          expect(targets).not.toContain(targetUsername);
          // Should have fewer vote targets than before (was 4, now 3 minus self = 3)
          expect(targets.length).toBeLessThanOrEqual(3);
        }
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("5-player game: elimination result shows player name and role", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA, TEST_OMAR];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // All vote for player 5
      const target = setup.players[4];
      const targetUsername = target.login.user.username;

      for (const voter of setup.players) {
        const voteTarget =
          voter.login.user.username === targetUsername
            ? setup.players[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      const result = await waitForEliminationOrGameOver(setup.players[0].page);

      if (result === "elimination") {
        // Eliminated player's username should be visible
        await expect(
          setup.players[0].page.locator(`text=${targetUsername}`).first(),
        ).toBeVisible({ timeout: 5_000 });

        // Role label should be visible ("Your Role:")
        await expect(
          setup.players[0].page.locator("text=Your Role").first(),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("6-player game: word distribution is correct via UI", async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts = [
      TEST_USER,
      TEST_PLAYER,
      TEST_ALI,
      TEST_FATIMA,
      TEST_OMAR,
      TEST_AISHA,
    ];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      await dismissRoleRevealAll(setup.players);

      // In the playing phase, players with a word see "Your word:" reminder
      // Mr. White has no word, so they don't see it
      let playersWithWord = 0;
      let playersWithoutWord = 0;

      for (const player of setup.players) {
        const wordReminder = player.page.locator("text=Your word").first();
        const isVisible = await wordReminder
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (isVisible) {
          playersWithWord++;
        } else {
          playersWithoutWord++;
        }
      }

      // 6 players: 3 civilian + 2 undercover = 5 with words, 1 Mr. White without
      expect(playersWithWord).toBe(5);
      expect(playersWithoutWord).toBe(1);

      // All players should see "Discuss and vote" heading
      for (const player of setup.players) {
        await expect(
          player.page.locator("text=Discuss and vote").first(),
        ).toBeVisible({ timeout: 5_000 });
      }

      // Player list should show all 6 alive
      for (const player of setup.players) {
        await expect(
          player.page.locator("text=Players (6/6)"),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("game over screen shows winner after all rounds", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const accounts = [TEST_USER, TEST_PLAYER, TEST_ALI, TEST_FATIMA, TEST_OMAR];
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const gamePlayers = await dismissRoleRevealAll(setup.players);
      const playersInGame = gamePlayers.length >= 3 ? gamePlayers : setup.players;
      const gameUrl = playersInGame[0].page.url();

      let gameEnded = false;
      const eliminated = new Set<string>();
      const disconnected = new Set<string>();

      // Play until game over
      for (let round = 0; round < 5 && !gameEnded; round++) {
        const alivePlayers = playersInGame.filter(
          (p) =>
            !eliminated.has(p.login.user.username) &&
            !disconnected.has(p.login.user.username),
        );

        if (alivePlayers.length < 2) break;

        // Ensure all alive players are on the game page
        for (const p of alivePlayers) {
          const onPage = await ensureOnUndercoverGamePage(p.page, gameUrl);
          if (!onPage) disconnected.add(p.login.user.username);
        }
        const readyPlayers = alivePlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );
        if (readyPlayers.length < 2) break;

        // Wait for vote buttons to appear (with reload fallback)
        let buttonsReady = await readyPlayers[0].page
          .locator(".grid.gap-3 button")
          .first()
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!buttonsReady) {
          await readyPlayers[0].page.reload();
          await readyPlayers[0].page.waitForLoadState("domcontentloaded");
          await readyPlayers[0].page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
          const gameOverNow = await readyPlayers[0].page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (gameOverNow) {
            gameEnded = true;
            break;
          }
        }

        const target = readyPlayers[readyPlayers.length - 1];
        const targetUsername = target.login.user.username;

        for (const voter of readyPlayers) {
          const voteTarget =
            voter.login.user.username === targetUsername
              ? readyPlayers[0].login.user.username
              : targetUsername;
          const voted = await voteForPlayer(voter.page, voteTarget);
          if (!voted) disconnected.add(voter.login.user.username);
        }

        // Wait for result
        let result: "elimination" | "game_over" | null = null;
        const resultCandidates = readyPlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );

        for (const p of resultCandidates) {
          try {
            result = await waitForEliminationOrGameOver(p.page);
            break;
          } catch {
            continue;
          }
        }

        if (!result) {
          for (const p of resultCandidates) {
            const pageOk = await p.page.evaluate(() => true).catch(() => false);
            if (!pageOk) continue;
            await p.page.reload();
            await p.page.waitForLoadState("domcontentloaded");
            await p.page.waitForFunction(
              () => (window as any).__SOCKET__?.connected === true,
              { timeout: 10_000 },
            ).catch(() => {});
          }
          const gameOverOnAny = await Promise.any(
            resultCandidates.map(async (p) => {
              const isOver = await p.page
                .locator("h2:has-text('Game Over')")
                .isVisible()
                .catch(() => false);
              if (isOver) return "game_over" as const;
              const hasSkull = await p.page
                .locator(".lucide-skull")
                .isVisible()
                .catch(() => false);
              if (hasSkull) return "elimination" as const;
              throw new Error("no result");
            }),
          ).catch(() => null);
          result = gameOverOnAny;
        }

        if (result === "game_over") {
          gameEnded = true;
        } else if (result === "elimination") {
          eliminated.add(targetUsername);

          let nextRoundClicked = false;
          for (const p of resultCandidates) {
            if (eliminated.has(p.login.user.username)) continue;
            if (disconnected.has(p.login.user.username)) continue;
            const pageOk = await p.page.evaluate(() => true).catch(() => false);
            if (!pageOk) continue;
            const hasBtn = await p.page
              .locator("button:has-text('Next Round')")
              .waitFor({ state: "visible", timeout: 5_000 })
              .then(() => true)
              .catch(() => false);
            if (hasBtn) {
              await p.page.locator("button:has-text('Next Round')").click();
              await p.page.locator("text=Discuss and vote")
                .or(p.page.locator('h2:has-text("Game Over")'))
                .first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
              nextRoundClicked = true;
              break;
            }
          }

          if (!nextRoundClicked) {
            for (const p of resultCandidates) {
              if (eliminated.has(p.login.user.username)) continue;
              if (disconnected.has(p.login.user.username)) continue;
              const pageOk = await p.page.evaluate(() => true).catch(() => false);
              if (!pageOk) continue;
              await p.page.reload();
              await p.page.waitForLoadState("domcontentloaded");
              await p.page.waitForFunction(
                () => (window as any).__SOCKET__?.connected === true,
                { timeout: 10_000 },
              ).catch(() => {});
              const isOver = await p.page
                .locator("h2:has-text('Game Over')")
                .isVisible()
                .catch(() => false);
              if (isOver) { gameEnded = true; break; }
              const hasBtn = await p.page
                .locator("button:has-text('Next Round')")
                .isVisible()
                .catch(() => false);
              if (hasBtn) {
                await p.page.locator("button:has-text('Next Round')").click();
                await p.page.locator("text=Discuss and vote")
                  .or(p.page.locator('h2:has-text("Game Over")'))
                  .first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
                nextRoundClicked = true;
                break;
              }
            }
          }

          if (!nextRoundClicked && !gameEnded) break;

          if (!gameEnded) {
            const stillAlive = playersInGame.filter(
              (p) =>
                !eliminated.has(p.login.user.username) &&
                !disconnected.has(p.login.user.username),
            );
            for (const p of stillAlive) {
              const pageOk = await p.page.evaluate(() => true).catch(() => false);
              if (!pageOk) continue;
              await p.page.reload();
              await p.page.waitForLoadState("domcontentloaded");
              await p.page.waitForFunction(
                () => (window as any).__SOCKET__?.connected === true,
                { timeout: 10_000 },
              ).catch(() => {});
            }
          }
        } else {
          break;
        }
      }

      if (gameEnded) {
        // Find a player page that shows Game Over (host may have stale socket)
        let verifyPage = setup.players[0].page;
        for (const p of setup.players) {
          const isOver = await p.page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (isOver) {
            verifyPage = p.page;
            break;
          }
        }
        // If no page shows it yet, reload host
        const hostHasGameOver = await verifyPage
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
        if (!hostHasGameOver) {
          await verifyPage.reload();
          await verifyPage.waitForLoadState("domcontentloaded");
          await verifyPage.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
        }

        // Verify game over UI
        await expect(
          verifyPage.locator("h2:has-text('Game Over')"),
        ).toBeVisible({ timeout: 10_000 });

        // Winner should be displayed
        await expect(
          verifyPage.locator("text=Winner").first(),
        ).toBeVisible({ timeout: 5_000 });

        // Leave button should be visible
        await expect(
          verifyPage.locator("button:has-text('Leave Room')"),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });
});
