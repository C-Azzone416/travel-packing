import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import {
  ALLOWLISTED_EMAILS,
  E2E_PASSWORD,
  SEEDED_OWNER_IDS,
  SETUP_COMPLETE_EMAILS,
} from "./tests/e2e/helpers/auth";
import { E2E_DATABASE_URL } from "./tests/e2e/helpers/database";
import { E2E_DB_PORT, FAKE_GEOCODER_PORT, OPEN_METEO_PORT, PORT } from "./tests/e2e/support/ports";

const e2eEnv = {
  // Compiles the e2e-only modules into THIS build only. Deployed builds never set it, so the code is absent.
  NEXT_PUBLIC_E2E_BUILD: "1",
  AUTH_E2E_FAKE: "1",
  AUTH_E2E_PASSWORD: E2E_PASSWORD,
  // Server-side session tokens for the fake sign-in (ignored by git via test-results/).
  AUTH_E2E_STATE_DIR: join(process.cwd(), "test-results", "e2e-sessions"),
  // The app reads and writes a real Postgres (the PGlite socket server below), not a stand-in.
  E2E_DATABASE_URL,
  OWNER_EMAIL_ALLOWLIST: ALLOWLISTED_EMAILS.join(","),
  // Many tests search at once as the same owner; production keeps the default of 20 a minute.
  LOCATION_SEARCHES_PER_MINUTE: "1000",
  // Every e2e test signs in as one of a few owners from one address; production keeps the default of 10 per 15 minutes.
  SIGN_IN_ATTEMPTS_PER_15_MIN: "10000",
  // The account screens wait out a floor so an allowed and an unlisted address take the same time (#27); tests skip it.
  AUTH_FLOW_MIN_MS: "0",
  // Every e2e test signs up from one address; production keeps the default of 10 sign-ups an hour per caller.
  AUTH_FLOW_CALLERS_PER_HOUR: "10000",
};

// CI builds the e2e variant once (the `e2e-build` job) and hands it to each browser job, which sets E2E_PREBUILT=1 to start
// that build instead of making another. Locally nothing sets it, so the app is built from your checkout as before.
const prebuilt = process.env.E2E_PREBUILT === "1";

// Servers are never reused: reusing whatever happens to be listening could silently test another checkout's code.
export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the e2e database is a single PGlite instance, which serializes every connection, so parallel tests
  // queue behind each other and time out waiting for the dashboard. (CI already runs one worker.)
  workers: 1,
  // CI prints every test with its duration (`list`) and annotates failures on the PR (`github`); the default `dot` hid
  // both. A failed attempt keeps its trace (uploaded with the report) so a flaky test can be diagnosed, not guessed at.
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  webServer: [
    {
      // A real Postgres (PGlite behind the wire protocol), migrated and seeded with the synthetic sample set, in
      // memory so every run starts clean. Test use only; the script refuses production and Vercel.
      command: "npx tsx scripts/e2e-db-server.ts",
      port: E2E_DB_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        E2E_DB_PORT: String(E2E_DB_PORT),
        E2E_SEED_OWNERS: SEEDED_OWNER_IDS.join(","),
        E2E_SETUP_EMAILS: SETUP_COMPLETE_EMAILS.join(","),
        // Keys the setup records the same way the app does in an e2e build (its sign-in password).
        E2E_SETUP_SECRET: E2E_PASSWORD,
      },
    },
    {
      command: prebuilt
        ? `npm run start -- --port ${PORT}`
        : `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Synthetic, e2e-only sign-in and database driver; the server refuses both on any Vercel deployment.
      env: e2eEnv,
    },
    // A local stand-in for Open-Meteo's geocoder, and a second copy of the app in Open-Meteo mode that talks
    // to it (tests/e2e/support). No real network is used.
    {
      command: "node tests/e2e/support/fake-open-meteo.mjs",
      url: `http://127.0.0.1:${FAKE_GEOCODER_PORT}/health`,
      reuseExistingServer: false,
      env: { E2E_FAKE_GEO_PORT: String(FAKE_GEOCODER_PORT) },
    },
    {
      command: "node tests/e2e/support/second-server.mjs",
      url: `http://localhost:${OPEN_METEO_PORT}/sign-in`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        ...e2eEnv,
        E2E_FIRST_URL: `http://localhost:${PORT}/sign-in`,
        E2E_SECOND_PORT: String(OPEN_METEO_PORT),
        E2E_FAKE_GEO_PORT: String(FAKE_GEOCODER_PORT),
      },
    },
  ],
  use: { baseURL: `http://localhost:${PORT}`, trace: process.env.CI ? "retain-on-failure" : "off" },
  projects: [
    // A real phone: Playwright's iPhone 15 profile (WebKit, mobile user agent, touch, 3x pixel ratio, the Safari viewport).
    // It runs ONLY the specs tagged @device (tests/e2e/helpers/device.ts): the ones whose outcome depends on the device
    // (layout, tap targets, overflow, navigation, sheets, accessibility at phone size, the golden path). The app's logic
    // and data flows are the same on every device, so they run once, on desktop.
    // WebKit on a shared CI runner is slower than Chromium, so a phone test gets 60 s instead of 30 s (assertion timeouts
    // are unchanged) and one retry in CI. A test that passes only on retry is reported as "flaky": file or fix it (docs/e2e.md).
    {
      name: "phone",
      grep: /@device/,
      timeout: 60_000,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices["iPhone 15"] },
    },
    // Every test, in Chromium at a desktop size.
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
