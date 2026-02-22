import { io, type Socket } from "socket.io-client";
import { API_URL, SOCKET_EVENTS } from "./constants";

/**
 * Create a raw Socket.IO client for protocol-level tests.
 * Uses the backend URL directly (not through nginx).
 */
export function createSocketClient(token: string): Socket {
  return io(API_URL, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: false,
  });
}

/**
 * Connect and wait for the connection to be established.
 */
export function connectSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Socket connection timeout"));
    }, 10_000);

    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.connect();
  });
}

/**
 * Wait for a specific socket event with a timeout.
 */
export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timeout waiting for socket event: ${event}`));
    }, timeoutMs);

    socket.once(event, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

/**
 * Emit an event and wait for a response event.
 */
export async function emitAndWait<T = unknown>(
  socket: Socket,
  emitEvent: string,
  data: unknown,
  waitEvent: string,
  timeoutMs = 10_000,
): Promise<T> {
  const promise = waitForEvent<T>(socket, waitEvent, timeoutMs);
  socket.emit(emitEvent, data);
  return promise;
}

/**
 * Join a room via socket and wait for room_status response.
 */
export async function socketJoinRoom(
  socket: Socket,
  userId: string,
  publicRoomId: string,
  password: string,
): Promise<unknown> {
  return emitAndWait(
    socket,
    "join_room",
    { user_id: userId, public_room_id: publicRoomId, password },
    SOCKET_EVENTS.ROOM_STATUS,
  );
}

/**
 * Clean up a socket connection.
 */
export function disconnectSocket(socket: Socket): void {
  if (socket.connected) {
    socket.disconnect();
  }
  socket.removeAllListeners();
}
