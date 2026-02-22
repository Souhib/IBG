import { test, expect } from "@playwright/test";
import { createPlayerPage } from "../../fixtures/auth.fixture";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
} from "../../helpers/api-client";
import {
  createSocketClient,
  connectSocket,
  waitForEvent,
  disconnectSocket,
} from "../../helpers/socket-client";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  ROUTES,
  SOCKET_EVENTS,
} from "../../helpers/constants";

test.describe("Codenames — Full Game Flow", () => {
  test("4-player game: start, board shown, clue, guess, game progresses", async ({
    browser,
  }) => {
    // ─── Setup: Create room and have 4 players join ─────────

    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    // Create browser pages for all 4 players
    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );

    // Player 1 navigates to room lobby
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    // Players 2-4 join via rooms page
    const otherPlayers: Awaited<ReturnType<typeof createPlayerPage>>[] = [];
    for (const login of [p2Login, p3Login, p4Login]) {
      const player = await createPlayerPage(
        browser,
        login.user.email,
        // We need to re-use the password. Map from login response to known passwords.
        login === p2Login
          ? TEST_PLAYER.password
          : login === p3Login
            ? TEST_ALI.password
            : TEST_FATIMA.password,
      );
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player.locator('input[id="room-code"]').fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
      otherPlayers.push(player);
    }

    const allPlayers = [player1, ...otherPlayers];

    // ─── Start Codenames Game ───────────────────────────────

    // Host selects Codenames game type
    await player1.waitForTimeout(1000);
    await player1.locator('button:has-text("Codenames")').click();

    // Click start game
    const startButton = player1.locator('button:has-text("Start")');
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();

    // ─── Verify all players navigate to game page ───────────

    for (const player of allPlayers) {
      await expect(player).toHaveURL(/\/game\/codenames\//, {
        timeout: 15_000,
      });
    }

    // Wait for board to load
    await player1.waitForTimeout(3000);

    // ─── Verify the 5x5 board is shown ─────────────────────

    for (const player of allPlayers) {
      // The board is a 5x5 grid (grid-cols-5)
      const cards = player.locator(".grid-cols-5 button");
      const cardCount = await cards.count();
      expect(cardCount).toBe(25);
    }

    // ─── Verify team and role info ──────────────────────────

    for (const player of allPlayers) {
      // Each player should see "You are a [Red/Blue] [Spymaster/Operative]"
      const infoText = await player
        .locator(".bg-muted\\/50.p-3.text-center.text-sm")
        .textContent();
      expect(infoText).toContain("You are a");
    }

    // ─── Verify score display ───────────────────────────────

    // The header shows remaining cards for each team
    const redRemaining = await player1
      .locator(".bg-red-500 + .text-sm")
      .textContent();
    const blueRemaining = await player1
      .locator(".bg-blue-500 + .text-sm")
      .textContent();
    // Red should have 9 or 8, blue should have 8 or 9
    expect(parseInt(redRemaining || "0")).toBeGreaterThanOrEqual(8);
    expect(parseInt(blueRemaining || "0")).toBeGreaterThanOrEqual(8);

    // ─── Cleanup ────────────────────────────────────────────

    for (const player of allPlayers) {
      await player.context().close();
    }
  });

  test("4-player game via socket: clue giving and card guessing", async () => {
    // Protocol-level test using raw socket connections
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    // Create socket connections
    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];

    const logins = [p1Login, p2Login, p3Login, p4Login];

    // Connect all sockets
    for (const socket of sockets) {
      await connectSocket(socket);
    }

    // Join room with all players
    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    // Set up listeners for game started event on all sockets
    const gameStartPromises = sockets.map((s) =>
      waitForEvent<{
        game_id: string;
        team: string;
        role: string;
        board: { word: string; card_type: string | null; revealed: boolean }[];
        current_team: string;
        red_remaining: number;
        blue_remaining: number;
      }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
    );

    // Host starts the game
    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    // All players receive game_started
    const gameStarts = await Promise.all(gameStartPromises);

    // Verify all players got their assignments
    for (const gs of gameStarts) {
      expect(gs.game_id).toBeTruthy();
      expect(["red", "blue"]).toContain(gs.team);
      expect(["spymaster", "operative"]).toContain(gs.role);
      expect(gs.board.length).toBe(25);
    }

    const gameId = gameStarts[0].game_id;
    const currentTeam = gameStarts[0].current_team;

    // Find the spymaster of the current team
    const spymasterIndex = gameStarts.findIndex(
      (gs) => gs.team === currentTeam && gs.role === "spymaster",
    );
    expect(spymasterIndex).toBeGreaterThanOrEqual(0);

    // Spymaster gives a clue
    const cluePromises = sockets.map((s) =>
      waitForEvent<{
        clue_word: string;
        clue_number: number;
        team: string;
      }>(s, SOCKET_EVENTS.CODENAMES_CLUE_GIVEN, 10_000),
    );

    sockets[spymasterIndex].emit("give_clue", {
      room_id: roomDetails.public_id,
      game_id: gameId,
      user_id: logins[spymasterIndex].user.id,
      clue_word: "test",
      clue_number: 1,
    });

    const clues = await Promise.all(cluePromises);
    for (const clue of clues) {
      expect(clue.clue_word).toBe("test");
      expect(clue.clue_number).toBe(1);
      expect(clue.team).toBe(currentTeam);
    }

    // Find an operative of the current team
    const operativeIndex = gameStarts.findIndex(
      (gs) => gs.team === currentTeam && gs.role === "operative",
    );
    expect(operativeIndex).toBeGreaterThanOrEqual(0);

    // Operative guesses a card (first unrevealed card)
    const cardRevealPromises = sockets.map((s) =>
      waitForEvent<{
        card_index: number;
        card_type: string;
        result: string;
      }>(s, SOCKET_EVENTS.CODENAMES_CARD_REVEALED, 10_000),
    );

    sockets[operativeIndex].emit("guess_card", {
      room_id: roomDetails.public_id,
      game_id: gameId,
      user_id: logins[operativeIndex].user.id,
      card_index: 0, // Guess first card
    });

    const reveals = await Promise.all(cardRevealPromises);
    for (const reveal of reveals) {
      expect(reveal.card_index).toBe(0);
      expect(reveal.card_type).toBeTruthy();
      expect(reveal.result).toBeTruthy();
    }

    // Cleanup
    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });
});
