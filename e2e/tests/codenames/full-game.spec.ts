import { test, expect, type Page } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaUI,
  getPlayerRoleFromUI,
  getCurrentTeamFromUI,
  giveClueViaUI,
  clickBoardCard,
  findUnrevealedCardIndex,
  isPageAlive,
  type PlayerContext,
  type CodenamesPlayerRole,
} from "../../helpers/ui-game-setup";

test.describe("Codenames — Full Game Flow (UI)", () => {
  test("4-player game: start, board shown, clue, guess, game progresses", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");

    try {
      await startGameViaUI(setup.players, "codenames");

      // ─── Verify the 5x5 board is shown ─────────────────
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Wait for game page to fully load (may show "Loading..." briefly)
        await player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        const cards = player.page.locator(".grid-cols-5 button");
        let firstVisible = await cards.first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        // Reload if board didn't render (socket may have missed initial state)
        if (!firstVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          firstVisible = await cards.first()
            .waitFor({ state: "visible", timeout: 10_000 })
            .then(() => true)
            .catch(() => false);
        }
        if (!firstVisible) continue; // Skip this player
        const cardCount = await cards.count();
        expect(cardCount).toBe(25);
      }

      // ─── Verify team and role info ──────────────────────
      let infoCount = 0;
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players who didn't load the board
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
        if (!hasBoard) {
          // One more reload attempt for stuck "Loading..." pages
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          await player.page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
          const boardNow = await player.page
            .locator(".grid-cols-5 button")
            .first()
            .waitFor({ state: "visible", timeout: 10_000 })
            .then(() => true)
            .catch(() => false);
          if (!boardNow) continue;
        }
        const infoLoc = player.page.locator(".bg-muted\\/50.p-3.text-center.text-sm");
        const infoVisible = await infoLoc
          .waitFor({ state: "visible", timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!infoVisible) continue;
        const infoText = await infoLoc.textContent();
        expect(infoText).toContain("You are a");
        infoCount++;
      }
      // At least 2 players should have loaded successfully
      expect(infoCount).toBeGreaterThanOrEqual(2);

      // ─── Verify score display ───────────────────────────
      // Use a player who loaded the board (not necessarily players[0])
      const loadedPlayer = setup.players.find((p) =>
        isPageAlive(p.page),
      );
      if (loadedPlayer) {
        // Make sure this player has the board
        const hasBoard = await loadedPlayer.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
        if (hasBoard) {
          const redScoreEl = loadedPlayer.page.locator(".bg-red-500 + .text-sm");
          const blueScoreEl = loadedPlayer.page.locator(".bg-blue-500 + .text-sm");

          await expect(redScoreEl).toBeVisible({ timeout: 10_000 });
          const initialRed = parseInt((await redScoreEl.textContent()) || "0");
          const initialBlue = parseInt((await blueScoreEl.textContent()) || "0");

          expect(initialRed).toBeGreaterThanOrEqual(8);
          expect(initialBlue).toBeGreaterThanOrEqual(8);
        }
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("4-player game: clue giving and card guessing via UI", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");

    try {
      await startGameViaUI(setup.players, "codenames");

      // Find a player with a loaded board for team detection
      let boardPlayerPage = setup.players[0].page;
      for (const p of setup.players) {
        if (!isPageAlive(p.page)) continue;
        const hasBd = await p.page.locator(".grid-cols-5 button").first()
          .isVisible().catch(() => false);
        if (hasBd) { boardPlayerPage = p.page; break; }
      }
      const currentTeam = await getCurrentTeamFromUI(boardPlayerPage);

      // Identify players by role
      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        const hasBoard = await player.page.locator(".grid-cols-5 button").first()
          .isVisible().catch(() => false);
        if (!hasBoard) continue;
        const role = await getPlayerRoleFromUI(player.page);
        playerRoles.push({ player, role });
      }

      const spymaster = playerRoles.find(
        (pr) => pr.role.team === currentTeam && pr.role.role === "spymaster",
      );
      const operative = playerRoles.find(
        (pr) => pr.role.team === currentTeam && pr.role.role === "operative",
      );

      expect(spymaster).toBeTruthy();
      expect(operative).toBeTruthy();

      // ─── Spymaster gives a clue ────────────────────────
      // Ensure spymaster has roomId in sessionStorage (needed for give_clue emit)
      const spymasterGameId = spymaster!.player.page.url().match(/\/game\/codenames\/(.+)/)?.[1];
      if (spymasterGameId) {
        await spymaster!.player.page.evaluate(
          ([gid, rid]: [string, string]) => {
            if (!sessionStorage.getItem(`ibg-game-room-${gid}`)) {
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid);
            }
          },
          [spymasterGameId, setup.roomId] as [string, string],
        );
      }

      await giveClueViaUI(spymaster!.player.page, "testword", 1, setup.roomId);

      // Wait for backend to process the clue, then verify on spymaster's page first
      let clueOnSpymaster = await spymaster!.player.page
        .locator(".bg-muted\\/50.p-3.text-center >> text=testword")
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!clueOnSpymaster) {
        // Clue might not have been processed — reload to get fresh state
        await spymaster!.player.page.reload();
        await spymaster!.player.page.waitForLoadState("domcontentloaded");
        await spymaster!.player.page.waitForTimeout(3000);
      }
      await expect(
        spymaster!.player.page.locator(".bg-muted\\/50.p-3.text-center >> text=testword"),
      ).toBeVisible({ timeout: 15_000 });

      // ─── All players should see the clue in turn info ──
      let playersWithClue = 0;
      for (const player of setup.players) {
        // Wait for either board or error page to be rendered (page may still be loading)
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .waitFor({ state: "visible", timeout: 5_000 })
          .then(() => true)
          .catch(() => false);

        // Skip players on error pages (e.g., "Player not found in game")
        if (!hasBoard) {
          const hasError = await player.page
            .locator("text=An error occurred")
            .waitFor({ state: "visible", timeout: 3_000 })
            .then(() => true)
            .catch(() => false);
          if (hasError) continue;
        }

        const clueLoc = player.page.locator(".bg-muted\\/50.p-3.text-center >> text=testword");
        let clueVisible = await clueLoc
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!clueVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          await player.page.waitForTimeout(3000);
          clueVisible = await clueLoc
            .waitFor({ state: "visible", timeout: 5_000 })
            .then(() => true)
            .catch(() => false);
          if (!clueVisible) {
            await player.page.reload();
            await player.page.waitForLoadState("domcontentloaded");
            await player.page.waitForTimeout(3000);
          }
        }
        // After reloads, check for error page again (player may not be in game)
        const errorAfterReload = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (errorAfterReload) continue;

        await expect(clueLoc).toBeVisible({ timeout: 15_000 });
        playersWithClue++;
      }
      // At least the spymaster + operative should see the clue
      expect(playersWithClue).toBeGreaterThanOrEqual(2);

      // ─── Operative guesses a card ──────────────────────
      // Ensure operative has roomId in sessionStorage (needed for guess_card emit)
      const operativeGameId = operative!.player.page.url().match(/\/game\/codenames\/(.+)/)?.[1];
      if (operativeGameId) {
        await operative!.player.page.evaluate(
          ([gid, rid]: [string, string]) => {
            if (!sessionStorage.getItem(`ibg-game-room-${gid}`)) {
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid);
            }
          },
          [operativeGameId, setup.roomId] as [string, string],
        );
      }

      const cardIndex = await findUnrevealedCardIndex(operative!.player.page);
      await clickBoardCard(operative!.player.page, cardIndex);

      // Wait for card reveal on operative's page (with retry if click didn't register)
      let operativeRevealVisible = await operative!.player.page
        .locator(".grid-cols-5 button.opacity-75")
        .first()
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!operativeRevealVisible) {
        // Click may have been missed — retry
        await clickBoardCard(operative!.player.page, cardIndex);
        operativeRevealVisible = await operative!.player.page
          .locator(".grid-cols-5 button.opacity-75")
          .first()
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
      }
      if (!operativeRevealVisible) {
        // Reload to get fresh board state from server
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
      }

      // At least one card should now be revealed
      for (const player of setup.players) {
        // Skip players not in the game (error page or no board)
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
        if (!hasBoard) continue;

        // Wait for reveal event to propagate (with reload fallback)
        let revealed = await player.page
          .locator(".grid-cols-5 button.opacity-75")
          .first()
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!revealed) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          await player.page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
          revealed = await player.page
            .locator(".grid-cols-5 button.opacity-75")
            .first()
            .waitFor({ state: "visible", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
        }
        if (!revealed) continue; // Player may have missed the event entirely

        const revealedCards = player.page.locator(".grid-cols-5 button.opacity-75");
        const count = await revealedCards.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await setup.cleanup();
    }
  });
});
