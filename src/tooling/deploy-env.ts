// Checks the environment Vercel hands a deploy (the output of `vercel pull`) BEFORE anything is built or migrated.
// It reports variable NAMES only, never values: a value could be a connection string or a secret.

export type DeployTarget = "preview" | "production";
type Env = Record<string, string | undefined>;

/** Test-only switches. If any of these exist in a deployed environment, a build could ship the fake sign-in. */
export const FORBIDDEN_EVERYWHERE = [
  "NEXT_PUBLIC_E2E_BUILD",
  "AUTH_E2E_FAKE",
  "AUTH_E2E_PASSWORD",
  "AUTH_E2E_STATE_DIR",
  "E2E_DATABASE_URL",
  // The seed target is chosen per run in CI, never configured on a deployed app.
  "SEED_DATABASE_URL",
] as const;

export const REQUIRED = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "OWNER_EMAIL_ALLOWLIST",
] as const;

/** The location provider previews must use: a keyless, public API with no credentials to leak. */
export const PREVIEW_LOCATION_PROVIDER = "open-meteo";

function present(env: Env, name: string): boolean {
  return (env[name] ?? "").trim().length > 0;
}

/** A host in canonical form, or null when the value is not a URL. */
export function hostOf(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname
      .toLowerCase()
      .replace(/\.+$/, "")
      .replace(/-pooler(?=\.|$)/, "");
  } catch {
    return null;
  }
}

/**
 * Returns what is wrong with `env` for `target` (empty when it is fine). `productionDbHost` is the production
 * database's host name (not a secret), kept as a repository variable so previews can refuse it.
 */
export function checkDeployEnv(
  target: DeployTarget,
  env: Env,
  productionDbHost: string | undefined,
): string[] {
  const problems: string[] = [];
  for (const name of FORBIDDEN_EVERYWHERE) {
    if (present(env, name)) problems.push(`${name} must not be set in a ${target} environment`);
  }
  for (const name of REQUIRED) {
    if (!present(env, name)) problems.push(`${name} is not set`);
  }
  if (target === "preview") {
    if (env.LOCATION_PROVIDER?.trim() !== PREVIEW_LOCATION_PROVIDER) {
      problems.push(
        `LOCATION_PROVIDER must be ${PREVIEW_LOCATION_PROVIDER} in a preview environment`,
      );
    }
    const prodHost = hostOf(productionDbHost ? `postgres://${productionDbHost}/x` : undefined);
    if (!prodHost) {
      problems.push(
        "PRODUCTION_DB_HOST is not set, so a preview cannot prove it avoids production",
      );
    } else {
      for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
        if (hostOf(env[name]) === prodHost) {
          problems.push(
            `${name} points at the production database host; previews must use their own`,
          );
        }
      }
    }
  }
  return problems;
}

/** Minimal dotenv reader for the file `vercel pull` writes (KEY="value" lines, # comments). */
export function parseEnvFile(text: string): Env {
  const env: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}
