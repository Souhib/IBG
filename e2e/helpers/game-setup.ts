import type { Socket } from "socket.io-client";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
  type LoginResponse,
} from "./api-client";
import {
  createSocketClient,
  connectSocket,
  waitForEvent,
  disconnectSocket,
} from "./socket-client";
import {
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
  TEST_YUSUF,
  TEST_MARYAM,
  TEST_HAMZA,
  TEST_ADMIN,
  SOCKET_EVENTS,
} from "./constants";

// ─── Types ──────────────────────────────────────────────────

const ALL_ACCOUNTS = [
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
  TEST_YUSUF,
  TEST_MARYAM,
  TEST_HAMZA,
  TEST_ADMIN,
] as const;

export interface UndercoverPlayer {
  login: LoginResponse;
  socket: Socket;
  role: string;
  word: string;
  account: (typeof ALL_ACCOUNTS)[number];
}

export interface UndercoverSetup {
  players: UndercoverPlayer[];
  gameId: string;
  roomId: string;
  roomPublicId: string;
  roomPassword: string;
  mayor: string;
  cleanup: () => void;
}

export interface CodenamesCard {
  index: number;
  word: string;
  card_type: string | null;
  revealed: boolean;
}

export interface CodenamesPlayerInfo {
  user_id: string;
  username: string;
  team: string;
  role: string;
}

export interface CodenamesPlayer {
  login: LoginResponse;
  socket: Socket;
  team: string;
  gameRole: string;
  board: CodenamesCard[];
  account: (typeof ALL_ACCOUNTS)[number];
}

export interface CodenamesSetup {
  players: CodenamesPlayer[];
  gameId: string;
  roomId: string;
  roomPublicId: string;
  roomPassword: string;
  currentTeam: string;
  redRemaining: number;
  blueRemaining: number;
  cleanup: () => void;
}

// ─── Undercover Setup ───────────────────────────────────────

export async function setupUndercoverGame(
  playerCount: number,
): Promise<UndercoverSetup> {
  const accounts = ALL_ACCOUNTS.slice(0, playerCount);

  const logins = await Promise.all(
    accounts.map((a) => apiLogin(a.email, a.password)),
  );

  const room = await apiCreateRoom(logins[0].access_token, "undercover");
  const roomDetails = await apiGetRoom(room.id, logins[0].access_token);

  const sockets = logins.map((l) => createSocketClient(l.access_token));
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

  const rolePromises = sockets.map((s) =>
    waitForEvent<{ role: string; word: string }>(
      s,
      SOCKET_EVENTS.ROLE_ASSIGNED,
    ),
  );

  const gameStartPromise = waitForEvent<{
    game_id: string;
    mayor: string;
  }>(sockets[0], SOCKET_EVENTS.GAME_STARTED, 15_000);

  sockets[0].emit("start_undercover_game", {
    room_id: room.id,
    user_id: logins[0].user.id,
  });

  const roles = await Promise.all(rolePromises);
  const gameStarted = await gameStartPromise;

  const players: UndercoverPlayer[] = accounts.map((account, i) => ({
    login: logins[i],
    socket: sockets[i],
    role: roles[i].role,
    word: roles[i].word,
    account,
  }));

  return {
    players,
    gameId: gameStarted.game_id,
    roomId: room.id,
    roomPublicId: roomDetails.public_id,
    roomPassword: roomDetails.password,
    mayor: gameStarted.mayor,
    cleanup: () => {
      for (const socket of sockets) {
        disconnectSocket(socket);
      }
    },
  };
}

// ─── Codenames Setup ────────────────────────────────────────

export async function setupCodenamesGame(
  playerCount: number,
): Promise<CodenamesSetup> {
  const accounts = ALL_ACCOUNTS.slice(0, playerCount);

  const logins = await Promise.all(
    accounts.map((a) => apiLogin(a.email, a.password)),
  );

  const room = await apiCreateRoom(logins[0].access_token, "codenames");
  const roomDetails = await apiGetRoom(room.id, logins[0].access_token);

  const sockets = logins.map((l) => createSocketClient(l.access_token));
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
      board: CodenamesCard[];
      current_team: string;
      red_remaining: number;
      blue_remaining: number;
      players: CodenamesPlayerInfo[];
    }>(s, SOCKET_EVENTS.CODENAMES_GAME_STARTED, 15_000),
  );

  sockets[0].emit("start_codenames_game", {
    room_id: room.id,
    user_id: logins[0].user.id,
    word_pack_ids: null,
  });

  const gameStarts = await Promise.all(gameStartPromises);

  const players: CodenamesPlayer[] = accounts.map((account, i) => ({
    login: logins[i],
    socket: sockets[i],
    team: gameStarts[i].team,
    gameRole: gameStarts[i].role,
    board: gameStarts[i].board,
    account,
  }));

  return {
    players,
    gameId: gameStarts[0].game_id,
    roomId: room.id,
    roomPublicId: roomDetails.public_id,
    roomPassword: roomDetails.password,
    currentTeam: gameStarts[0].current_team,
    redRemaining: gameStarts[0].red_remaining,
    blueRemaining: gameStarts[0].blue_remaining,
    cleanup: () => {
      for (const socket of sockets) {
        disconnectSocket(socket);
      }
    },
  };
}

// ─── Voting Helper ──────────────────────────────────────────

export async function castVotes(
  players: UndercoverPlayer[],
  gameId: string,
  roomPublicId: string,
  voteMap: Record<string, string>,
  listenerSocket: Socket,
): Promise<{
  eliminated: { message: string; eliminated_player_role: string };
  gameOver: { data: string } | null;
}> {
  // Pre-register game_over listener so we don't miss it
  let gameOverData: { data: string } | null = null;
  const gameOverHandler = (data: { data: string }) => {
    gameOverData = data;
  };
  listenerSocket.on(SOCKET_EVENTS.GAME_OVER, gameOverHandler);

  const eliminatedPromise = waitForEvent<{
    message: string;
    eliminated_player_role: string;
  }>(listenerSocket, SOCKET_EVENTS.PLAYER_ELIMINATED, 15_000);

  // Cast votes with small delays
  for (const [voterId, votedForId] of Object.entries(voteMap)) {
    const voter = players.find((p) => p.login.user.id === voterId)!;
    voter.socket.emit("vote_for_a_player", {
      room_id: roomPublicId,
      game_id: gameId,
      user_id: voterId,
      voted_user_id: votedForId,
    });
    await new Promise((r) => setTimeout(r, 100));
  }

  const eliminated = await eliminatedPromise;

  // Give time for game_over to arrive (if applicable)
  await new Promise((r) => setTimeout(r, 500));
  listenerSocket.off(SOCKET_EVENTS.GAME_OVER, gameOverHandler);

  return { eliminated, gameOver: gameOverData };
}

// ─── New Turn Helper ────────────────────────────────────────

export async function startNewTurn(
  socket: Socket,
  roomId: string,
  gameId: string,
): Promise<{ message: string }> {
  const notifPromise = waitForEvent<{ message: string }>(
    socket,
    SOCKET_EVENTS.NOTIFICATION,
    10_000,
  );
  socket.emit("start_new_turn_event", {
    room_id: roomId,
    game_id: gameId,
  });
  return notifPromise;
}

// ─── Cleanup ────────────────────────────────────────────────

export function cleanupAll(sockets: Socket[]): void {
  for (const socket of sockets) {
    disconnectSocket(socket);
  }
}
