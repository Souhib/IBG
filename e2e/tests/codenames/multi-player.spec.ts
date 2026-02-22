import { test, expect } from "@playwright/test";
import { waitForEvent } from "../../helpers/socket-client";
import { SOCKET_EVENTS } from "../../helpers/constants";
import {
  setupCodenamesGame,
  type CodenamesPlayer,
} from "../../helpers/game-setup";

test.describe("Codenames — Multi-Player Games (6 Players)", () => {
  test("6-player team assignment is balanced (3v3)", async () => {
    const { players, cleanup } = await setupCodenamesGame(6);

    try {
      const redPlayers = players.filter((p) => p.team === "red");
      const bluePlayers = players.filter((p) => p.team === "blue");

      // Each team has 3 players
      expect(redPlayers).toHaveLength(3);
      expect(bluePlayers).toHaveLength(3);

      // Each team has 1 spymaster + 2 operatives
      expect(
        redPlayers.filter((p) => p.gameRole === "spymaster"),
      ).toHaveLength(1);
      expect(
        redPlayers.filter((p) => p.gameRole === "operative"),
      ).toHaveLength(2);
      expect(
        bluePlayers.filter((p) => p.gameRole === "spymaster"),
      ).toHaveLength(1);
      expect(
        bluePlayers.filter((p) => p.gameRole === "operative"),
      ).toHaveLength(2);

      // Board has 25 cards
      const spymaster = players.find((p) => p.gameRole === "spymaster")!;
      expect(spymaster.board).toHaveLength(25);
    } finally {
      cleanup();
    }
  });

  test("6-player full game: correct guesses lead to team victory", async () => {
    const { players, gameId, roomPublicId, currentTeam, cleanup } =
      await setupCodenamesGame(6);

    try {
      // Find current team's spymaster (has full board with card_types)
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      expect(spymaster).toBeTruthy();

      // Find current team's operative (first one)
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;
      expect(operative).toBeTruthy();

      // Get indices of all cards belonging to the current team
      const teamCardIndices = spymaster.board
        .filter((card) => card.card_type === currentTeam)
        .map((card) => card.index);

      expect(teamCardIndices.length).toBeGreaterThanOrEqual(8);

      // Spymaster gives clue with number = total team cards
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "victory",
        clue_number: teamCardIndices.length,
      });

      await cluePromise;

      // Operative guesses all team cards one by one
      for (let i = 0; i < teamCardIndices.length; i++) {
        const isLast = i === teamCardIndices.length - 1;

        const revealPromise = waitForEvent<{
          card_index: number;
          card_type: string;
          result: string;
        }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

        let gameOverPromise: Promise<{
          winner: string;
          reason: string;
        }> | null = null;
        if (isLast) {
          gameOverPromise = waitForEvent(
            operative.socket,
            SOCKET_EVENTS.CODENAMES_GAME_OVER,
            10_000,
          );
        }

        operative.socket.emit("guess_card", {
          room_id: roomPublicId,
          game_id: gameId,
          user_id: operative.login.user.id,
          card_index: teamCardIndices[i],
        });

        const reveal = await revealPromise;
        expect(reveal.card_type).toBe(currentTeam);

        if (isLast) {
          expect(reveal.result).toBe("win");
          const gameOver = await gameOverPromise!;
          expect(gameOver.winner).toBe(currentTeam);
        } else {
          expect(reveal.result).toBe("correct");
        }
      }
    } finally {
      cleanup();
    }
  });

  test("assassin card causes immediate loss", async () => {
    const { players, gameId, roomPublicId, currentTeam, cleanup } =
      await setupCodenamesGame(6);

    try {
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;

      // Find the assassin card
      const assassinCard = spymaster.board.find(
        (card) => card.card_type === "assassin",
      )!;
      expect(assassinCard).toBeTruthy();

      // Spymaster gives a clue
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "danger",
        clue_number: 1,
      });

      await cluePromise;

      // Operative guesses the assassin card
      const revealPromise = waitForEvent<{
        card_index: number;
        card_type: string;
        result: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      const gameOverPromise = waitForEvent<{
        winner: string;
        reason: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_GAME_OVER, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: assassinCard.index,
      });

      const reveal = await revealPromise;
      expect(reveal.card_type).toBe("assassin");
      expect(reveal.result).toBe("assassin");

      const gameOver = await gameOverPromise;
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      expect(gameOver.winner).toBe(otherTeam);
      expect(gameOver.reason).toBe("assassin");
    } finally {
      cleanup();
    }
  });

  test("neutral card ends turn without penalty", async () => {
    const { players, gameId, roomPublicId, currentTeam, cleanup } =
      await setupCodenamesGame(6);

    try {
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;

      // Find a neutral card
      const neutralCard = spymaster.board.find(
        (card) => card.card_type === "neutral",
      )!;
      expect(neutralCard).toBeTruthy();

      // Spymaster gives a clue
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "nothing",
        clue_number: 1,
      });

      await cluePromise;

      // Operative guesses neutral card
      const revealPromise = waitForEvent<{
        card_type: string;
        result: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      const turnEndPromise = waitForEvent<{
        reason: string;
        current_team: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_TURN_ENDED, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: neutralCard.index,
      });

      const reveal = await revealPromise;
      expect(reveal.card_type).toBe("neutral");
      expect(reveal.result).toBe("neutral");

      const turnEnd = await turnEndPromise;
      expect(turnEnd.reason).toBe("neutral");
      // Turn switches to other team
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      expect(turnEnd.current_team).toBe(otherTeam);
    } finally {
      cleanup();
    }
  });

  test("opponent card ends turn and decrements opponent's remaining", async () => {
    const {
      players,
      gameId,
      roomPublicId,
      currentTeam,
      redRemaining,
      blueRemaining,
      cleanup,
    } = await setupCodenamesGame(6);

    try {
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;

      const otherTeam = currentTeam === "red" ? "blue" : "red";
      const initialOpponentRemaining =
        otherTeam === "red" ? redRemaining : blueRemaining;

      // Find an opponent's card
      const opponentCard = spymaster.board.find(
        (card) => card.card_type === otherTeam,
      )!;
      expect(opponentCard).toBeTruthy();

      // Spymaster gives a clue
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "mistake",
        clue_number: 1,
      });

      await cluePromise;

      // Operative guesses opponent's card
      const revealPromise = waitForEvent<{
        card_type: string;
        result: string;
        red_remaining: number;
        blue_remaining: number;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      const turnEndPromise = waitForEvent<{
        reason: string;
        current_team: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_TURN_ENDED, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: opponentCard.index,
      });

      const reveal = await revealPromise;
      expect(reveal.card_type).toBe(otherTeam);
      expect(reveal.result).toBe("opponent_card");

      // Opponent's remaining should decrease by 1
      const newOpponentRemaining =
        otherTeam === "red" ? reveal.red_remaining : reveal.blue_remaining;
      expect(newOpponentRemaining).toBe(initialOpponentRemaining - 1);

      const turnEnd = await turnEndPromise;
      expect(turnEnd.reason).toBe("opponent_card");
      expect(turnEnd.current_team).toBe(otherTeam);
    } finally {
      cleanup();
    }
  });

  test("operative voluntarily ends turn", async () => {
    const { players, gameId, roomPublicId, currentTeam, cleanup } =
      await setupCodenamesGame(6);

    try {
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;

      // Find a correct team card
      const teamCard = spymaster.board.find(
        (card) => card.card_type === currentTeam,
      )!;

      // Spymaster gives clue with number=2
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "partial",
        clue_number: 2,
      });

      await cluePromise;

      // Operative guesses 1 correct card
      const revealPromise = waitForEvent<{
        result: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: teamCard.index,
      });

      const reveal = await revealPromise;
      expect(reveal.result).toBe("correct");

      // Operative voluntarily ends turn
      const turnEndPromise = waitForEvent<{
        reason: string;
        current_team: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_TURN_ENDED, 10_000);

      operative.socket.emit("end_turn", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
      });

      const turnEnd = await turnEndPromise;
      expect(turnEnd.reason).toBe("voluntary");
      const otherTeam = currentTeam === "red" ? "blue" : "red";
      expect(turnEnd.current_team).toBe(otherTeam);
    } finally {
      cleanup();
    }
  });

  test("max guesses enforcement (clue_number + 1)", async () => {
    const { players, gameId, roomPublicId, currentTeam, cleanup } =
      await setupCodenamesGame(6);

    try {
      const spymaster = players.find(
        (p) => p.team === currentTeam && p.gameRole === "spymaster",
      )!;
      const operative = players.find(
        (p) => p.team === currentTeam && p.gameRole === "operative",
      )!;

      // Find 2 correct team cards
      const teamCards = spymaster.board.filter(
        (card) => card.card_type === currentTeam,
      );
      expect(teamCards.length).toBeGreaterThanOrEqual(2);

      // Spymaster gives clue with number=1 → max_guesses=2
      const cluePromise = waitForEvent(
        operative.socket,
        SOCKET_EVENTS.CODENAMES_CLUE_GIVEN,
        10_000,
      );

      spymaster.socket.emit("give_clue", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: spymaster.login.user.id,
        clue_word: "limit",
        clue_number: 1,
      });

      await cluePromise;

      // Guess 1: correct
      const reveal1Promise = waitForEvent<{
        result: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: teamCards[0].index,
      });

      const reveal1 = await reveal1Promise;
      expect(reveal1.result).toBe("correct");

      // Guess 2: correct but hits max_guesses (2)
      const reveal2Promise = waitForEvent<{
        result: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000);

      const turnEndPromise = waitForEvent<{
        reason: string;
        current_team: string;
      }>(operative.socket, SOCKET_EVENTS.CODENAMES_TURN_ENDED, 10_000);

      operative.socket.emit("guess_card", {
        room_id: roomPublicId,
        game_id: gameId,
        user_id: operative.login.user.id,
        card_index: teamCards[1].index,
      });

      const reveal2 = await reveal2Promise;
      expect(reveal2.result).toBe("max_guesses");

      const turnEnd = await turnEndPromise;
      expect(turnEnd.reason).toBe("max_guesses");
    } finally {
      cleanup();
    }
  });
});
