import { execSync } from "child_process";
import { waitForBackend, waitForFrontend } from "./helpers/api-client";
import { FRONTEND_URL } from "./helpers/constants";

async function globalSetup(): Promise<void> {
  console.log("[E2E Setup] Waiting for backend to be healthy...");
  await waitForBackend();
  console.log("[E2E Setup] Backend is healthy.");

  console.log("[E2E Setup] Waiting for frontend to be reachable...");
  await waitForFrontend(FRONTEND_URL);
  console.log("[E2E Setup] Frontend is reachable.");

  console.log("[E2E Setup] Resetting and seeding database via docker exec...");
  execSync(
    "docker exec -w /app ibg-e2e-backend " +
      "env PYTHONPATH=/app python scripts/generate_fake_data.py --delete",
    { stdio: "inherit", timeout: 60_000 },
  );
  execSync(
    "docker exec -w /app ibg-e2e-backend " +
      "env PYTHONPATH=/app python scripts/generate_fake_data.py --create-db",
    { stdio: "inherit", timeout: 120_000 },
  );
  console.log("[E2E Setup] Database seeded.");

  // Restart backend so connection pool picks up fresh enum type OIDs
  console.log("[E2E Setup] Restarting backend to refresh DB connections...");
  execSync("docker restart ibg-e2e-backend", {
    stdio: "inherit",
    timeout: 30_000,
  });
  await waitForBackend();
  console.log("[E2E Setup] Backend restarted and healthy.");
}

export default globalSetup;
