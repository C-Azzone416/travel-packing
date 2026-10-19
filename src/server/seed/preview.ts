// The preview deploy's seed step (#78). The sample trips belong to a real Better Auth user, and that user can only
// exist once the sign-up screens are deployed, so the very first preview run has no owner id yet. That run must still
// migrate and deploy, so a missing id is a visible, deliberate SKIP, never a failure and never a stand-in identity.
//
//   no PREVIEW_SEED_OWNER_ID   -> skip the seed, say so, exit 0 (bootstrap)
//   a real-looking owner id    -> seed that owner only (the normal guards still apply), exit 0
//   anything else              -> refuse with a clear message that never repeats the value, exit 1
//
// Only the preview job may get here: TARGET must be exactly "preview". Output is states and variable names only.

import { PRODUCTION_HOST_FORMAT, productionHost } from "../../tooling/deploy-env";
import { normalizeHost } from "./guard";
import { DEFAULT_OWNER_ID } from "./cli";

type Env = Record<string, string | undefined>;

export interface PreviewSeedDeps {
  /** Runs the real seed with this environment; resolves to an exit code. */
  seed(env: Env): Promise<number>;
  log(line: string): void;
  /** Appends to the workflow run's summary page (a no-op outside a workflow). */
  summary(line: string): void;
}

/** Better Auth ids are opaque tokens (nanoid- or uuid-shaped): letters, digits, "_" and "-", never an address. */
const OWNER_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export function isPlausibleOwnerId(value: string): boolean {
  return OWNER_ID_SHAPE.test(value) && value !== DEFAULT_OWNER_ID;
}

function hostOf(connectionString: string | undefined): string | null {
  try {
    return connectionString ? normalizeHost(new URL(connectionString).hostname) : null;
  } catch {
    return null;
  }
}

/** Returns the process exit code. */
export async function runPreviewSeed(env: Env, deps: PreviewSeedDeps): Promise<number> {
  const say = (line: string) => {
    deps.log(line);
    deps.summary(line);
  };
  const refuse = (reason: string) => {
    say(`preview seed refused: ${reason}`);
    return 1;
  };

  // Production (or anything that is not exactly the preview job) has no seed path at all, whatever else is set.
  if (env.TARGET !== "preview") return refuse("this is not a preview run (TARGET must be preview)");

  const owner = env.SEED_OWNER_ID?.trim() ?? "";
  if (owner === "") {
    say(
      "preview seed SKIPPED: PREVIEW_SEED_OWNER_ID is not set (first-preview bootstrap). The database was migrated and the app " +
        "deploys without sample data. After the owner signs up and verifies, set PREVIEW_SEED_OWNER_ID and re-run this workflow.",
    );
    return 0;
  }
  if (!isPlausibleOwnerId(owner)) {
    return refuse(
      "PREVIEW_SEED_OWNER_ID is not a Better Auth user id (copy the id of the verified preview owner)",
    );
  }

  // The seed's own guard checks the allowlist; this adds the one thing only the deploy knows: where production is.
  const production = productionHost(env.PRODUCTION_DB_HOST);
  if (production === "missing")
    return refuse("PRODUCTION_DB_HOST is not set, so the target cannot be checked");
  if (production === "invalid") return refuse(PRODUCTION_HOST_FORMAT);
  const target = hostOf(env.SEED_DATABASE_URL);
  if (target === null) return refuse("SEED_DATABASE_URL is not set or is not a connection URL");
  if (target === production) return refuse("the seed target is the production database host");

  const code = await deps.seed({ ...env, SEED_OWNER_ID: owner });
  if (code === 0) say("preview seed done: synthetic data loaded for the configured preview owner");
  return code;
}
