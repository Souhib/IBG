import { disconnectRedis } from "./helpers/test-setup";

async function globalTeardown(): Promise<void> {
  await disconnectRedis();
  console.log("[E2E Teardown] Test suite complete.");
}

export default globalTeardown;
