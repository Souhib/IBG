import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaAPI,
  isPageAlive,
  getCodenamesRoles,
  findSpymaster,
  findOperative,
  type PlayerContext,
} from "../../helpers/ui-game-setup";
import {
  apiGetCodenamesBoard,
  apiGiveClue,
  apiGuessCard,
  apiEndTurn,
} from "../../helpers/api-client";

test.describe("Codenames Game Gameplay", () => {
  test("spymaster gives clue and operatives see it", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page.url().match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Get board state to find the current team
    const board = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    const currentTeam = board.current_team;

    // Find spymaster for current team
    const spymaster = await findSpymaster(setup.players, gameId!, currentTeam);

    // Give clue via API
    await apiGiveClue(gameId!, "testclue", 1, spymaster.login.access_token);

    // Wait a moment for polling to pick up the clue
    await setup.players[0].page.waitForTimeout(3000);

    // Verify operatives can see the clue on their page
    const operative = await findOperative(setup.players, gameId!, currentTeam);
    if (isPageAlive(operative.page)) {
      await expect(
        operative.page.locator("text=testclue")
          .or(operative.page.locator("text=TESTCLUE")),
      ).toBeVisible({ timeout: 15_000 });
    }

    await setup.cleanup();
  });

  test("operative guesses correct card and it reveals", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page.url().match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Get board and find a card of the current team's color
    const board = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    const currentTeam = board.current_team;

    // Spymaster gives clue
    const spymaster = await findSpymaster(setup.players, gameId!, currentTeam);
    await apiGiveClue(gameId!, "hint", 1, spymaster.login.access_token);

    // Operative guesses a card (find a card of team color from spymaster's view)
    const spymasterBoard = await apiGetCodenamesBoard(gameId!, spymaster.login.access_token);
    const teamCardIndex = spymasterBoard.board.findIndex(
      (c) => c.card_type === currentTeam && !c.revealed,
    );
    expect(teamCardIndex).toBeGreaterThanOrEqual(0);

    const operative = await findOperative(setup.players, gameId!, currentTeam);
    await apiGuessCard(gameId!, teamCardIndex, operative.login.access_token);

    // Verify the card is now revealed
    const updatedBoard = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    expect(updatedBoard.board[teamCardIndex].revealed).toBe(true);

    // Remaining count should have decreased
    if (currentTeam === "red") {
      expect(updatedBoard.red_remaining).toBe(board.red_remaining - 1);
    } else {
      expect(updatedBoard.blue_remaining).toBe(board.blue_remaining - 1);
    }

    await setup.cleanup();
  });

  test("guessing assassin card ends game with opponent winning", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page.url().match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    const board = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    const currentTeam = board.current_team;
    const opponentTeam = currentTeam === "red" ? "blue" : "red";

    // Give clue
    const spymaster = await findSpymaster(setup.players, gameId!, currentTeam);
    await apiGiveClue(gameId!, "danger", 1, spymaster.login.access_token);

    // Find assassin card from spymaster's view
    const spymasterBoard = await apiGetCodenamesBoard(gameId!, spymaster.login.access_token);
    const assassinIndex = spymasterBoard.board.findIndex((c) => c.card_type === "assassin");
    expect(assassinIndex).toBeGreaterThanOrEqual(0);

    // Operative guesses the assassin
    const operative = await findOperative(setup.players, gameId!, currentTeam);
    await apiGuessCard(gameId!, assassinIndex, operative.login.access_token);

    // Game should be over with opponent winning
    const finalBoard = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    expect(finalBoard.status).toBe("finished");
    expect(finalBoard.winner).toBe(opponentTeam);

    // Wait for UI to update via polling
    await setup.players[0].page.waitForTimeout(3000);

    // At least one player should see "Game Over"
    const anyPage = setup.players.find((p) => isPageAlive(p.page))?.page;
    if (anyPage) {
      await expect(
        anyPage.locator('h2:has-text("Game Over")')
          .or(anyPage.locator('text=Game Over')),
      ).toBeVisible({ timeout: 15_000 });
    }

    await setup.cleanup();
  });

  test("end turn switches team", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page.url().match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    const board = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    const initialTeam = board.current_team;
    const otherTeam = initialTeam === "red" ? "blue" : "red";

    // Spymaster gives clue
    const spymaster = await findSpymaster(setup.players, gameId!, initialTeam);
    await apiGiveClue(gameId!, "pass", 1, spymaster.login.access_token);

    // Operative ends turn
    const operative = await findOperative(setup.players, gameId!, initialTeam);
    await apiEndTurn(gameId!, operative.login.access_token);

    // Team should have switched
    const updatedBoard = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    expect(updatedBoard.current_team).toBe(otherTeam);

    await setup.cleanup();
  });

  test("full game played to completion via API", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page.url().match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Play the game: each turn, the spymaster gives a clue, operative guesses their team's cards
    for (let turn = 0; turn < 30; turn++) {
      const board = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
      if (board.status === "finished") break;

      const currentTeam = board.current_team;

      // Find spymaster for current team
      let spymaster: PlayerContext;
      try {
        spymaster = await findSpymaster(setup.players, gameId!, currentTeam);
      } catch {
        break; // Team might be empty
      }

      // Give clue
      await apiGiveClue(gameId!, `clue${turn}`, 1, spymaster.login.access_token);

      // Get spymaster's board to find team cards
      const smBoard = await apiGetCodenamesBoard(gameId!, spymaster.login.access_token);
      if (smBoard.status === "finished") break;

      const teamCard = smBoard.board.findIndex(
        (c) => c.card_type === currentTeam && !c.revealed,
      );

      let operative: PlayerContext;
      try {
        operative = await findOperative(setup.players, gameId!, currentTeam);
      } catch {
        break;
      }

      if (teamCard >= 0) {
        await apiGuessCard(gameId!, teamCard, operative.login.access_token);
      }

      // Check if game ended after guess
      const afterGuess = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
      if (afterGuess.status === "finished") break;

      // End turn
      await apiEndTurn(gameId!, operative.login.access_token).catch(() => {});
    }

    // Verify game finished
    const finalBoard = await apiGetCodenamesBoard(gameId!, setup.players[0].login.access_token);
    expect(finalBoard.status).toBe("finished");
    expect(finalBoard.winner).toBeTruthy();

    // Verify UI shows game over
    await setup.players[0].page.waitForTimeout(3000);
    const anyPage = setup.players.find((p) => isPageAlive(p.page))?.page;
    if (anyPage) {
      await expect(
        anyPage.locator('h2:has-text("Game Over")')
          .or(anyPage.locator('text=Game Over')),
      ).toBeVisible({ timeout: 15_000 });
    }

    await setup.cleanup();
  });
});
