import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaAPI,
  isPageAlive,
  findAllOperatives,
  type PlayerContext,
} from "../../helpers/ui-game-setup";
import {
  apiGetCodenamesBoard,
  apiGiveClue,
  apiGuessCard,
  apiEndTurn,
} from "../../helpers/api-client";

/**
 * Find spymaster/operative from a board response without extra API calls.
 */
function findPlayerByRole(
  board: Awaited<ReturnType<typeof apiGetCodenamesBoard>>,
  players: PlayerContext[],
  team: "red" | "blue",
  role: "spymaster" | "operative",
): PlayerContext {
  const bp = board.players.find((p) => p.team === team && p.role === role);
  if (!bp) throw new Error(`No ${role} found for team ${team}`);
  const pc = players.find((p) => p.login.user.id === bp.user_id);
  if (!pc) throw new Error(`No PlayerContext for ${role} ${bp.user_id}`);
  return pc;
}

function findAllPlayersByRole(
  board: Awaited<ReturnType<typeof apiGetCodenamesBoard>>,
  players: PlayerContext[],
  team: "red" | "blue",
  role: "spymaster" | "operative",
): PlayerContext[] {
  return board.players
    .filter((p) => p.team === team && p.role === role)
    .map((bp) => {
      const pc = players.find((p) => p.login.user.id === bp.user_id);
      if (!pc) throw new Error(`No PlayerContext for ${role} ${bp.user_id}`);
      return pc;
    });
}

test.describe("Codenames Voting (6-player)", () => {
  test("first vote shows progress, not reveal", async ({ browser }) => {
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page
      .url()
      .match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Get board state and find current team roles
    const board = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    const currentTeam = board.current_team;
    const spymaster = findPlayerByRole(
      board,
      setup.players,
      currentTeam,
      "spymaster",
    );
    const operatives = findAllPlayersByRole(
      board,
      setup.players,
      currentTeam,
      "operative",
    );
    expect(operatives.length).toBeGreaterThanOrEqual(2);

    // Spymaster gives clue
    await apiGiveClue(gameId!, "testvote", 1, spymaster.login.access_token);

    // Get spymaster board to find a team card
    const spymasterBoard = await apiGetCodenamesBoard(
      gameId!,
      spymaster.login.access_token,
    );
    const teamCardIndex = spymasterBoard.board.findIndex(
      (c) => c.card_type === currentTeam && !c.revealed,
    );
    expect(teamCardIndex).toBeGreaterThanOrEqual(0);

    // First operative votes via API
    const voteResult = (await apiGuessCard(
      gameId!,
      teamCardIndex,
      operatives[0].login.access_token,
    )) as Record<string, unknown>;

    // Verify response indicates not all voted yet
    expect(voteResult["all_voted"]).toBe(false);

    // Verify the card is NOT revealed yet (partial vote)
    const boardAfterVote = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    expect(boardAfterVote.board[teamCardIndex].revealed).toBe(false);

    await setup.cleanup();
  });

  test("both operatives vote, card reveals", async ({ browser }) => {
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page
      .url()
      .match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    const board = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    const currentTeam = board.current_team;
    const spymaster = findPlayerByRole(
      board,
      setup.players,
      currentTeam,
      "spymaster",
    );
    const operatives = findAllPlayersByRole(
      board,
      setup.players,
      currentTeam,
      "operative",
    );
    expect(operatives.length).toBeGreaterThanOrEqual(2);

    // Give clue
    await apiGiveClue(gameId!, "teamwork", 1, spymaster.login.access_token);

    // Find a team card
    const spymasterBoard = await apiGetCodenamesBoard(
      gameId!,
      spymaster.login.access_token,
    );
    const teamCardIndex = spymasterBoard.board.findIndex(
      (c) => c.card_type === currentTeam && !c.revealed,
    );
    expect(teamCardIndex).toBeGreaterThanOrEqual(0);

    // First operative votes
    await apiGuessCard(
      gameId!,
      teamCardIndex,
      operatives[0].login.access_token,
    );

    // Second operative votes same card
    const secondVoteResult = (await apiGuessCard(
      gameId!,
      teamCardIndex,
      operatives[1].login.access_token,
    )) as Record<string, unknown>;

    // Verify all voted
    expect(secondVoteResult["all_voted"]).toBe(true);

    // Verify card is now revealed
    const updatedBoard = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    expect(updatedBoard.board[teamCardIndex].revealed).toBe(true);

    await setup.cleanup();
  });

  test("vote badges visible on board after partial vote", async ({
    browser,
  }) => {
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page
      .url()
      .match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    const board = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    const currentTeam = board.current_team;
    const spymaster = findPlayerByRole(
      board,
      setup.players,
      currentTeam,
      "spymaster",
    );
    const operatives = findAllPlayersByRole(
      board,
      setup.players,
      currentTeam,
      "operative",
    );
    expect(operatives.length).toBeGreaterThanOrEqual(2);

    // Give clue
    await apiGiveClue(gameId!, "badge", 1, spymaster.login.access_token);

    // Find a team card
    const spymasterBoard = await apiGetCodenamesBoard(
      gameId!,
      spymaster.login.access_token,
    );
    const teamCardIndex = spymasterBoard.board.findIndex(
      (c) => c.card_type === currentTeam && !c.revealed,
    );
    expect(teamCardIndex).toBeGreaterThanOrEqual(0);

    // First operative votes via API
    await apiGuessCard(
      gameId!,
      teamCardIndex,
      operatives[0].login.access_token,
    );

    // Wait for polling to update the UI
    await setup.players[0].page.waitForTimeout(3000);

    // On an operative's page, check for vote badge visibility
    // The badge is a span inside a button in .grid-cols-5
    const operativePage = operatives[0].page;
    if (isPageAlive(operativePage)) {
      const cardButtons = operativePage.locator(".grid-cols-5 button");
      const targetCard = cardButtons.nth(teamCardIndex);
      const badge = targetCard.locator("span");
      await expect(badge.first()).toBeVisible({ timeout: 10_000 });
    }

    await setup.cleanup();
  });

  test("full game to completion with voting", async ({ browser }) => {
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page
      .url()
      .match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Play turns until game ends
    for (let turn = 0; turn < 30; turn++) {
      const board = await apiGetCodenamesBoard(
        gameId!,
        setup.players[0].login.access_token,
      );
      if (board.status === "finished") break;

      const currentTeam = board.current_team;

      let spymaster: PlayerContext;
      let operatives: PlayerContext[];
      try {
        spymaster = findPlayerByRole(
          board,
          setup.players,
          currentTeam,
          "spymaster",
        );
        operatives = findAllPlayersByRole(
          board,
          setup.players,
          currentTeam,
          "operative",
        );
      } catch {
        break;
      }

      // Give clue
      await apiGiveClue(
        gameId!,
        `clue${turn}`,
        1,
        spymaster.login.access_token,
      );

      // Get spymaster board to find team cards
      const smBoard = await apiGetCodenamesBoard(
        gameId!,
        spymaster.login.access_token,
      );
      if (smBoard.status === "finished") break;

      const teamCard = smBoard.board.findIndex(
        (c) => c.card_type === currentTeam && !c.revealed,
      );

      if (teamCard >= 0) {
        // All operatives vote for the same team card
        for (const op of operatives) {
          await apiGuessCard(gameId!, teamCard, op.login.access_token);
        }
      }

      // Check if game ended after guess
      const afterGuess = await apiGetCodenamesBoard(
        gameId!,
        setup.players[0].login.access_token,
      );
      if (afterGuess.status === "finished") break;

      // End turn
      await apiEndTurn(gameId!, operatives[0].login.access_token).catch(
        () => {},
      );
    }

    // Verify game finished
    const finalBoard = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    expect(finalBoard.status).toBe("finished");
    expect(finalBoard.winner).toBeTruthy();

    // Verify UI shows game over
    await setup.players[0].page.waitForTimeout(3000);
    const anyPage = setup.players.find((p) => isPageAlive(p.page))?.page;
    if (anyPage) {
      await expect(
        anyPage
          .locator('h2:has-text("Game Over")')
          .or(anyPage.locator("text=Game Over")),
      ).toBeVisible({ timeout: 15_000 });
    }

    await setup.cleanup();
  });

  test("assassin via vote ends game", async ({ browser }) => {
    const accounts = await generateTestAccounts(6);
    const setup = await setupRoomWithPlayers(browser, accounts, "codenames");
    await startGameViaAPI(setup.players, "codenames", setup.roomId);

    const gameId = setup.players[0].page
      .url()
      .match(/\/game\/codenames\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    const board = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    const currentTeam = board.current_team;
    const opponentTeam = currentTeam === "red" ? "blue" : "red";
    const spymaster = findPlayerByRole(
      board,
      setup.players,
      currentTeam,
      "spymaster",
    );
    const operatives = findAllPlayersByRole(
      board,
      setup.players,
      currentTeam,
      "operative",
    );
    expect(operatives.length).toBeGreaterThanOrEqual(2);

    // Give clue
    await apiGiveClue(gameId!, "danger", 1, spymaster.login.access_token);

    // Find assassin card from spymaster board view
    const spymasterBoard = await apiGetCodenamesBoard(
      gameId!,
      spymaster.login.access_token,
    );
    const assassinIndex = spymasterBoard.board.findIndex(
      (c) => c.card_type === "assassin",
    );
    expect(assassinIndex).toBeGreaterThanOrEqual(0);

    // Both operatives vote for assassin
    for (const op of operatives) {
      await apiGuessCard(gameId!, assassinIndex, op.login.access_token);
    }

    // Verify game finished with opponent winning
    const finalBoard = await apiGetCodenamesBoard(
      gameId!,
      setup.players[0].login.access_token,
    );
    expect(finalBoard.status).toBe("finished");
    expect(finalBoard.winner).toBe(opponentTeam);

    // Verify UI shows game over
    await setup.players[0].page.waitForTimeout(3000);
    const anyPage = setup.players.find((p) => isPageAlive(p.page))?.page;
    if (anyPage) {
      await expect(
        anyPage
          .locator('h2:has-text("Game Over")')
          .or(anyPage.locator("text=Game Over")),
      ).toBeVisible({ timeout: 15_000 });
    }

    await setup.cleanup();
  });
});
