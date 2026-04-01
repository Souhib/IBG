import { execSync } from "child_process";
import { waitForBackend, waitForFrontend } from "./helpers/api-client";
import { FRONTEND_URL } from "./helpers/constants";

const MAX_SEED_RETRIES = 3;
const RETRY_DELAY_MS = 3_000;

const DELETE_CMD =
  "docker exec -w /app majlisna-e2e-backend " +
  "env PYTHONPATH=/app python scripts/generate_fake_data.py --delete";

const SEED_CMD =
  "docker exec -w /app majlisna-e2e-backend " +
  "env PYTHONPATH=/app python scripts/generate_fake_data.py --create-db";

function sleep(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}

/**
 * Restart PgBouncer + backend to clear stale prepared statement caches.
 * PgBouncer in transaction mode caches prepared statements that reference
 * old OIDs after tables are dropped/recreated, causing asyncpg errors like
 * "could not resolve query result and/or argument types".
 */
function restartServicesAfterDDL(): void {
  console.log("[E2E Setup] Restarting PgBouncer + backend to clear stale connections...");
  execSync("docker restart majlisna-e2e-pgbouncer", { stdio: "inherit", timeout: 15_000 });
  execSync("docker restart majlisna-e2e-backend", { stdio: "inherit", timeout: 30_000 });
}

/**
 * Run delete + restart + seed as an atomic unit, retrying all on failure.
 *
 * After --delete drops/recreates tables, PgBouncer's prepared statement
 * cache is stale. We must restart PgBouncer and the backend before seeding.
 * If --create-db fails mid-way (partial data committed), --delete re-runs
 * to clean up before the next attempt.
 */
function seedDatabase(): void {
  for (let attempt = 1; attempt <= MAX_SEED_RETRIES; attempt++) {
    try {
      execSync(DELETE_CMD, { stdio: "inherit", timeout: 120_000 });
      restartServicesAfterDDL();
      waitForService("http://localhost:5049/health", 30_000);
      execSync(SEED_CMD, { stdio: "inherit", timeout: 120_000 });
      return;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_SEED_RETRIES) {
        console.log(
          `[E2E Setup] Seed failed (attempt ${attempt}/${MAX_SEED_RETRIES}): ${msg.split("\n")[0]}`,
        );
        console.log(`[E2E Setup] Retrying delete + seed in ${RETRY_DELAY_MS / 1000}s...`);
        sleep(RETRY_DELAY_MS);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Synchronously poll a health endpoint until it responds 200.
 */
function waitForService(url: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`curl -sf ${url} > /dev/null 2>&1`);
      return;
    } catch {
      sleep(1_000);
    }
  }
  throw new Error(`Service at ${url} did not become healthy within ${timeoutMs}ms`);
}

async function globalSetup(): Promise<void> {
  console.log("[E2E Setup] Waiting for backend to be healthy...");
  await waitForBackend();
  console.log("[E2E Setup] Backend is healthy.");

  console.log("[E2E Setup] Waiting for frontend to be reachable...");
  await waitForFrontend(FRONTEND_URL);
  console.log("[E2E Setup] Frontend is reachable.");

  // Terminate stale DB connections before dropping tables (prevents lock deadlocks)
  console.log("[E2E Setup] Terminating stale DB connections...");
  try {
    execSync(
      'docker exec majlisna-e2e-db psql -U majlisna -d majlisna -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"',
      { stdio: "inherit", timeout: 15_000 },
    );
  } catch {
    // Ignore — DB might not have stale connections
  }

  console.log("[E2E Setup] Resetting and seeding database via docker exec...");
  seedDatabase();
  console.log("[E2E Setup] Database seeded.");

  // Restart backend to ensure fresh DB connections after seeding
  console.log("[E2E Setup] Restarting backend to refresh DB connections...");
  execSync("docker restart majlisna-e2e-backend", {
    stdio: "inherit",
    timeout: 30_000,
  });
  await waitForBackend();
  console.log("[E2E Setup] Backend restarted and healthy.");
}

export default globalSetup;
