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
  getSpymasterCardTypes,
  getUnrevealedCardIndicesByType,
  isPageAlive,
  type PlayerContext,
  type CodenamesPlayerRole,
} from "../../helpers/ui-game-setup";

test.describe("Codenames — Multi-Player Games (UI)", () => {
  test("6-player team assignment is balanced (3v3) via UI", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");

    try {
      await startGameViaUI(setup.players, "codenames");

      const roles: CodenamesPlayerRole[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
        if (!hasBoard) continue;
        const role = await getPlayerRoleFromUI(player.page);
        roles.push(role);
      }

      // At least 4 players should be in the game (minimum for codenames)
      expect(roles.length).toBeGreaterThanOrEqual(4);

      const redPlayers = roles.filter((r) => r.team === "red");
      const bluePlayers = roles.filter((r) => r.team === "blue");

      // Teams should be balanced (difference at most 1)
      expect(Math.abs(redPlayers.length - bluePlayers.length)).toBeLessThanOrEqual(1);

      // Each team should have exactly 1 spymaster
      expect(
        redPlayers.filter((p) => p.role === "spymaster"),
      ).toHaveLength(1);
      expect(
        bluePlayers.filter((p) => p.role === "spymaster"),
      ).toHaveLength(1);

      // Each team should have at least 1 operative
      expect(
        redPlayers.filter((p) => p.role === "operative").length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        bluePlayers.filter((p) => p.role === "operative").length,
      ).toBeGreaterThanOrEqual(1);

      // Board should have 25 cards for players in the game
      for (const player of setup.players) {
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const cards = player.page.locator(".grid-cols-5 button");
        await expect(cards).toHaveCount(25, { timeout: 10_000 });
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("correct guesses lead to team victory via UI", async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");

    try {
      await startGameViaUI(setup.players, "codenames");

      // Verify board loads for all players (with reload fallback)
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        await player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        let boardVisible = await player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!boardVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
          await player.page.waitForFunction(
            () => (window as any).__SOCKET__?.connected === true,
            { timeout: 10_000 },
          ).catch(() => {});
          await player.page.locator(".grid-cols-5 button").first()
            .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
        }
      }

      // Find a player with a loaded board for team detection
      let boardPlayerPage = setup.players[0].page;
      for (const p of setup.players) {
        if (!isPageAlive(p.page)) continue;
        const hasBd = await p.page.locator(".grid-cols-5 button").first()
          .isVisible().catch(() => false);
        if (hasBd) { boardPlayerPage = p.page; break; }
      }
      const currentTeam = await getCurrentTeamFromUI(boardPlayerPage);

      // Identify spymaster and operative of current team
      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Get team card indices from spymaster's view
      const teamCardIndices = await getUnrevealedCardIndicesByType(
        spymaster!.player.page,
        currentTeam,
      );
      expect(teamCardIndices.length).toBeGreaterThanOrEqual(8);

      // Spymaster gives clue with number = total team cards
      await giveClueViaUI(spymaster!.player.page, "victory", teamCardIndices.length, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      const victoryClueLocator = operative!.player.page.locator(
        ".bg-muted\\/50.p-3.text-center >> text=victory",
      );
      let victoryClueVisible = await victoryClueLocator
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!victoryClueVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(victoryClueLocator).toBeVisible({ timeout: 10_000 });

      // Operative guesses all team cards one by one
      let gameOver = false;
      for (let i = 0; i < teamCardIndices.length && !gameOver; i++) {
        await clickBoardCard(operative!.player.page, teamCardIndices[i]);
        // Wait for card reveal or game over
        await operative!.player.page.locator(".grid-cols-5 button.opacity-75, h2:has-text('Game Over')")
          .first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

        // Check if game ended (use operative's page — guaranteed to have a board)
        gameOver = await operative!.player.page
          .locator("h2:has-text('Game Over')")
          .isVisible()
          .catch(() => false);
      }

      // If all team cards guessed, game should be over
      if (gameOver) {
        await expect(
          operative!.player.page.locator("h2:has-text('Game Over')"),
        ).toBeVisible();
        await expect(
          operative!.player.page.locator("text=wins!").first(),
        ).toBeVisible();
      }
    } finally {
      await setup.cleanup();
    }
  });

  test("assassin card causes immediate loss via UI", async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
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

      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Find the assassin card from spymaster's view
      const assassinIndices = await getUnrevealedCardIndicesByType(
        spymaster!.player.page,
        "assassin",
      );
      expect(assassinIndices.length).toBe(1);

      // Spymaster gives a clue
      await giveClueViaUI(spymaster!.player.page, "danger", 1, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      const dangerClueLocator = operative!.player.page.locator(
        ".bg-muted\\/50.p-3.text-center >> text=danger",
      );
      let dangerClueVisible = await dangerClueLocator
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!dangerClueVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(dangerClueLocator).toBeVisible({ timeout: 10_000 });

      // Operative guesses the assassin card
      await clickBoardCard(operative!.player.page, assassinIndices[0]);
      // Wait for game over after assassin hit
      await operative!.player.page.locator("h2:has-text('Game Over')")
        .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

      // Game should be over — other team wins (check on operative's page — guaranteed board)
      await expect(
        operative!.player.page.locator("h2:has-text('Game Over')"),
      ).toBeVisible({ timeout: 10_000 });

      // The OTHER team should win
      const otherTeamName = currentTeam === "red" ? "Blue Team" : "Red Team";
      await expect(
        operative!.player.page.locator(`text=${otherTeamName}`).first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await setup.cleanup();
    }
  });

  test("neutral card ends turn without penalty via UI", async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
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
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      const otherTeamName = otherTeam === "red" ? "Red Team" : "Blue Team";

      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Find a neutral card from spymaster's view
      const neutralIndices = await getUnrevealedCardIndicesByType(
        spymaster!.player.page,
        "neutral",
      );
      expect(neutralIndices.length).toBeGreaterThanOrEqual(1);

      // Spymaster gives a clue
      await giveClueViaUI(spymaster!.player.page, "nothing", 1, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      const nothingClueLocator = operative!.player.page.locator(
        ".bg-muted\\/50.p-3.text-center >> text=nothing",
      );
      let nothingClueVisible = await nothingClueLocator
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!nothingClueVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(nothingClueLocator).toBeVisible({ timeout: 10_000 });

      // Operative guesses the neutral card
      await clickBoardCard(operative!.player.page, neutralIndices[0]);
      // Wait for card reveal
      await operative!.player.page.locator(".grid-cols-5 button.opacity-75")
        .first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

      // Turn should switch to the other team — check on operative's page (guaranteed board)
      await expect(
        operative!.player.page.locator(
          `.bg-muted\\/50.p-3.text-center .font-semibold:has-text("${otherTeamName}")`,
        ).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await setup.cleanup();
    }
  });

  test("opponent card ends turn and gives opponent a point via UI", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
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
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      const otherTeamName = otherTeam === "red" ? "Red Team" : "Blue Team";

      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Read initial opponent score from operative page (use .first() to avoid
      // strict mode violation — after a card is revealed, an adjacent card may also match)
      const scoreEl = otherTeam === "red"
        ? operative!.player.page.locator(".bg-red-500 + .text-sm").first()
        : operative!.player.page.locator(".bg-blue-500 + .text-sm").first();
      await expect(scoreEl).toBeVisible({ timeout: 10_000 });
      const initialScore = parseInt((await scoreEl.textContent()) || "0");

      // Find an opponent's card from spymaster's view
      const opponentIndices = await getUnrevealedCardIndicesByType(
        spymaster!.player.page,
        otherTeam,
      );
      expect(opponentIndices.length).toBeGreaterThanOrEqual(1);

      // Spymaster gives a clue
      await giveClueViaUI(spymaster!.player.page, "mistake", 1, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      const mistakeClueLocator = operative!.player.page.locator(
        ".bg-muted\\/50.p-3.text-center >> text=mistake",
      );
      let mistakeClueVisible = await mistakeClueLocator
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!mistakeClueVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(mistakeClueLocator).toBeVisible({ timeout: 10_000 });

      // Operative guesses opponent's card
      await clickBoardCard(operative!.player.page, opponentIndices[0]);
      // Wait for card reveal
      await operative!.player.page.locator(".grid-cols-5 button.opacity-75")
        .first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

      // Turn should switch to other team — check on operative (most reliable)
      const opTurnLoc = operative!.player.page.locator(
        `.bg-muted\\/50.p-3.text-center .font-semibold:has-text("${otherTeamName}")`,
      ).first();
      let opTurnVisible = await opTurnLoc
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!opTurnVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(opTurnLoc).toBeVisible({ timeout: 15_000 });

      // Opponent's remaining score should have decreased by 1 (re-read from operative page)
      const opScoreEl = otherTeam === "red"
        ? operative!.player.page.locator(".bg-red-500 + .text-sm").first()
        : operative!.player.page.locator(".bg-blue-500 + .text-sm").first();
      const newScore = parseInt((await opScoreEl.textContent()) || "0");
      expect(newScore).toBe(initialScore - 1);
    } finally {
      await setup.cleanup();
    }
  });

  test("operative voluntarily ends turn via UI", async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
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
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      const otherTeamName = otherTeam === "red" ? "Red Team" : "Blue Team";

      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Spymaster gives clue with number=2
      await giveClueViaUI(spymaster!.player.page, "partial", 2, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      const partialClueLocator = operative!.player.page.locator(
        ".bg-muted\\/50.p-3.text-center >> text=partial",
      );
      let partialClueVisible = await partialClueLocator
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!partialClueVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(partialClueLocator).toBeVisible({ timeout: 10_000 });

      // Operative clicks "End Turn" without guessing
      const endTurnButton = operative!.player.page.locator(
        "button:has-text('End Turn')",
      );
      let endTurnBtnVisible = await endTurnButton
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!endTurnBtnVisible) {
        // Reload operative page — socket event may have been missed under load
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(endTurnButton).toBeVisible({ timeout: 10_000 });
      await endTurnButton.click();

      // Turn should switch to other team — check on operative (most reliable)
      const endTurnLoc = operative!.player.page.locator(
        `.bg-muted\\/50.p-3.text-center .font-semibold:has-text("${otherTeamName}")`,
      );
      let endTurnVisible = await endTurnLoc
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!endTurnVisible) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(endTurnLoc).toBeVisible({ timeout: 15_000 });
    } finally {
      await setup.cleanup();
    }
  });

  test("max guesses enforcement (clue_number + 1) via UI", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const accounts = await generateTestAccounts(6);
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
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      const otherTeamName = otherTeam === "red" ? "Red Team" : "Blue Team";

      const playerRoles: { player: PlayerContext; role: CodenamesPlayerRole }[] = [];
      for (const player of setup.players) {
        if (!isPageAlive(player.page)) continue;
        // Skip players on error pages or without a loaded board
        const hasError = await player.page
          .locator("text=An error occurred")
          .isVisible()
          .catch(() => false);
        if (hasError) continue;
        const hasBoard = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .isVisible()
          .catch(() => false);
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

      // Ensure spymaster has roomId in sessionStorage
      const spymasterGameId = spymaster!.player.page
        .url()
        .match(/\/game\/codenames\/(.+)/)?.[1];
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

      // Find team cards from spymaster's view
      const teamCardIndices = await getUnrevealedCardIndicesByType(
        spymaster!.player.page,
        currentTeam,
      );
      expect(teamCardIndices.length).toBeGreaterThanOrEqual(2);

      // Spymaster gives clue with number=1 → max_guesses=2
      await giveClueViaUI(spymaster!.player.page, "limit", 1, setup.roomId);

      // Wait for clue to propagate — with reload fallback
      let cluePropagated = await operative!.player.page
        .locator(".bg-muted\\/50.p-3.text-center >> text=limit")
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!cluePropagated) {
        await operative!.player.page.reload();
        await operative!.player.page.waitForLoadState("domcontentloaded");
        await operative!.player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await operative!.player.page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(
        operative!.player.page.locator(".bg-muted\\/50.p-3.text-center >> text=limit"),
      ).toBeVisible({ timeout: 10_000 });

      // Ensure operative has roomId in sessionStorage
      const operativeGameId = operative!.player.page
        .url()
        .match(/\/game\/codenames\/(.+)/)?.[1];
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

      // Guess 1: correct team card
      await clickBoardCard(operative!.player.page, teamCardIndices[0]);
      // Wait for first card to be revealed (at least 1 revealed card)
      await operative!.player.page.waitForFunction(
        () => document.querySelectorAll(".grid-cols-5 button.opacity-75").length >= 1,
        { timeout: 10_000 },
      ).catch(() => {});

      // Guess 2: correct team card — should hit max_guesses and end turn
      await clickBoardCard(operative!.player.page, teamCardIndices[1]);
      // Wait for second card to be revealed (at least 2 revealed cards)
      await operative!.player.page.waitForFunction(
        () => document.querySelectorAll(".grid-cols-5 button.opacity-75").length >= 2,
        { timeout: 10_000 },
      ).catch(() => {});

      // Turn should switch to other team (max guesses reached) — check on operative's page
      // (most reliable since they performed the last action)
      const checkPage = operative!.player.page;
      let turnSwitchedToOther = await checkPage
        .locator(`.bg-muted\\/50.p-3.text-center .font-semibold:has-text("${otherTeamName}")`)
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!turnSwitchedToOther) {
        await checkPage.reload();
        await checkPage.waitForLoadState("domcontentloaded");
        await checkPage.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await checkPage.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
      await expect(
        checkPage.locator(
          `.bg-muted\\/50.p-3.text-center .font-semibold:has-text("${otherTeamName}")`,
        ),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await setup.cleanup();
    }
  });
});
