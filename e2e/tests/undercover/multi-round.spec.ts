import { test, expect } from "@playwright/test";
import { waitForEvent } from "../../helpers/socket-client";
import { SOCKET_EVENTS } from "../../helpers/constants";
import {
  setupUndercoverGame,
  castVotes,
  startNewTurn,
  type UndercoverPlayer,
} from "../../helpers/game-setup";

test.describe("Undercover — Multi-Round Games (5-6 Players)", () => {
  test("5-player game: 3-round civilian victory", async () => {
    const { players, gameId, roomId, roomPublicId, mayor, cleanup } =
      await setupUndercoverGame(5);

    try {
      // Identify players by role
      const undercovers = players.filter((p) => p.role === "undercover");
      const mrWhites = players.filter((p) => p.role === "mr_white");
      const civilians = players.filter((p) => p.role === "civilian");
      const alivePlayers = [...players];

      expect(undercovers.length).toBe(2);
      expect(mrWhites.length).toBe(1);
      expect(civilians.length).toBe(2);

      // ─── Round 1: Eliminate first undercover ───────────────
      const target1 = undercovers[0];
      const voteMap1: Record<string, string> = {};
      for (const p of alivePlayers) {
        if (p.login.user.id !== target1.login.user.id) {
          voteMap1[p.login.user.id] = target1.login.user.id;
        } else {
          // Target can't vote for themselves — vote for a civilian
          const otherPlayer = alivePlayers.find(
            (o) =>
              o.login.user.id !== target1.login.user.id &&
              o.role === "civilian",
          )!;
          voteMap1[p.login.user.id] = otherPlayer.login.user.id;
        }
      }

      const round1 = await castVotes(
        alivePlayers,
        gameId,
        roomPublicId,
        voteMap1,
        players[0].socket,
      );

      expect(round1.eliminated).toBeTruthy();
      expect(round1.eliminated.eliminated_player_role).toBe("undercover");
      expect(round1.gameOver).toBeNull();

      // Remove eliminated from alive list
      const alive2 = alivePlayers.filter(
        (p) => p.login.user.id !== target1.login.user.id,
      );

      // ─── Start Round 2 ────────────────────────────────────
      await startNewTurn(players[0].socket, roomId, gameId);

      // ─── Round 2: Eliminate second undercover ──────────────
      const target2 = undercovers[1];
      const voteMap2: Record<string, string> = {};
      for (const p of alive2) {
        if (p.login.user.id !== target2.login.user.id) {
          voteMap2[p.login.user.id] = target2.login.user.id;
        } else {
          const otherPlayer = alive2.find(
            (o) =>
              o.login.user.id !== target2.login.user.id &&
              o.role === "civilian",
          )!;
          voteMap2[p.login.user.id] = otherPlayer.login.user.id;
        }
      }

      const round2 = await castVotes(
        alive2,
        gameId,
        roomPublicId,
        voteMap2,
        players[0].socket,
      );

      expect(round2.eliminated).toBeTruthy();
      expect(round2.eliminated.eliminated_player_role).toBe("undercover");
      expect(round2.gameOver).toBeNull();

      // Remove eliminated
      const alive3 = alive2.filter(
        (p) => p.login.user.id !== target2.login.user.id,
      );

      // ─── Start Round 3 ────────────────────────────────────
      await startNewTurn(players[0].socket, roomId, gameId);

      // ─── Round 3: Eliminate mr_white → civilian victory ────
      const target3 = mrWhites[0];
      const voteMap3: Record<string, string> = {};
      for (const p of alive3) {
        if (p.login.user.id !== target3.login.user.id) {
          voteMap3[p.login.user.id] = target3.login.user.id;
        } else {
          const otherPlayer = alive3.find(
            (o) => o.login.user.id !== target3.login.user.id,
          )!;
          voteMap3[p.login.user.id] = otherPlayer.login.user.id;
        }
      }

      const round3 = await castVotes(
        alive3,
        gameId,
        roomPublicId,
        voteMap3,
        players[0].socket,
      );

      expect(round3.eliminated).toBeTruthy();
      expect(round3.eliminated.eliminated_player_role).toBe("mr_white");
      expect(round3.gameOver).toBeTruthy();
      expect(round3.gameOver!.data).toContain("civilians");
    } finally {
      cleanup();
    }
  });

  test("6-player game: undercover wins when mr_white is eliminated first", async () => {
    const { players, gameId, roomPublicId, cleanup } =
      await setupUndercoverGame(6);

    try {
      const mrWhite = players.find((p) => p.role === "mr_white")!;
      expect(mrWhite).toBeTruthy();

      // All 6 vote for mr_white (mr_white votes for someone else)
      const voteMap: Record<string, string> = {};
      for (const p of players) {
        if (p.login.user.id !== mrWhite.login.user.id) {
          voteMap[p.login.user.id] = mrWhite.login.user.id;
        } else {
          // Mr. White can't self-vote, pick any other player
          const other = players.find(
            (o) => o.login.user.id !== mrWhite.login.user.id,
          )!;
          voteMap[p.login.user.id] = other.login.user.id;
        }
      }

      const result = await castVotes(
        players,
        gameId,
        roomPublicId,
        voteMap,
        players[0].socket,
      );

      expect(result.eliminated.eliminated_player_role).toBe("mr_white");
      expect(result.gameOver).toBeTruthy();
      expect(result.gameOver!.data).toContain("undercovers");
    } finally {
      cleanup();
    }
  });

  test("5-player game: dead player cannot vote", async () => {
    const { players, gameId, roomId, roomPublicId, cleanup } =
      await setupUndercoverGame(5);

    try {
      // ─── Round 1: Eliminate someone ────────────────────────
      const target = players[4]; // Pick last player
      const voteMap: Record<string, string> = {};
      for (const p of players) {
        if (p.login.user.id !== target.login.user.id) {
          voteMap[p.login.user.id] = target.login.user.id;
        } else {
          voteMap[p.login.user.id] = players[0].login.user.id;
        }
      }

      await castVotes(players, gameId, roomPublicId, voteMap, players[0].socket);

      // ─── Start Round 2 ────────────────────────────────────
      await startNewTurn(players[0].socket, roomId, gameId);
      await new Promise((r) => setTimeout(r, 1000));

      // ─── Dead player tries to vote → error ────────────────
      const errorPromise = waitForEvent<{ message: string }>(
        target.socket,
        SOCKET_EVENTS.ERROR,
        5000,
      );

      target.socket.emit("vote_for_a_player", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: target.login.user.id,
        voted_user_id: players[0].login.user.id,
      });

      const error = await errorPromise;
      expect(error.message).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  test("5-player game: cannot vote for eliminated player", async () => {
    const { players, gameId, roomId, roomPublicId, cleanup } =
      await setupUndercoverGame(5);

    try {
      // ─── Round 1: Eliminate someone ────────────────────────
      const target = players[4];
      const voteMap: Record<string, string> = {};
      for (const p of players) {
        if (p.login.user.id !== target.login.user.id) {
          voteMap[p.login.user.id] = target.login.user.id;
        } else {
          voteMap[p.login.user.id] = players[0].login.user.id;
        }
      }

      await castVotes(players, gameId, roomPublicId, voteMap, players[0].socket);

      // ─── Start Round 2 ────────────────────────────────────
      await startNewTurn(players[0].socket, roomId, gameId);
      await new Promise((r) => setTimeout(r, 1000));

      // ─── Alive player tries to vote for dead player → error ─
      const voter = players[0];
      const errorPromise = waitForEvent<{ message: string }>(
        voter.socket,
        SOCKET_EVENTS.ERROR,
        5000,
      );

      voter.socket.emit("vote_for_a_player", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: voter.login.user.id,
        voted_user_id: target.login.user.id, // Dead player
      });

      const error = await errorPromise;
      expect(error.message).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  test("5-player game: mayor tiebreak determines elimination", async () => {
    const { players, gameId, roomPublicId, mayor, cleanup } =
      await setupUndercoverGame(5);

    try {
      // Find the mayor player
      const mayorPlayer = players.find(
        (p) => p.login.user.username === mayor,
      )!;
      expect(mayorPlayer).toBeTruthy();

      // Pick two non-mayor targets for the tie
      const nonMayor = players.filter(
        (p) => p.login.user.id !== mayorPlayer.login.user.id,
      );
      const targetA = nonMayor[0]; // Mayor will vote for this one
      const targetB = nonMayor[1];

      // Create a 2-2-1 vote split:
      // Mayor → targetA, one other → targetA  (targetA: 2 votes including mayor)
      // Two others → targetB                   (targetB: 2 votes)
      // Remaining → whoever                    (1 vote)
      const remainingVoters = nonMayor.filter(
        (p) =>
          p.login.user.id !== targetA.login.user.id &&
          p.login.user.id !== targetB.login.user.id,
      );

      const voteMap: Record<string, string> = {};

      // Mayor votes for targetA
      voteMap[mayorPlayer.login.user.id] = targetA.login.user.id;

      // One remaining voter votes for targetA (to make it 2)
      if (remainingVoters.length > 0) {
        voteMap[remainingVoters[0].login.user.id] = targetA.login.user.id;
      }

      // targetA and targetB vote for targetB (to make it 2)
      // targetA can't vote for themselves, so they vote for targetB
      voteMap[targetA.login.user.id] = targetB.login.user.id;
      // targetB can't vote for themselves, so they vote for... we need targetB to get 2 votes
      // Let's adjust: we need exactly 2 votes for targetB
      // Current: targetA votes for targetB (1 vote for targetB)
      // We need one more voter for targetB
      if (remainingVoters.length > 1) {
        voteMap[remainingVoters[1].login.user.id] = targetB.login.user.id;
      }

      // targetB votes for someone not in the tie (1 stray vote)
      const strayTarget = players.find(
        (p) =>
          p.login.user.id !== targetA.login.user.id &&
          p.login.user.id !== targetB.login.user.id &&
          !voteMap[p.login.user.id] === undefined,
      );
      voteMap[targetB.login.user.id] =
        strayTarget?.login.user.id ?? mayorPlayer.login.user.id;

      // Verify we have exactly 5 votes
      expect(Object.keys(voteMap).length).toBe(5);

      // Count expected votes
      const voteCounts: Record<string, number> = {};
      for (const votedFor of Object.values(voteMap)) {
        voteCounts[votedFor] = (voteCounts[votedFor] || 0) + 1;
      }

      // targetA and targetB should both have 2 votes (tie)
      expect(voteCounts[targetA.login.user.id]).toBe(2);
      expect(voteCounts[targetB.login.user.id]).toBe(2);

      const result = await castVotes(
        players,
        gameId,
        roomPublicId,
        voteMap,
        players[0].socket,
      );

      // Mayor voted for targetA, so targetA should be eliminated (tiebreak)
      expect(result.eliminated).toBeTruthy();
      expect(result.eliminated.message).toContain(
        targetA.login.user.username,
      );
    } finally {
      cleanup();
    }
  });

  test("6-player role distribution is correct", async () => {
    const { players, cleanup } = await setupUndercoverGame(6);

    try {
      const roles = players.map((p) => p.role);

      // 6 players: 3 civilian, 2 undercover, 1 mr_white
      const civilians = roles.filter((r) => r === "civilian");
      const undercovers = roles.filter((r) => r === "undercover");
      const mrWhites = roles.filter((r) => r === "mr_white");

      expect(civilians).toHaveLength(3);
      expect(undercovers).toHaveLength(2);
      expect(mrWhites).toHaveLength(1);

      // Civilians share one word
      const civilianWords = players
        .filter((p) => p.role === "civilian")
        .map((p) => p.word);
      expect(new Set(civilianWords).size).toBe(1);

      // Undercovers share a different word
      const undercoverWords = players
        .filter((p) => p.role === "undercover")
        .map((p) => p.word);
      expect(new Set(undercoverWords).size).toBe(1);

      // Civilian and undercover words are different
      expect(civilianWords[0]).not.toBe(undercoverWords[0]);

      // Mr. White gets a special message (not a game word)
      const mrWhitePlayer = players.find((p) => p.role === "mr_white")!;
      expect(mrWhitePlayer.word).toContain("Mr. White");
    } finally {
      cleanup();
    }
  });
});
