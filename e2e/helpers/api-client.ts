import { API_URL } from "./constants";

// ─── Types ──────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

export interface RegisterResponse {
  id: string;
  username: string;
  email_address: string;
}

export interface RoomResponse {
  id: string;
  public_id: string;
  owner_id: string;
  password: string;
  users: { id: string; username: string }[];
}

// ─── HTTP Helpers ───────────────────────────────────────────

async function postJSON<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function getJSON<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── Auth API ───────────────────────────────────────────────

export async function apiLogin(
  email: string,
  password: string,
): Promise<LoginResponse> {
  return postJSON<LoginResponse>("/api/v1/auth/login", { email, password });
}

export async function apiRegister(
  username: string,
  email: string,
  password: string,
): Promise<RegisterResponse> {
  return postJSON<RegisterResponse>("/api/v1/auth/register", {
    username,
    email_address: email,
    password,
  });
}

export async function apiRefreshToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(
    `${API_URL}/api/v1/auth/refresh?refresh_token=${encodeURIComponent(refreshToken)}`,
    { method: "POST" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── Room API ───────────────────────────────────────────────

export async function apiCreateRoom(
  token: string,
  gameType: "undercover" | "codenames" = "undercover",
): Promise<RoomResponse> {
  return postJSON<RoomResponse>(
    "/api/v1/rooms",
    { game_type: gameType },
    token,
  );
}

export async function apiGetRoom(
  roomId: string,
  token: string,
): Promise<RoomResponse> {
  return getJSON<RoomResponse>(`/api/v1/rooms/${roomId}`, token);
}

// ─── Health Checks ──────────────────────────────────────────

export async function waitForBackend(
  maxRetries = 60,
  delayMs = 2000,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // Connection refused, keep retrying
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Backend not healthy after ${maxRetries} retries`);
}

export async function waitForFrontend(
  frontendUrl: string,
  maxRetries = 60,
  delayMs = 2000,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(frontendUrl);
      if (res.ok) return;
    } catch {
      // Connection refused, keep retrying
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Frontend not reachable after ${maxRetries} retries`);
}
