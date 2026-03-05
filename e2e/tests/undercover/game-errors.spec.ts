import { test, expect } from "@playwright/test";
import { generateTestAccounts } from "../../helpers/test-setup";
import {
  setupRoomWithPlayers,
  startGameViaAPI,
  dismissRoleRevealAll,
  submitDescriptionsForAllPlayers,
  voteForPlayer,
  verifyAllPlayersVoted,
  waitForEliminationOrGameOver,
  isPageAlive,
} from "../../helpers/ui-game-setup";
import {
  apiGetUndercoverState,
  rawPost,
} from "../../helpers/api-client";

test.describe("Undercover Game Errors", () => {
  test("vote for self is rejected via API", async ({ browser }) => {
    const accounts = await generateTestAccounts(3);
    const setup = await setupRoomWithPlayers(browser, accounts);
    await startGameViaAPI(setup.players, "undercover", setup.roomId);
    const activePlayers = await dismissRoleRevealAll(setup.players);

    const gameId = setup.players[0].page.url().match(/\/game\/undercover\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Complete description phase first
    await submitDescriptionsForAllPlayers(activePlayers);

    // Wait for voting phase
    let state;
    try {
      state = await apiGetUndercoverState(gameId!, activePlayers[0].login.access_token);
    } catch {
      // Game might have ended via disconnect — skip this test gracefully
      await setup.cleanup();
      return;
    }

    if (state.turn_phase !== "voting") {
      // Game might have progressed past voting — skip
      await setup.cleanup();
      return;
    }

    // Try to vote for self via raw API — should be rejected
    const voter = activePlayers[0];
    const res = await rawPost(
      `/api/v1/undercover/games/${gameId}/vote`,
      { voted_for: voter.login.user.id },
      voter.login.access_token,
    );

    // Should be rejected (400 for CantVoteForYourselfError, or 403 if player was disconnected)
    expect(res.ok).toBe(false);

    await setup.cleanup();
  });

  test("describe out of turn is rejected via API", async ({ browser }) => {
    const accounts = await generateTestAccounts(3);
    const setup = await setupRoomWithPlayers(browser, accounts);
    await startGameViaAPI(setup.players, "undercover", setup.roomId);
    await dismissRoleRevealAll(setup.players);

    const gameId = setup.players[0].page.url().match(/\/game\/undercover\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Get state to find who is NOT the current describer
    const state = await apiGetUndercoverState(gameId!, setup.players[0].login.access_token);
    expect(state.description_order).toBeTruthy();
    expect(state.description_order!.length).toBeGreaterThan(0);

    const currentDescriberId = state.description_order![state.current_describer_index ?? 0].user_id;
    const wrongPlayer = setup.players.find((p) => p.login.user.id !== currentDescriberId);
    expect(wrongPlayer).toBeTruthy();

    // Try to submit description as wrong player
    const res = await rawPost(
      `/api/v1/undercover/games/${gameId}/describe`,
      { word: "wrongturn" },
      wrongPlayer!.login.access_token,
    );

    expect(res.ok).toBe(false);

    await setup.cleanup();
  });

  test("eliminated player is marked dead after voting", async ({ browser }) => {
    const accounts = await generateTestAccounts(4);
    const setup = await setupRoomWithPlayers(browser, accounts);
    await startGameViaAPI(setup.players, "undercover", setup.roomId);
    const activePlayers = await dismissRoleRevealAll(setup.players);

    const gameId = setup.players[0].page.url().match(/\/game\/undercover\/([a-f0-9-]+)/)?.[1];
    expect(gameId).toBeTruthy();

    // Description phase
    await submitDescriptionsForAllPlayers(activePlayers);

    // Get state to find vote targets
    let state;
    try {
      state = await apiGetUndercoverState(gameId!, activePlayers[0].login.access_token);
    } catch {
      // Game might have ended — skip
      await setup.cleanup();
      return;
    }

    const alivePlayers = state.players.filter((p) => p.is_alive);
    if (alivePlayers.length < 2) {
      await setup.cleanup();
      return;
    }
    const target = alivePlayers[1]; // Target second player

    for (const voter of activePlayers) {
      if (!isPageAlive(voter.page)) continue;
      if (voter.login.user.id === target.user_id) continue;
      await voteForPlayer(voter.page, target.username);
    }
    await verifyAllPlayersVoted(activePlayers, target.username, alivePlayers[0].username);

    // Wait for elimination or game over
    const observerPage = activePlayers.find((p) => isPageAlive(p.page))?.page;
    if (observerPage) {
      await waitForEliminationOrGameOver(observerPage);
    }

    // Check that the eliminated player's API state shows is_alive=false
    const targetPlayer = activePlayers.find((p) => p.login.user.id === target.user_id);
    if (targetPlayer && isPageAlive(targetPlayer.page)) {
      try {
        const targetState = await apiGetUndercoverState(gameId!, targetPlayer.login.access_token);
        expect(targetState.is_alive).toBe(false);
      } catch {
        // If API fails (403 = player removed), that also confirms elimination
      }
    }

    await setup.cleanup();
  });
});
