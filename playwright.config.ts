import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { E2E_PASSWORD, OWNER_EMAIL } from "./tests/e2e/helpers/auth";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT, PORT } from "./tests/e2e/support/ports";

const e2eEnv = {
  // Compiles the e2e-only sign-in into THIS build only. Deployed builds never set it, so the code is absent.
  NEXT_PUBLIC_E2E_BUILD: "1",
  AUTH_E2E_FAKE: "1",
  AUTH_E2E_PASSWORD: E2E_PASSWORD,
  // Server-side session tokens for the fake sign-in (ignored by git via test-results/).
  AUTH_E2E_STATE_DIR: join(process.cwd(), "test-results", "e2e-sessions"),
  OWNER_EMAIL_ALLOWLIST: OWNER_EMAIL,
  // Many tests search at once as the same owner; production keeps the default of 20 a minute.
  LOCATION_SEARCHES_PER_MINUTE: "1000",
};

// Servers are never reused: reusing whatever happens to be listening could silently test another checkout's code.
export default defineConfig({
  testDir: "tests/e2e",
  webServer: [
    {
      command: `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Synthetic, e2e-only sign-in; the server refuses this mode on any Vercel deployment.
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
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
