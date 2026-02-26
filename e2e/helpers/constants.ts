export const API_URL = process.env.API_URL || "http://localhost:5049";
export const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3049";

// ─── Pool-based Account Selection ───────────────────────────

const isPoolB = process.env.TEST_POOL === "B";

// ─── Test Accounts (seeded by generate_fake_data.py) ───────

export const TEST_ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "admin@test.com",
  password: process.env.TEST_ADMIN_PASSWORD || "admin123",
} as const;

export const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || (isPoolB ? "user_b@test.com" : "user@test.com"),
  password: process.env.TEST_USER_PASSWORD || "user1234",
} as const;

export const TEST_PLAYER = {
  email: process.env.TEST_PLAYER_EMAIL || (isPoolB ? "player_b@test.com" : "player@test.com"),
  password: process.env.TEST_PLAYER_PASSWORD || "player123",
} as const;

export const TEST_ALI = {
  email: process.env.TEST_ALI_EMAIL || (isPoolB ? "ali_b@test.com" : "ali@test.com"),
  password: process.env.TEST_ALI_PASSWORD || "ali12345",
} as const;

export const TEST_FATIMA = {
  email: process.env.TEST_FATIMA_EMAIL || (isPoolB ? "fatima_b@test.com" : "fatima@test.com"),
  password: process.env.TEST_FATIMA_PASSWORD || "fatima12",
} as const;

export const TEST_OMAR = {
  email: process.env.TEST_OMAR_EMAIL || (isPoolB ? "omar_b@test.com" : "omar@test.com"),
  password: process.env.TEST_OMAR_PASSWORD || "omar1234",
} as const;

export const TEST_AISHA = {
  email: process.env.TEST_AISHA_EMAIL || (isPoolB ? "aisha_b@test.com" : "aisha@test.com"),
  password: process.env.TEST_AISHA_PASSWORD || "aisha123",
} as const;

export const TEST_YUSUF = {
  email: process.env.TEST_YUSUF_EMAIL || "yusuf@test.com",
  password: process.env.TEST_YUSUF_PASSWORD || "yusuf123",
} as const;

export const TEST_MARYAM = {
  email: process.env.TEST_MARYAM_EMAIL || "maryam@test.com",
  password: process.env.TEST_MARYAM_PASSWORD || "maryam12",
} as const;

export const TEST_HAMZA = {
  email: process.env.TEST_HAMZA_EMAIL || "hamza@test.com",
  password: process.env.TEST_HAMZA_PASSWORD || "hamza123",
} as const;

/** All pre-seeded test accounts for easy iteration */
export const ALL_TEST_ACCOUNTS = [
  TEST_ADMIN,
  TEST_USER,
  TEST_PLAYER,
  TEST_ALI,
  TEST_FATIMA,
  TEST_OMAR,
  TEST_AISHA,
  TEST_YUSUF,
  TEST_MARYAM,
  TEST_HAMZA,
] as const;

// ─── localStorage Keys (must match front/src/lib/auth.ts) ──

export const STORAGE_KEYS = {
  token: "ibg-token",
  refreshToken: "ibg-refresh-token",
  tokenExpiry: "ibg-token-expiry",
  userData: "ibg-user-data",
} as const;

// ─── Frontend Routes ────────────────────────────────────────

export const ROUTES = {
  home: "/",
  login: "/auth/login",
  register: "/auth/register",
  rooms: "/rooms",
  createRoom: "/rooms/create",
  room: (id: string) => `/rooms/${id}`,
  undercoverGame: (id: string) => `/game/undercover/${id}`,
  codenamesGame: (id: string) => `/game/codenames/${id}`,
  profile: "/profile",
  leaderboard: "/leaderboard",
} as const;

// ─── Socket.IO Event Names ─────────────────────────────────

export const SOCKET_EVENTS = {
  // Room events
  ROOM_STATUS: "room_status",
  NEW_USER_JOINED: "new_user_joined",
  USER_LEFT: "user_left",
  ERROR: "error",

  // Connection events
  PLAYER_DISCONNECTED: "player_disconnected",
  PLAYER_RECONNECTED: "player_reconnected",
  PLAYER_LEFT_PERMANENTLY: "player_left_permanently",
  OWNER_CHANGED: "owner_changed",

  // Undercover events
  ROLE_ASSIGNED: "role_assigned",
  GAME_STARTED: "game_started",
  VOTE_CASTED: "vote_casted",
  PLAYER_ELIMINATED: "player_eliminated",
  GAME_OVER: "game_over",
  GAME_CANCELLED: "game_cancelled",
  UNDERCOVER_GAME_STATE: "undercover_game_state",
  YOU_DIED: "you_died",
  NOTIFICATION: "notification",
  WAITING_OTHER_VOTES: "waiting_other_votes",

  // Codenames events
  CODENAMES_GAME_STARTED: "codenames_game_started",
  CODENAMES_CLUE_GIVEN: "codenames_clue_given",
  CODENAMES_CARD_REVEALED: "codenames_card_revealed",
  CODENAMES_TURN_ENDED: "codenames_turn_ended",
  CODENAMES_GAME_OVER: "codenames_game_over",
} as const;
