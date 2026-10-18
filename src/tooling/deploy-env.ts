// Checks the environment Vercel hands a deploy (the output of `vercel pull`) BEFORE anything is built or migrated.
// It reports variable NAMES only, never values: a value could be a connection string or a secret.

export type DeployTarget = "preview" | "production";
type Env = Record<string, string | undefined>;

/** Test-only switches. If any of these exist in a deployed environment, a build could ship the fake sign-in. */
export const FORBIDDEN_EVERYWHERE = [
  "NEXT_PUBLIC_E2E_BUILD",
  "E2E_DATABASE_URL",
  // The seed target is chosen per run in CI, never configured on a deployed app.
  "SEED_DATABASE_URL",
  // Lets the location search be pointed at another server; for e2e only.
  "OPEN_METEO_GEOCODING_URL",
] as const;

/** Every variable the fake sign-in family reads starts with this; none may exist in a deployed environment. */
export const FORBIDDEN_PREFIXES = ["AUTH_E2E_"] as const;

/** Same minimum the auth config enforces at runtime (src/server/auth/config.ts). */
export const MIN_COOKIE_SECRET_LENGTH = 32;

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

export const PRODUCTION_HOST_FORMAT =
  "PRODUCTION_DB_HOST must be a bare host name (no scheme, user, port or path)";

const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/i;

/** The production host in canonical form, "missing" when unset, "invalid" when it is not a bare host name. */
export function productionHost(value: string | undefined): string | "missing" | "invalid" {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "missing";
  if (!BARE_HOST.test(trimmed)) return "invalid";
  return hostOf(`postgres://${trimmed}/x`) ?? "invalid";
}

/**
 * The database a migration or seed is about to write must be the right one for the run: in a preview it must NOT be
 * production's host, in a production run it MUST be. Checked on the secret the steps actually use (the GitHub
 * environment's DATABASE_URL_UNPOOLED), which `vercel pull` knows nothing about. Names only in the messages.
 */
export function checkMigrationTarget(
  target: DeployTarget,
  databaseUrl: string | undefined,
  productionDbHost: string | undefined,
): string[] {
  const prod = productionHost(productionDbHost);
  if (prod === "missing")
    return ["PRODUCTION_DB_HOST is not set, so the database target cannot be checked"];
  if (prod === "invalid") return [PRODUCTION_HOST_FORMAT];
  const host = hostOf(databaseUrl);
  if (!host) return ["DATABASE_URL_UNPOOLED is not set or is not a connection URL"];
  if (target === "preview" && host === prod) {
    return [
      "DATABASE_URL_UNPOOLED points at the production database host; a preview must not migrate or seed it",
    ];
  }
  if (target === "production" && host !== prod) {
    return [
      "DATABASE_URL_UNPOOLED does not point at PRODUCTION_DB_HOST; production must migrate its own database",
    ];
  }
  return [];
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
  for (const prefix of FORBIDDEN_PREFIXES) {
    for (const name of Object.keys(env).sort()) {
      if (name.startsWith(prefix) && present(env, name)) {
        problems.push(`${name} must not be set in a ${target} environment`);
      }
    }
  }
  for (const name of REQUIRED) {
    if (!present(env, name)) problems.push(`${name} is not set`);
  }
  const secret = env.NEON_AUTH_COOKIE_SECRET;
  if (present(env, "NEON_AUTH_COOKIE_SECRET") && (secret ?? "").length < MIN_COOKIE_SECRET_LENGTH) {
    problems.push(
      `NEON_AUTH_COOKIE_SECRET is shorter than ${MIN_COOKIE_SECRET_LENGTH} characters, so sign-in would not work`,
    );
  }
  // Production may leave the provider unset (search off) or use the real one; any other value is a mistake.
  const provider = env.LOCATION_PROVIDER?.trim();
  if (target === "production" && provider && provider !== PREVIEW_LOCATION_PROVIDER) {
    problems.push(`LOCATION_PROVIDER, when set, must be ${PREVIEW_LOCATION_PROVIDER}`);
  }
  if (target === "preview") {
    if (provider !== PREVIEW_LOCATION_PROVIDER) {
      problems.push(
        `LOCATION_PROVIDER must be ${PREVIEW_LOCATION_PROVIDER} in a preview environment`,
      );
    }
    const prodHost = productionHost(productionDbHost);
    if (prodHost === "missing") {
      problems.push(
        "PRODUCTION_DB_HOST is not set, so a preview cannot prove it avoids production",
      );
    } else if (prodHost === "invalid") {
      problems.push(PRODUCTION_HOST_FORMAT);
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
  if (target === "production") {
    // Production proves it is looking at ITS database: both connection strings must be on PRODUCTION_DB_HOST.
    const prodHost = productionHost(productionDbHost);
    if (prodHost === "missing") {
      problems.push("PRODUCTION_DB_HOST is not set, so production cannot confirm its database");
    } else if (prodHost === "invalid") {
      problems.push(PRODUCTION_HOST_FORMAT);
    } else {
      for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
        if (present(env, name) && hostOf(env[name]) !== prodHost) {
          problems.push(
            `${name} does not point at PRODUCTION_DB_HOST; production must use its own database`,
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
