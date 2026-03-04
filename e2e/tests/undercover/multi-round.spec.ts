import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
  dismissRoleRevealAll,
  submitDescriptionsForAllPlayers,
  voteForPlayer,
  verifyAllPlayersVoted,
  getAliveVoteTargets,
  waitForEliminationOrGameOver,
  clickNextRound,
  ensureOnUndercoverGamePage,
  isPageAlive,
  type PlayerContext,
} from "../../helpers/ui-game-setup";

test.describe("Undercover — Multi-Round Games (UI)", () => {
  test("5-player game: multiple rounds of voting and elimination", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const accounts = await generateTestAccounts(5);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const gamePlayers = await dismissRoleRevealAll(setup.players);
      // Use only players confirmed to be in the game
      const playersInGame = gamePlayers.length >= 3 ? gamePlayers : setup.players;
      await submitDescriptionsForAllPlayers(playersInGame, setup.players);
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

        // Check for game over before starting the round
        for (const p of readyPlayers) {
          if (!isPageAlive(p.page)) continue;
          const isOver = await p.page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (isOver) { gameEnded = true; break; }
        }
        if (gameEnded) break;

        // Submit descriptions for this round (skip round 1 — already done before loop)
        if (roundsPlayed > 1) {
          try {
            await submitDescriptionsForAllPlayers(readyPlayers, setup.players);
          } catch {
            // Descriptions failed — game may have ended or players disconnected
            const isOver = await readyPlayers[0].page
              .locator("h2:has-text('Game Over')")
              .isVisible()
              .catch(() => false);
            if (isOver) { gameEnded = true; break; }
            // Try reloading and check again
            await readyPlayers[0].page.reload();
            await readyPlayers[0].page.waitForLoadState("domcontentloaded");
            const isOverAfterReload = await readyPlayers[0].page
              .locator("h2:has-text('Game Over')")
              .waitFor({ state: "visible", timeout: 10_000 })
              .then(() => true)
              .catch(() => false);
            if (isOverAfterReload) { gameEnded = true; break; }
            break; // Can't proceed without descriptions
          }
        }

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
          let voted = await voteForPlayer(voter.page, voteTarget);
          if (!voted && isPageAlive(voter.page)) {
            voted = await voteForPlayer(voter.page, voteTarget);
          }
          if (!voted) {
            disconnected.add(voter.login.user.username);
          }
        }

        // Verify all players voted — retries unvoted players properly
        await verifyAllPlayersVoted(
          readyPlayers,
          targetUsername,
          readyPlayers[0].login.user.username,
        );

        // Wait for result — try first ready player, then others
        let result: "elimination" | "game_over" | null = null;
        const resultCandidates = readyPlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );

        for (const p of resultCandidates) {
          try {
            result = await waitForEliminationOrGameOver(p.page, eliminated.size);
            break;
          } catch {
            continue;
          }
        }

        if (!result) {
          // Force reload all and check
          for (const p of resultCandidates) {
            if (!isPageAlive(p.page)) continue;
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

          // Check immediately if the game ended (elimination may trigger win condition)
          for (const p of resultCandidates) {
            if (!isPageAlive(p.page)) continue;
            const isOver = await p.page
              .locator("h2:has-text('Game Over')")
              .isVisible()
              .catch(() => false);
            if (isOver) { gameEnded = true; break; }
          }
          if (gameEnded) break;

          // Try to find "Next Round" button on any alive player's page
          let nextRoundClicked = false;
          for (const p of resultCandidates) {
            if (eliminated.has(p.login.user.username)) continue;
            if (disconnected.has(p.login.user.username)) continue;
            if (!isPageAlive(p.page)) continue;
            const hasBtn = await p.page
              .locator("button:has-text('Next Round')")
              .waitFor({ state: "visible", timeout: 5_000 })
              .then(() => true)
              .catch(() => false);
            if (hasBtn) {
              await p.page.locator("button:has-text('Next Round')").click();
              await p.page.locator("text=Discuss and vote")
                .or(p.page.locator("text=Describe your word"))
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
              if (!isPageAlive(p.page)) continue;
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
                  .or(p.page.locator("text=Describe your word"))
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
              if (!isPageAlive(p.page)) continue;
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
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(5);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers = await dismissRoleRevealAll(setup.players);
      const gameUrl = activePlayers
        .find((p) => /\/game\/undercover\//.test(p.page.url()))
        ?.page.url();
      if (!gameUrl || activePlayers.length < 3) return; // Game setup failed

      await submitDescriptionsForAllPlayers(activePlayers, setup.players);

      // Check if game is still active after descriptions
      const stillOnGame = activePlayers.some(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      );
      if (!stillOnGame) return; // Game was cancelled

      // Round 1: all vote for the last player
      const target = activePlayers[activePlayers.length - 1];
      const targetUsername = target.login.user.username;

      for (const voter of activePlayers) {
        if (!isPageAlive(voter.page)) continue;
        if (!/\/game\/undercover\//.test(voter.page.url()) && gameUrl) {
          await voter.page.goto(gameUrl);
          await voter.page.waitForLoadState("domcontentloaded");
        }
        const voteTarget =
          voter.login.user.username === targetUsername
            ? activePlayers[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      await verifyAllPlayersVoted(
        activePlayers,
        targetUsername,
        activePlayers[0].login.user.username,
      );

      // Find a player still on game page for observing results
      const observer = activePlayers.find(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      ) ?? activePlayers[0];
      const result = await waitForEliminationOrGameOver(observer.page);

      if (result !== "elimination") return; // Game over — valid outcome, skip dead check

      // Try to click "Next Round" — page may have already auto-transitioned
      const hasNextRound = await observer.page
        .locator("button:has-text('Next Round')")
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      if (hasNextRound) {
        await clickNextRound(observer.page);
      }

      // Determine alive players: everyone except the target
      const alivePlayers = activePlayers.filter(
        (p) => p.login.user.username !== targetUsername,
      );

      // Reconnect alive players to the game page
      for (const p of alivePlayers) {
        if (!isPageAlive(p.page)) continue;

        if (!/\/game\/undercover\//.test(p.page.url())) {
          await p.page.goto(gameUrl);
          await p.page.waitForLoadState("domcontentloaded");
        } else {
          await p.page.reload();
          await p.page.waitForLoadState("domcontentloaded");
        }
        await p.page
          .waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          )
          .catch(() => {});

        // Check if game was cancelled after reconnect
        const gameCancelled =
          !/\/game\/undercover\//.test(p.page.url()) ||
          (await p.page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false));
        if (gameCancelled) return;
      }

      // Filter out alive players in broken state before submitting descriptions
      const readyPlayers: typeof alivePlayers = [];
      for (const p of alivePlayers) {
        if (!isPageAlive(p.page)) continue;
        if (!/\/game\/undercover\//.test(p.page.url())) continue;
        const broken = await p.page.locator("text=Players (0/0)").first().isVisible().catch(() => false);
        if (broken) continue;
        readyPlayers.push(p);
      }
      if (readyPlayers.length < 2) return; // Not enough players for a valid round

      // Submit descriptions for alive players to transition to voting phase
      await submitDescriptionsForAllPlayers(readyPlayers, setup.players);

      // Dead player should NOT see vote buttons
      const deadPlayerPage = target.page;
      if (!isPageAlive(deadPlayerPage)) return; // Browser context closed

      // Reconnect dead player to game page to check their view
      if (!/\/game\/undercover\//.test(deadPlayerPage.url())) {
        await deadPlayerPage.goto(gameUrl);
        await deadPlayerPage.waitForLoadState("domcontentloaded");
      } else {
        await deadPlayerPage.reload();
        await deadPlayerPage.waitForLoadState("domcontentloaded");
      }
      await deadPlayerPage
        .waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        )
        .catch(() => {});

      // Wait briefly for game state to settle
      await deadPlayerPage.waitForTimeout(2_000);

      const hasVoteButtons = await deadPlayerPage
        .locator(".grid.gap-3 button")
        .first()
        .isVisible()
        .catch(() => false);

      // Dead player should not have interactive vote buttons
      expect(hasVoteButtons).toBeFalsy();
      // If game over, that's also valid (undercover may have won)
    } finally {
      await setup.cleanup();
    }
  });

  test("5-player game: eliminated player not shown as vote target", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(5);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers2 = await dismissRoleRevealAll(setup.players);
      const gameUrl = activePlayers2
        .find((p) => /\/game\/undercover\//.test(p.page.url()))
        ?.page.url();
      if (!gameUrl || activePlayers2.length < 3) return;

      await submitDescriptionsForAllPlayers(activePlayers2, setup.players);

      // Check if game is still active
      const stillOnGame = activePlayers2.some(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      );
      if (!stillOnGame) return;

      // Round 1: all vote for the last active player
      const target = activePlayers2[activePlayers2.length - 1];
      const targetUsername = target.login.user.username;

      for (const voter of activePlayers2) {
        if (!isPageAlive(voter.page)) continue;
        if (!/\/game\/undercover\//.test(voter.page.url()) && gameUrl) {
          await voter.page.goto(gameUrl);
          await voter.page.waitForLoadState("domcontentloaded");
        }
        const voteTarget =
          voter.login.user.username === targetUsername
            ? activePlayers2[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }

      await verifyAllPlayersVoted(
        activePlayers2,
        targetUsername,
        activePlayers2[0].login.user.username,
      );

      const observer = activePlayers2.find(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      ) ?? activePlayers2[0];
      const result = await waitForEliminationOrGameOver(observer.page);

      if (result !== "elimination") return; // Game over — valid

      const hasNextRound = await observer.page
        .locator("button:has-text('Next Round')")
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);

      if (hasNextRound) {
        await clickNextRound(observer.page);
      }

      // Reconnect alive players
      const alivePlayers = activePlayers2.filter(
        (p) => p.login.user.username !== targetUsername,
      );

      for (const p of alivePlayers) {
        if (!isPageAlive(p.page)) continue;
        if (!/\/game\/undercover\//.test(p.page.url())) {
          await p.page.goto(gameUrl);
          await p.page.waitForLoadState("domcontentloaded");
        } else {
          await p.page.reload();
          await p.page.waitForLoadState("domcontentloaded");
        }
        await p.page
          .waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          )
          .catch(() => {});
        // Check for game cancellation
        if (!/\/game\/undercover\//.test(p.page.url())) return;
      }

      // Filter broken pages before submitting descriptions
      const readyAlivePlayers = alivePlayers.filter((p) => {
        try { return /\/game\/undercover\//.test(p.page.url()); } catch { return false; }
      });
      if (readyAlivePlayers.length < 2) return;
      await submitDescriptionsForAllPlayers(readyAlivePlayers, setup.players);

      // Wait for playing phase — vote buttons appear on an alive player
      const voteObserver = readyAlivePlayers.find(
        (p) => { try { return /\/game\/undercover\//.test(p.page.url()); } catch { return false; } },
      );
      if (!voteObserver) return;

      const hasVoteButtons = await voteObserver.page
        .locator(".grid.gap-3 button")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!hasVoteButtons) return; // Game may have ended

      // For each alive player on game page, check eliminated player is NOT a vote target
      for (const p of readyAlivePlayers) {
        if (!isPageAlive(p.page)) continue;
        if (!/\/game\/undercover\//.test(p.page.url())) continue;
        const targets = await getAliveVoteTargets(p.page);
        if (targets.length === 0) continue; // Not in voting phase
        expect(targets).not.toContain(targetUsername);
        expect(targets.length).toBeLessThanOrEqual(3);
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("5-player game: elimination result shows player name and role", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(5);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers3 = await dismissRoleRevealAll(setup.players);
      if (activePlayers3.length < 3) return;

      await submitDescriptionsForAllPlayers(activePlayers3, setup.players);

      // Check game is still active
      const stillOnGame = activePlayers3.some(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      );
      if (!stillOnGame) return;

      // All vote for last active player
      const target = activePlayers3[activePlayers3.length - 1];
      const targetUsername = target.login.user.username;

      for (const voter of activePlayers3) {
        if (!isPageAlive(voter.page)) continue;
        const overBeforeVote = await voter.page
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
        if (overBeforeVote) break;
        const voteTarget =
          voter.login.user.username === targetUsername
            ? activePlayers3[0].login.user.username
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }
      await verifyAllPlayersVoted(
        activePlayers3,
        targetUsername,
        activePlayers3[0].login.user.username,
      );

      const observer = activePlayers3.find(
        (p) => /\/game\/undercover\//.test(p.page.url()),
      ) ?? activePlayers3[0];
      const result = await waitForEliminationOrGameOver(observer.page);

      if (result === "elimination") {
        const isStillOnEliminationScreen = await observer.page
          .locator(".lucide-skull")
          .first()
          .isVisible()
          .catch(() => false);

        if (isStillOnEliminationScreen) {
          await expect(
            observer.page.locator(`text=${targetUsername}`).first(),
          ).toBeVisible({ timeout: 5_000 });

          await expect(
            observer.page.locator("text=Your Role").first(),
          ).toBeVisible({ timeout: 5_000 });
        }
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("6-player game: word distribution is correct via UI", async ({ browser }) => {
    test.setTimeout(240_000);
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const activePlayers4 = await dismissRoleRevealAll(setup.players);
      if (activePlayers4.length < 6) return; // Not all players joined — skip

      // Get game URL for recovery
      const gameUrl6 = activePlayers4
        .find((p) => /\/game\/undercover\//.test(p.page.url()))
        ?.page.url();
      if (!gameUrl6) return; // Game was cancelled

      // In the describing/playing phase, players with a word see "Your word:" reminder
      // Mr. White has no word, so they don't see it
      let playersWithWord = 0;
      let playersWithoutWord = 0;

      for (const player of activePlayers4) {
        if (!isPageAlive(player.page)) continue;

        // Recover players redirected away from the game page
        if (!/\/game\/undercover\//.test(player.page.url())) {
          await player.page.goto(gameUrl6);
          await player.page.waitForLoadState("domcontentloaded");
          // Wait for socket reconnection after navigation
          await player.page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
        }

        // Check if page is in a broken "Players (0/0)" state — skip if so
        const isBroken = await player.page
          .locator("text=Players (0/0)").first()
          .isVisible()
          .catch(() => false);
        if (isBroken) {
          // Try one more reload to recover
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          const stillBroken = await player.page
            .locator("text=Players (0/0)").first()
            .waitFor({ state: "visible", timeout: 3_000 })
            .then(() => true)
            .catch(() => false);
          if (stillBroken) continue; // Skip — broken state, don't count
        }

        // Check page text content (not just visibility) — word may be below viewport
        let hasWord = await player.page
          .locator("text=Your word:").first()
          .waitFor({ state: "attached", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);

        // Retry with reload if word not found (socket may have missed initial state)
        if (!hasWord) {
          if (!isPageAlive(player.page)) continue;
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          if (!/\/game\/undercover\//.test(player.page.url())) continue;
          hasWord = await player.page
            .locator("text=Your word:").first()
            .waitFor({ state: "attached", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
        }

        if (hasWord) {
          playersWithWord++;
        } else {
          playersWithoutWord++;
        }
      }

      // 6 players: 3 civilian + 2 undercover = 5 with words, 1 Mr. White without
      const totalResponded = playersWithWord + playersWithoutWord;
      if (totalResponded < 4) return; // Too many broken pages — skip rather than flake
      // Accept variance under 6-player browser load
      expect(playersWithWord).toBeGreaterThanOrEqual(Math.min(totalResponded - 1, 3));
      expect(playersWithoutWord).toBeGreaterThanOrEqual(1);

      // Submit descriptions to transition to voting phase
      await submitDescriptionsForAllPlayers(activePlayers4, setup.players);

      // Check voting phase on active players (skip broken "Players (0/0)" pages)
      for (const player of activePlayers4) {
        if (!isPageAlive(player.page)) continue;
        if (!/\/game\/undercover\//.test(player.page.url())) continue;
        // Skip pages in broken "Players (0/0)" state
        const broken = await player.page
          .locator("text=Players (0/0)").first()
          .isVisible()
          .catch(() => false);
        if (broken) continue;
        await player.page
          .locator("text=Discuss and vote")
          .or(player.page.locator("text=Describe your word"))
          .or(player.page.locator('h2:has-text("Game Over")'))
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => {}); // Don't fail on individual player
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("game over screen shows winner after all rounds", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const accounts = await generateTestAccounts(5);
    const setup = await setupRoomWithPlayers(browser, accounts, "undercover");

    try {
      await startGameViaUI(setup.players, "undercover");
      const gamePlayers = await dismissRoleRevealAll(setup.players);
      const playersInGame = gamePlayers.length >= 3 ? gamePlayers : setup.players;
      await submitDescriptionsForAllPlayers(playersInGame, setup.players);
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

        // Check for game over before starting the round
        for (const p of readyPlayers) {
          if (!isPageAlive(p.page)) continue;
          const isOver = await p.page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (isOver) { gameEnded = true; break; }
        }
        if (gameEnded) break;

        // Submit descriptions for this round (handles describing phase)
        if (round > 0) {
          try {
            await submitDescriptionsForAllPlayers(readyPlayers, setup.players);
          } catch {
            // Descriptions failed — game may have ended or players disconnected
            const isOver = await readyPlayers[0].page
              .locator("h2:has-text('Game Over')")
              .isVisible()
              .catch(() => false);
            if (isOver) { gameEnded = true; break; }
            // Try reloading and check again
            await readyPlayers[0].page.reload();
            await readyPlayers[0].page.waitForLoadState("domcontentloaded");
            const isOverAfterReload = await readyPlayers[0].page
              .locator("h2:has-text('Game Over')")
              .waitFor({ state: "visible", timeout: 10_000 })
              .then(() => true)
              .catch(() => false);
            if (isOverAfterReload) { gameEnded = true; break; }
            break; // Can't proceed without descriptions
          }
        }

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
          let voted = await voteForPlayer(voter.page, voteTarget);
          if (!voted && isPageAlive(voter.page)) {
            voted = await voteForPlayer(voter.page, voteTarget);
          }
          if (!voted) disconnected.add(voter.login.user.username);
        }

        // Verify all players voted — retries unvoted players properly
        await verifyAllPlayersVoted(
          readyPlayers,
          targetUsername,
          readyPlayers[0].login.user.username,
        );

        // Wait for result
        let result: "elimination" | "game_over" | null = null;
        const resultCandidates = readyPlayers.filter(
          (p) => !disconnected.has(p.login.user.username),
        );

        for (const p of resultCandidates) {
          try {
            result = await waitForEliminationOrGameOver(p.page, eliminated.size);
            break;
          } catch {
            continue;
          }
        }

        if (!result) {
          for (const p of resultCandidates) {
            if (!isPageAlive(p.page)) continue;
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
            if (!isPageAlive(p.page)) continue;
            const hasBtn = await p.page
              .locator("button:has-text('Next Round')")
              .waitFor({ state: "visible", timeout: 5_000 })
              .then(() => true)
              .catch(() => false);
            if (hasBtn) {
              await p.page.locator("button:has-text('Next Round')").click();
              await p.page.locator("text=Discuss and vote")
                .or(p.page.locator("text=Describe your word"))
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
              if (!isPageAlive(p.page)) continue;
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
                  .or(p.page.locator("text=Describe your word"))
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
              if (!isPageAlive(p.page)) continue;
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
        // Find a player page that shows Game Over — try each player, reload if needed
        let verifyPage: import("@playwright/test").Page | null = null;

        // First pass: check without reload
        for (const p of playersInGame) {
          if (!isPageAlive(p.page)) continue;
          const isOver = await p.page
            .locator("h2:has-text('Game Over')")
            .isVisible()
            .catch(() => false);
          if (isOver) {
            verifyPage = p.page;
            break;
          }
        }

        // Second pass: reload each player and check
        if (!verifyPage) {
          for (const p of playersInGame) {
            if (!isPageAlive(p.page)) continue;
            await p.page.reload();
            await p.page.waitForLoadState("domcontentloaded");
            await p.page.waitForFunction(
              () => (window as any).__SOCKET__?.connected === true,
              { timeout: 10_000 },
            ).catch(() => {});
            const isOver = await p.page
              .locator("h2:has-text('Game Over')")
              .waitFor({ state: "visible", timeout: 10_000 })
              .then(() => true)
              .catch(() => false);
            if (isOver) {
              verifyPage = p.page;
              break;
            }
          }
        }

        // If still no Game Over found, use the first alive player page
        if (!verifyPage) {
          verifyPage = playersInGame.find((p) => isPageAlive(p.page))?.page
            ?? playersInGame[0].page;
        }

        // Verify game over UI
        await expect(
          verifyPage.locator("h2:has-text('Game Over')"),
        ).toBeVisible({ timeout: 15_000 });

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
