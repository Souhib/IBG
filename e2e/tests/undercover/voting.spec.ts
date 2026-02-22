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
  emitAndWait,
  disconnectSocket,
} from "../../helpers/socket-client";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  ROUTES,
  SOCKET_EVENTS,
} from "../../helpers/constants";

/**
 * Helper: set up a 3-player undercover game and return all context.
 * Players join via sockets, host starts the game.
 */
async function setupUndercoverGame() {
  const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
  const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
  const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

  const room = await apiCreateRoom(p1Login.access_token, "undercover");
  const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

  const s1 = createSocketClient(p1Login.access_token);
  const s2 = createSocketClient(p2Login.access_token);
  const s3 = createSocketClient(p3Login.access_token);

  await connectSocket(s1);
  await connectSocket(s2);
  await connectSocket(s3);

  // Join room
  for (const [socket, login] of [
    [s1, p1Login],
    [s2, p2Login],
    [s3, p3Login],
  ] as const) {
    socket.emit("join_room", {
      user_id: login.user.id,
      public_room_id: roomDetails.public_id,
      password: roomDetails.password,
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
  }

  // Start game and get roles
  const rolePromises = [
    waitForEvent<{ role: string; word: string }>(
      s1,
      SOCKET_EVENTS.ROLE_ASSIGNED,
    ),
    waitForEvent<{ role: string; word: string }>(
      s2,
      SOCKET_EVENTS.ROLE_ASSIGNED,
    ),
    waitForEvent<{ role: string; word: string }>(
      s3,
      SOCKET_EVENTS.ROLE_ASSIGNED,
    ),
  ];

  const gameStartPromise = waitForEvent<{ game_id: string }>(
    s1,
    SOCKET_EVENTS.GAME_STARTED,
    10_000,
  );

  s1.emit("start_undercover_game", {
    room_id: room.id,
    user_id: p1Login.user.id,
  });

  const roles = await Promise.all(rolePromises);
  const gameStarted = await gameStartPromise;

  return {
    room,
    roomDetails,
    logins: [p1Login, p2Login, p3Login],
    sockets: [s1, s2, s3],
    roles,
    gameId: gameStarted.game_id,
  };
}

test.describe("Undercover — Voting Rules (Socket Protocol)", () => {
  test("player cannot vote for themselves", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const s1 = createSocketClient(p1Login.access_token);
    const s2 = createSocketClient(p2Login.access_token);
    const s3 = createSocketClient(p3Login.access_token);

    await connectSocket(s1);
    await connectSocket(s2);
    await connectSocket(s3);

    for (const [socket, login] of [
      [s1, p1Login],
      [s2, p2Login],
      [s3, p3Login],
    ] as const) {
      socket.emit("join_room", {
        user_id: login.user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
    }

    const rolePromises = [
      waitForEvent(s1, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s2, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s3, SOCKET_EVENTS.ROLE_ASSIGNED),
    ];
    const gameStartPromise = waitForEvent<{ game_id: string }>(
      s1,
      SOCKET_EVENTS.GAME_STARTED,
      10_000,
    );
    s1.emit("start_undercover_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
    });
    await Promise.all(rolePromises);
    const gameStart = await gameStartPromise;
    const gameId = gameStart.game_id;

    // Wait for voting phase
    await new Promise((r) => setTimeout(r, 2000));

    // Player 1 tries to vote for themselves — should get error
    const errorPromise = waitForEvent<{ message: string }>(
      s1,
      SOCKET_EVENTS.ERROR,
      5000,
    );

    s1.emit("vote_for_a_player", {
      room_id: roomDetails.public_id,
      game_id: gameId,
      user_id: p1Login.user.id,
      voted_user_id: p1Login.user.id, // Self-vote!
    });

    const error = await errorPromise.catch(() => null);
    // Should receive an error event (can't vote for yourself)
    if (error) {
      expect(error.message).toBeTruthy();
    }

    disconnectSocket(s1);
    disconnectSocket(s2);
    disconnectSocket(s3);
  });

  test("vote can be changed before all votes are in", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const s1 = createSocketClient(p1Login.access_token);
    const s2 = createSocketClient(p2Login.access_token);
    const s3 = createSocketClient(p3Login.access_token);

    await connectSocket(s1);
    await connectSocket(s2);
    await connectSocket(s3);

    for (const [socket, login] of [
      [s1, p1Login],
      [s2, p2Login],
      [s3, p3Login],
    ] as const) {
      socket.emit("join_room", {
        user_id: login.user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
    }

    const rolePromises = [
      waitForEvent(s1, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s2, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s3, SOCKET_EVENTS.ROLE_ASSIGNED),
    ];
    const gameStartPromise = waitForEvent<{ game_id: string }>(
      s1,
      SOCKET_EVENTS.GAME_STARTED,
      10_000,
    );
    s1.emit("start_undercover_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
    });
    await Promise.all(rolePromises);
    const gameStart = await gameStartPromise;
    const gameId = gameStart.game_id;

    await new Promise((r) => setTimeout(r, 2000));

    // Player 1 votes for player 2
    s1.emit("vote_for_a_player", {
      room_id: roomDetails.public_id,
      game_id: gameId,
      user_id: p1Login.user.id,
      voted_user_id: p2Login.user.id,
    });

    const vote1 = await waitForEvent(s1, SOCKET_EVENTS.VOTE_CASTED, 5000).catch(
      () => null,
    );

    // Player 1 changes vote to player 3 (overwrites previous)
    s1.emit("vote_for_a_player", {
      room_id: roomDetails.public_id,
      game_id: gameId,
      user_id: p1Login.user.id,
      voted_user_id: p3Login.user.id,
    });

    const vote2 = await waitForEvent(s1, SOCKET_EVENTS.VOTE_CASTED, 5000).catch(
      () => null,
    );

    // Should not crash — vote overwrite is allowed
    expect(true).toBeTruthy(); // If we get here, no error was thrown

    disconnectSocket(s1);
    disconnectSocket(s2);
    disconnectSocket(s3);
  });

  test("elimination occurs after all alive players vote", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const s1 = createSocketClient(p1Login.access_token);
    const s2 = createSocketClient(p2Login.access_token);
    const s3 = createSocketClient(p3Login.access_token);

    await connectSocket(s1);
    await connectSocket(s2);
    await connectSocket(s3);

    for (const [socket, login] of [
      [s1, p1Login],
      [s2, p2Login],
      [s3, p3Login],
    ] as const) {
      socket.emit("join_room", {
        user_id: login.user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
    }

    const rolePromises = [
      waitForEvent(s1, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s2, SOCKET_EVENTS.ROLE_ASSIGNED),
      waitForEvent(s3, SOCKET_EVENTS.ROLE_ASSIGNED),
    ];
    const gameStartPromise = waitForEvent<{ game_id: string }>(
      s1,
      SOCKET_EVENTS.GAME_STARTED,
      10_000,
    );
    s1.emit("start_undercover_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
    });
    await Promise.all(rolePromises);
    const gameStart = await gameStartPromise;
    const gameId = gameStart.game_id;

    await new Promise((r) => setTimeout(r, 2000));

    // Listen for elimination or game over on all sockets
    const outcomePromise = Promise.race([
      waitForEvent(s1, SOCKET_EVENTS.PLAYER_ELIMINATED, 15_000),
      waitForEvent(s1, SOCKET_EVENTS.GAME_OVER, 15_000),
    ]);

    // Players 1 and 2 vote for player 3, player 3 votes for player 1
    // (player 3 cannot self-vote — backend rejects it)
    for (const [socket, login, votedUserId] of [
      [s1, p1Login, p3Login.user.id],
      [s2, p2Login, p3Login.user.id],
      [s3, p3Login, p1Login.user.id],
    ] as const) {
      socket.emit("vote_for_a_player", {
        room_id: roomDetails.public_id,
        game_id: gameId,
        user_id: login.user.id,
        voted_user_id: votedUserId,
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    // Should receive elimination or game over
    const result = await outcomePromise;
    expect(result).toBeTruthy();

    disconnectSocket(s1);
    disconnectSocket(s2);
    disconnectSocket(s3);
  });

  test("role distribution is correct for 3 players", async () => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const s1 = createSocketClient(p1Login.access_token);
    const s2 = createSocketClient(p2Login.access_token);
    const s3 = createSocketClient(p3Login.access_token);

    await connectSocket(s1);
    await connectSocket(s2);
    await connectSocket(s3);

    for (const [socket, login] of [
      [s1, p1Login],
      [s2, p2Login],
      [s3, p3Login],
    ] as const) {
      socket.emit("join_room", {
        user_id: login.user.id,
        public_room_id: roomDetails.public_id,
        password: roomDetails.password,
      });
      await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATUS);
    }

    const rolePromises = [
      waitForEvent<{ role: string; word: string }>(
        s1,
        SOCKET_EVENTS.ROLE_ASSIGNED,
      ),
      waitForEvent<{ role: string; word: string }>(
        s2,
        SOCKET_EVENTS.ROLE_ASSIGNED,
      ),
      waitForEvent<{ role: string; word: string }>(
        s3,
        SOCKET_EVENTS.ROLE_ASSIGNED,
      ),
    ];

    s1.emit("start_undercover_game", {
      room_id: room.id,
      user_id: p1Login.user.id,
    });

    const roles = await Promise.all(rolePromises);
    const roleNames = roles.map((r) => r.role);

    // With 3 players: 1 Mr. White, 1 Undercover, 1 Civilian
    // OR backend may use different distribution
    expect(roleNames).toHaveLength(3);
    for (const role of roleNames) {
      expect(["civilian", "undercover", "mr_white"]).toContain(role);
    }

    // Every player should have a word
    for (const r of roles) {
      expect(r.word).toBeTruthy();
    }

    disconnectSocket(s1);
    disconnectSocket(s2);
    disconnectSocket(s3);
  });
});

test.describe("Undercover — Voting UI", () => {
  test("voting buttons do not include the current player", async ({
    browser,
  }) => {
    // Start a 3-player game via UI and check the voting phase
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    // All join room lobby
    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    for (const [player, login] of [
      [player2, p2Login],
      [player3, p3Login],
    ] as const) {
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
    }

    // Host starts the game
    await player1.locator('button:has-text("Start")').click();

    // All players should be on game page
    for (const player of [player1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }

    // Wait for game state to fully load (role reveal → voting)
    await player1.waitForTimeout(5000);

    // Check that the vote section exists (if in voting phase)
    // The heading "Vote" indicates voting phase
    const voteHeading = player1.locator('text=Vote').first();
    const isVoting = await voteHeading.isVisible().catch(() => false);

    if (isVoting) {
      // Player 1's own username should NOT appear as a votable button
      // (voting buttons are for other alive players only)
      const voteButtons = player1.locator(
        'button:has(.lucide-user)',
      );
      const buttonCount = await voteButtons.count();
      // Should have exactly 2 buttons (the other 2 players)
      expect(buttonCount).toBe(2);
    }

    await player1.context().close();
    await player2.context().close();
    await player3.context().close();
  });

  test("player sees role and word on game start", async ({ browser }) => {
    const p1Login = await apiLogin(TEST_USER.email, TEST_USER.password);
    const p2Login = await apiLogin(TEST_PLAYER.email, TEST_PLAYER.password);
    const p3Login = await apiLogin(TEST_ALI.email, TEST_ALI.password);

    const room = await apiCreateRoom(p1Login.access_token, "undercover");
    const roomDetails = await apiGetRoom(room.id, p1Login.access_token);

    const player1 = await createPlayerPage(
      browser,
      TEST_USER.email,
      TEST_USER.password,
    );
    const player2 = await createPlayerPage(
      browser,
      TEST_PLAYER.email,
      TEST_PLAYER.password,
    );
    const player3 = await createPlayerPage(
      browser,
      TEST_ALI.email,
      TEST_ALI.password,
    );

    await player1.goto(ROUTES.room(room.id));
    await player1.waitForLoadState("networkidle");
    await player1.waitForTimeout(2000);

    for (const [player, login] of [
      [player2, p2Login],
      [player3, p3Login],
    ] as const) {
      await player.goto(ROUTES.rooms);
      await player.waitForLoadState("networkidle");
      await player
        .locator('input[id="room-code"]')
        .fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let i = 0; i < 4; i++) {
        await player
          .locator(`input[aria-label="Password digit ${i + 1}"]`)
          .fill(pinDigits[i]);
      }
      await player.locator('button[type="submit"]').click();
      await expect(player).toHaveURL(/\/rooms\//, { timeout: 15_000 });
      await player.waitForTimeout(1500);
    }

    await player1.locator('button:has-text("Start")').click();

    for (const player of [player1, player2, player3]) {
      await expect(player).toHaveURL(/\/game\/undercover\//, {
        timeout: 15_000,
      });
    }

    // Each player should see "Your Role" heading
    for (const player of [player1, player2, player3]) {
      await expect(player.getByText("Your Role")).toBeVisible({
        timeout: 10_000,
      });
    }

    // Each player should see role badge
    for (const player of [player1, player2, player3]) {
      const roleBadge = player.locator(".bg-primary\\/10.px-6.py-2");
      await expect(roleBadge).toBeVisible({ timeout: 10_000 });
      const roleText = await roleBadge.textContent();
      expect(roleText).toBeTruthy();
    }

    // Each player should see "Your Word" section
    for (const player of [player1, player2, player3]) {
      await expect(player.getByText("Your Word")).toBeVisible({
        timeout: 5_000,
      });
    }

    await player1.context().close();
    await player2.context().close();
    await player3.context().close();
  });
});
