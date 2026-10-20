// The app, started a second time on another port with LOCATION_PROVIDER=open-meteo and pointed at the
// fake geocoder (e2e only). It starts only once the first server is up: the first one owns `next build`,
// and this one just reuses that build, so there is no race with a half-written .next directory.
import { spawn } from "node:child_process";
import { join } from "node:path";

const FIRST = process.env.E2E_FIRST_URL ?? "http://localhost:3100/sign-in";
const PORT = process.env.E2E_SECOND_PORT ?? "3101";

async function firstServerReady() {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      if ((await fetch(FIRST)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the first e2e server never became ready");
}

await firstServerReady();
const child = spawn("npx", ["next", "start", "--port", PORT], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOCATION_PROVIDER: "open-meteo",
    OPEN_METEO_GEOCODING_URL: `http://127.0.0.1:${process.env.E2E_FAKE_GEO_PORT ?? 3102}/v1/search`,
    // Weather comes from the same local fake (never the real service). Only an e2e build honors these URLs.
    WEATHER_PROVIDER: "open-meteo",
    OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${process.env.E2E_FAKE_GEO_PORT ?? 3102}/v1/forecast`,
    OPEN_METEO_ARCHIVE_URL: `http://127.0.0.1:${process.env.E2E_FAKE_GEO_PORT ?? 3102}/v1/archive`,
    NEXT_PUBLIC_E2E_BUILD: "1",
    AUTH_E2E_STATE_DIR:
      process.env.AUTH_E2E_STATE_DIR ?? join(process.cwd(), "test-results", "e2e-sessions"),
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
