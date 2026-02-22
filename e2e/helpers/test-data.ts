import { apiRegister, apiLogin, type LoginResponse } from "./api-client";

let userCounter = 0;

function uniqueEmail(prefix: string): string {
  const ts = Date.now();
  return `${prefix}-${ts}-${++userCounter}@e2e-test.com`;
}

/**
 * Create a new test user via API and return credentials + login tokens.
 */
export async function createTestUser(overrides?: {
  username?: string;
  email?: string;
  password?: string;
}): Promise<{
  email: string;
  password: string;
  userId: string;
  username: string;
  tokens: LoginResponse;
}> {
  const email = overrides?.email || uniqueEmail("e2e-user");
  const password = overrides?.password || "TestPass123!";
  const username = overrides?.username || `e2e_user_${Date.now()}_${++userCounter}`;

  // Register the user
  const registered = await apiRegister(username, email, password);

  // Login to get tokens
  const tokens = await apiLogin(email, password);

  return {
    email,
    password,
    userId: registered.id,
    username,
    tokens,
  };
}
