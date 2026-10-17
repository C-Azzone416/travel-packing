import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { ALLOWLISTED_EMAILS, E2E_PASSWORD, SEEDED_OWNER_IDS } from "./tests/e2e/helpers/auth";
import { E2E_DATABASE_URL, E2E_DB_PORT, portFrom } from "./tests/e2e/helpers/database";

// Ports are overridable so several worktrees (or agents) can run e2e on one machine. Servers are never reused:
// reusing whatever happens to be listening could silently test another checkout's code.
const PORT = portFrom(process.env.E2E_PORT, 3100);
const DB_PORT = E2E_DB_PORT;

export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the e2e database is a single PGlite instance, which serializes every connection, so parallel tests
  // queue behind each other and time out waiting for the dashboard. (CI already runs one worker.)
  workers: 1,
  webServer: [
    {
      // A real Postgres (PGlite behind the wire protocol), migrated and seeded with the synthetic sample set, in
      // memory so every run starts clean. Test use only; the script refuses production and Vercel.
      command: "npx tsx scripts/e2e-db-server.ts",
      port: DB_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_DB_PORT: String(DB_PORT), E2E_SEED_OWNERS: SEEDED_OWNER_IDS.join(",") },
    },
    {
      command: `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Synthetic, e2e-only sign-in and database driver; the server refuses both on any Vercel deployment.
      env: {
        // Compiles the e2e-only modules into THIS build only. Deployed builds never set it, so the code is absent.
        NEXT_PUBLIC_E2E_BUILD: "1",
        AUTH_E2E_FAKE: "1",
        AUTH_E2E_PASSWORD: E2E_PASSWORD,
        // Server-side session tokens for the fake sign-in (ignored by git via test-results/).
        AUTH_E2E_STATE_DIR: join(process.cwd(), "test-results", "e2e-sessions"),
        E2E_DATABASE_URL,
        OWNER_EMAIL_ALLOWLIST: ALLOWLISTED_EMAILS.join(","),
      },
    },
  ],
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
