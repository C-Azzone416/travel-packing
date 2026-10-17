import { defineConfig } from "@playwright/test";
import { E2E_PASSWORD, OWNER_EMAIL } from "./tests/e2e/helpers/auth";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Synthetic, e2e-only sign-in; the server refuses this mode on any Vercel deployment.
    env: {
      // Compiles the e2e-only sign-in into THIS build only. Deployed builds never set it, so the code is absent.
      NEXT_PUBLIC_E2E_BUILD: "1",
      AUTH_E2E_FAKE: "1",
      AUTH_E2E_PASSWORD: E2E_PASSWORD,
      OWNER_EMAIL_ALLOWLIST: OWNER_EMAIL,
    },
  },
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
  ],
});
