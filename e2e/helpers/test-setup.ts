import { randomUUID } from "crypto"
import { apiRegister, apiLeaveAllRooms, type LoginResponse } from "./api-client"

// ─── Dynamic Test Accounts ─────────────────────────────────

interface TestAccount {
  email: string;
  password: string;
}

/**
 * Register N fresh test accounts with unique emails/usernames.
 * Returns account credentials that can be passed to setupRoomWithPlayers.
 */
export async function generateTestAccounts(count: number): Promise<TestAccount[]> {
  const password = "testpass1";
  const accounts: TestAccount[] = [];

  await Promise.all(
    Array.from({ length: count }, async () => {
      const id = randomUUID().slice(0, 8);
      const email = `e2e-${id}@test.com`;
      const username = `e2e-${id}`;
      await apiRegister(username, email, password);
      accounts.push({ email, password });
    }),
  );

  return accounts;
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
