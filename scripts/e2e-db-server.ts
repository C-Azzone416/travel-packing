// Starts the e2e database (PGlite behind the Postgres wire protocol, migrated and seeded) for Playwright's webServer.
// E2E_DB_PORT picks the port (default 5433). It runs until it is stopped. Test use only.

import { startE2eDbServer } from "../src/server/db/e2e-db-server";
import { utcDate } from "../src/server/seed/run-date";

const port = Number(process.env.E2E_DB_PORT ?? 5433);
// The owners the fake sign-in produces ("e2e-" + email), so the seeded sample trips belong to the e2e owner.
const owners = (process.env.E2E_SEED_OWNERS ?? "e2e-owner@example.test")
  .split(",")
  .map((owner) => owner.trim());

// The addresses whose password counts as set through a link, so the seeded owners can sign in (#83). Newcomers are not
// listed: they become set up only by using a link, as in production.
const setupEmails = (process.env.E2E_SETUP_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);

startE2eDbServer({
  port,
  seedOwners: owners,
  setupEmails,
  setupSecret: process.env.E2E_SETUP_SECRET ?? "",
  // Relative to the real date, so the first test against a freshly started database sees San Diego as upcoming (#278).
  today: utcDate(),
})
  .then((server) => {
    console.log(`e2e database ready on port ${server.port}`);
    const stop = () => void server.stop().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e database failed to start");
    process.exit(1);
  });
