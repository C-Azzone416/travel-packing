// Usage: tsx scripts/check-migration-target.ts <preview|production>
// Reads DATABASE_URL_UNPOOLED (the secret the migrate and seed steps use) and PRODUCTION_DB_HOST from the environment.
// Prints a verdict only, never the connection string or host.

import { checkMigrationTarget, type DeployTarget } from "../src/tooling/deploy-env";

const target = process.argv[2];
if (target !== "preview" && target !== "production") {
  console.error("usage: check-migration-target <preview|production>");
  process.exit(2);
}
const problems = checkMigrationTarget(
  target as DeployTarget,
  process.env.DATABASE_URL_UNPOOLED,
  process.env.PRODUCTION_DB_HOST,
);
if (problems.length) {
  for (const problem of problems) console.error(`migration target: ${problem}`);
  process.exit(1);
}
console.log(`migration target: ok for ${target}`);
