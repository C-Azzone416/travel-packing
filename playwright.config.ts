import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { ALLOWLISTED_EMAILS, E2E_PASSWORD, SEEDED_OWNER_IDS } from "./tests/e2e/helpers/auth";

// Ports are overridable so several worktrees (or agents) can run e2e on one machine. Servers are never reused:
// reusing whatever happens to be listening could silently test another checkout's code.
/** A TCP port from the environment: a whole number 1..65535, else the default (an empty or junk value must not become 0 or NaN). */
function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}
const PORT = portFrom(process.env.E2E_PORT, 3100);
const DB_PORT = portFrom(process.env.E2E_DB_PORT, 5433);
const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;

export default defineConfig({
  testDir: "tests/e2e",
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
