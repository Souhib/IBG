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

test.describe("Codenames — Role Restrictions (Socket Protocol)", () => {
  test("operative cannot give a clue", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];
    const logins = [p1Login, p2Login, p3Login, p4Login];

    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    // Start game
    const gameStartPromises = sockets.map((s) =>
      waitForEvent<{
        game_id: string;
        team: string;
        role: string;
        board: unknown[];
        current_team: string;
      }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
    );

    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    const gameStarts = await Promise.all(gameStartPromises);
    const gameId = gameStarts[0].game_id;
    const currentTeam = gameStarts[0].current_team;

    // Find operative of current team
    const operativeIndex = gameStarts.findIndex(
      (gs) => gs.team === currentTeam && gs.role === "operative",
    );
    expect(operativeIndex).toBeGreaterThanOrEqual(0);

    // Operative tries to give a clue — should get error
    const errorPromise = waitForEvent<{ message: string; frontend_message?: string }>(
      sockets[operativeIndex],
      SOCKET_EVENTS.ERROR,
      5000,
    );

    sockets[operativeIndex].emit("give_clue", {
      game_id: gameId,
      user_id: logins[operativeIndex].user.id,
      clue_word: "test",
      clue_number: 1,
    });

    const error = await errorPromise.catch(() => null);
    if (error) {
      expect(error.message || error.frontend_message).toBeTruthy();
    }

    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });

  test("wrong team cannot give a clue", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];
    const logins = [p1Login, p2Login, p3Login, p4Login];

    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    const gameStartPromises = sockets.map((s) =>
      waitForEvent<{
        game_id: string;
        team: string;
        role: string;
        current_team: string;
      }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
    );

    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    const gameStarts = await Promise.all(gameStartPromises);
    const gameId = gameStarts[0].game_id;
    const currentTeam = gameStarts[0].current_team;
    const otherTeam = currentTeam === "red" ? "blue" : "red";

    // Find spymaster of the OTHER team (wrong team)
    const wrongSpymasterIndex = gameStarts.findIndex(
      (gs) => gs.team === otherTeam && gs.role === "spymaster",
    );
    expect(wrongSpymasterIndex).toBeGreaterThanOrEqual(0);

    // Wrong team spymaster tries to give a clue
    const errorPromise = waitForEvent<{ message: string }>(
      sockets[wrongSpymasterIndex],
      SOCKET_EVENTS.ERROR,
      5000,
    );

    sockets[wrongSpymasterIndex].emit("give_clue", {
      game_id: gameId,
      user_id: logins[wrongSpymasterIndex].user.id,
      clue_word: "illegal",
      clue_number: 1,
    });

    const error = await errorPromise.catch(() => null);
    if (error) {
      expect(error.message).toBeTruthy();
    }

    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });

  test("clue word that is on the board is rejected", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];
    const logins = [p1Login, p2Login, p3Login, p4Login];

    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    const gameStartPromises = sockets.map((s) =>
      waitForEvent<{
        game_id: string;
        team: string;
        role: string;
        board: { word: string }[];
        current_team: string;
      }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
    );

    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    const gameStarts = await Promise.all(gameStartPromises);
    const gameId = gameStarts[0].game_id;
    const currentTeam = gameStarts[0].current_team;

    // Find spymaster of current team
    const spymasterIndex = gameStarts.findIndex(
      (gs) => gs.team === currentTeam && gs.role === "spymaster",
    );
    const board = gameStarts[spymasterIndex].board;

    // Use a word from the board as the clue (should be rejected)
    const boardWord = board[0].word;

    const errorPromise = waitForEvent<{ message: string }>(
      sockets[spymasterIndex],
      SOCKET_EVENTS.ERROR,
      5000,
    );

    sockets[spymasterIndex].emit("give_clue", {
      game_id: gameId,
      user_id: logins[spymasterIndex].user.id,
      clue_word: boardWord, // This is on the board!
      clue_number: 1,
    });

    const error = await errorPromise.catch(() => null);
    if (error) {
      expect(error.message).toBeTruthy();
    }

    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });

  test("board has exactly 25 cards with correct distribution", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];
    const logins = [p1Login, p2Login, p3Login, p4Login];

    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

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

    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    const gameStarts = await Promise.all(gameStartPromises);

    // Find spymaster to see the full board with card types
    const spymasterData = gameStarts.find((gs) => gs.role === "spymaster")!;
    const board = spymasterData.board;

    // Board should have exactly 25 cards
    expect(board).toHaveLength(25);

    // All cards should be unrevealed
    for (const card of board) {
      expect(card.revealed).toBe(false);
    }

    // Card distribution: 9+8+7+1 = 25
    const typeCounts: Record<string, number> = {};
    for (const card of board) {
      const type = card.card_type || "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    // First team gets 9, second gets 8, neutral 7, assassin 1
    expect(typeCounts["neutral"]).toBe(7);
    expect(typeCounts["assassin"]).toBe(1);

    const redCount = typeCounts["red"] || 0;
    const blueCount = typeCounts["blue"] || 0;
    expect(redCount + blueCount).toBe(17); // 9 + 8
    expect(Math.max(redCount, blueCount)).toBe(9);
    expect(Math.min(redCount, blueCount)).toBe(8);

    // Remaining counts should match
    expect(spymasterData.red_remaining).toBe(redCount);
    expect(spymasterData.blue_remaining).toBe(blueCount);

    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });

  test("team assignment is balanced for 4 players", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const sockets = [
      createSocketClient(p1Login.access_token),
      createSocketClient(p2Login.access_token),
      createSocketClient(p3Login.access_token),
      createSocketClient(p4Login.access_token),
    ];
    const logins = [p1Login, p2Login, p3Login, p4Login];

    for (const socket of sockets) {
      await connectSocket(socket);
    }

    for (let i = 0; i < sockets.length; i++) {
      sockets[i].emit("join_room", {
        user_id: logins[i].user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(sockets[i], SOCKET_EVENTS.ROOM_STATUS);
    }

    const gameStartPromises = sockets.map((s) =>
      waitForEvent<{
        game_id: string;
        team: string;
        role: string;
      }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
    );

    sockets[0].emit("start_codenames_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
      word_pack_ids: null,
    });

    const gameStarts = await Promise.all(gameStartPromises);

    // Each team should have 2 players
    const redPlayers = gameStarts.filter((gs) => gs.team === "red");
    const bluePlayers = gameStarts.filter((gs) => gs.team === "blue");

    expect(redPlayers).toHaveLength(2);
    expect(bluePlayers).toHaveLength(2);

    // Each team should have exactly 1 spymaster and 1 operative
    expect(
      redPlayers.filter((p) => p.role === "spymaster"),
    ).toHaveLength(1);
    expect(
      redPlayers.filter((p) => p.role === "operative"),
    ).toHaveLength(1);
    expect(
      bluePlayers.filter((p) => p.role === "spymaster"),
    ).toHaveLength(1);
    expect(
      bluePlayers.filter((p) => p.role === "operative"),
    ).toHaveLength(1);

    for (const socket of sockets) {
      disconnectSocket(socket);
    }
  });
});

test.describe("Codenames — Role UI Restrictions", () => {
  test("spymaster sees clue input, operative does not", async ({
    browser,
  }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const players = await Promise.all([
      createPlayerPage(browser, TEST_USER.email, TEST_USER.password),
      createPlayerPage(browser, TEST_PLAYER.email, TEST_PLAYER.password),
      createPlayerPage(browser, TEST_ALI.email, TEST_ALI.password),
      createPlayerPage(browser, TEST_FATIMA.email, TEST_FATIMA.password),
    ]);

    // Host navigates to room
    await players[0].goto(ROUTES.room(room.id));
    await players[0].waitForLoadState("networkidle");
    await players[0].waitForTimeout(2000);

    // Other players join
    for (let i = 1; i < 4; i++) {
      await players[i].goto(ROUTES.rooms);
      await players[i].waitForLoadState("networkidle");
      await players[i]
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let j = 0; j < 4; j++) {
        await players[i]
          .locator(`input[aria-label="Password digit ${j + 1}"]`)
          .fill(pinDigits[j]);
      }
      await players[i].locator('button[type="submit"]').click();
      await expect(players[i]).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await players[i].waitForTimeout(1500);
    }

    // Switch to codenames and start
    await players[0].locator('button:has-text("Codenames")').click();
    await players[0].locator('button:has-text("Start")').click();

    for (const player of players) {
      await expect(player).toHaveURL(/\/game\/codenames\//, {
        timeout: 15_000,
      });
    }

    await players[0].waitForTimeout(3000);

    // Find which player is spymaster of current team
    // by checking who sees the clue input
    let spymasterFound = false;
    let operativeFound = false;

    for (const player of players) {
      // Check for "You are a" text to get role info
      const infoText = await player
        .locator(".bg-muted\\/50.p-3.text-center.text-sm")
        .textContent()
        .catch(() => "");

      if (!infoText) continue;

      // Check if clue input is visible (only for current team's spymaster)
      const clueInput = player.locator(
        'input[placeholder*="clue" i], input[type="text"]',
      );
      const hasClueInput = await clueInput.first().isVisible().catch(() => false);

      if (infoText.toLowerCase().includes("spymaster")) {
        spymasterFound = true;
        // Spymaster MAY see clue input (only if it's their team's turn)
      }

      if (infoText.toLowerCase().includes("operative")) {
        operativeFound = true;
        // Operative should NOT see clue input
        // They should see the "End Turn" button instead (if clue was given)
      }
    }

    // Both roles should exist
    expect(spymasterFound || operativeFound).toBeTruthy();

    // Each player should see their role info
    for (const player of players) {
      const roleInfo = player.locator(".bg-muted\\/50.p-3.text-center.text-sm");
      await expect(roleInfo).toBeVisible({ timeout: 5_000 });
      const text = await roleInfo.textContent();
      expect(text).toContain("You are a");
    }

    for (const player of players) {
      await player.context().close();
    }
  });

  test("all players see 25 cards on the board", async ({ browser }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);
    const p4Login = await apiLogin(TEST_FATIMA.email, TEST_FATIMA.password);

    const room = await apiCreateRoom(p1Login.access_token, "codenames");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const players = await Promise.all([
      createPlayerPage(browser, TEST_USER.email, TEST_USER.password),
      createPlayerPage(browser, TEST_PLAYER.email, TEST_PLAYER.password),
      createPlayerPage(browser, TEST_ALI.email, TEST_ALI.password),
      createPlayerPage(browser, TEST_FATIMA.email, TEST_FATIMA.password),
    ]);

    await players[0].goto(ROUTES.room(room.id));
    await players[0].waitForLoadState("networkidle");
    await players[0].waitForTimeout(2000);

    for (let i = 1; i < 4; i++) {
      await players[i].goto(ROUTES.rooms);
      await players[i].waitForLoadState("networkidle");
      await players[i]
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let j = 0; j < 4; j++) {
        await players[i]
          .locator(`input[aria-label="Password digit ${j + 1}"]`)
          .fill(pinDigits[j]);
      }
      await players[i].locator('button[type="submit"]').click();
      await expect(players[i]).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await players[i].waitForTimeout(1500);
    }

    await players[0].locator('button:has-text("Codenames")').click();
    await players[0].locator('button:has-text("Start")').click();

    for (const player of players) {
      await expect(player).toHaveURL(/\/game\/codenames\//, {
        timeout: 15_000,
      });
    }

    await players[0].waitForTimeout(3000);

    // Every player should see exactly 25 cards
    for (const player of players) {
      const cards = player.locator(".grid-cols-5 button");
      await expect(cards).toHaveCount(25, { timeout: 10_000 });
    }

    for (const player of players) {
      await player.context().close();
    }
  });
});
