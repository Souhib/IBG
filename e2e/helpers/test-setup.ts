import { execSync } from "child_process"
import { apiLeaveAllRooms, type LoginResponse } from "./api-client"

/**
 * Flush the E2E Redis database to remove stale game/room state between test files.
 */
export function flushRedis(): void {
  try {
    execSync("docker exec ibg-e2e-redis redis-cli FLUSHDB", {
      timeout: 5_000,
      stdio: "pipe",
    })
  } catch {
    // Redis might not be available — tests will still work
  }
}

/**
 * Ensure all accounts are in a clean state (not in any rooms) before a test.
 */
export async function ensureCleanState(
  accounts: { login: LoginResponse }[],
): Promise<void> {
  for (const account of accounts) {
    await apiLeaveAllRooms(account.login.user.id, account.login.access_token)
  }
}
