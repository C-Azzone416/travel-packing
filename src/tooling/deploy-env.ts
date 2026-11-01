// Checks the environment Vercel hands a deploy (the output of `vercel pull`) BEFORE anything is built or migrated.
// It reports variable NAMES only, never values: a value could be a connection string or a secret.

import { isPlainEmail } from "../server/auth/allowlist";
import { screenshotEnvProblems } from "./feedback-screenshots";

export type DeployTarget = "preview" | "production";
type Env = Record<string, string | undefined>;

export const PACKAGE_AUTH_VARIABLES = [
  "NODE_AUTH_TOKEN",
  "NPM_AUTH_TOKEN",
  "NPM_TOKEN",
  "FRAMEBRIAR_PACKAGES_TOKEN",
] as const;

/** Test-only switches. If any of these exist in a deployed environment, a build could ship the fake sign-in. */
export const FORBIDDEN_EVERYWHERE = [
  "NEXT_PUBLIC_E2E_BUILD",
  "E2E_DATABASE_URL",
  "E2E_FRAMEBRIAR_PORT",
  // The seed target is chosen per run in CI, never configured on a deployed app.
  "SEED_DATABASE_URL",
  // Lets the location search be pointed at another server; for e2e only.
  "OPEN_METEO_GEOCODING_URL",
  // Package credentials belong only to the dedicated dependency-fetch step. If Vercel has any of these configured,
  // its builder and the application compiler would inherit them.
  ...PACKAGE_AUTH_VARIABLES,
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

export type AccountClosureMode = "disabled" | "enabled";

/** The exact runtime switch translated to the non-secret mode the smoke test must prove. */
export function accountClosureMode(env: Env): AccountClosureMode {
  return env.CLOSE_ACCOUNT_ENABLED === "1" ? "enabled" : "disabled";
}

/**
 * What `vercel pull` writes for a Vercel Secret, whose value it cannot read (it is write-only): the literal text below,
 * 11 characters. A build or check that carried on with it would be using a placeholder as a real value.
 */
export const REDACTION_MARKER = "[SENSITIVE]";

function isRedacted(value: string | undefined): boolean {
  return (value ?? "").toLowerCase().includes(REDACTION_MARKER.toLowerCase());
}

/** A connection URL the database driver can use: postgres:// or postgresql:// with a host. */
export function isPostgresUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Null when the allowlist is a non-empty, comma-separated list of well-formed emails (no blank entries). */
export function allowlistProblem(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return "is empty";
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry === "")) return "has an empty entry (check the commas)";
  if (entries.some((entry) => !isPlainEmail(entry)))
    return "has an entry that is not a well-formed email address";
  return null;
}

function present(env: Env, name: string): boolean {
  return (env[name] ?? "").trim().length > 0;
}

/** Package credentials must be absent from the application compiler and every child process it launches. */
export function packageCredentialProblems(env: Env): string[] {
  return PACKAGE_AUTH_VARIABLES.filter((name) => present(env, name)).map(
    (name) => `${name} must not be present during the application build`,
  );
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
 * database's host name (not a credential), kept as a repository secret (masked in logs) so previews can refuse it.
 */
export function checkDeployEnv(
  target: DeployTarget,
  env: Env,
  productionDbHost: string | undefined,
): string[] {
  const problems: string[] = [];
  const closeAccount = env.CLOSE_ACCOUNT_ENABLED?.trim();
  if (closeAccount && closeAccount !== "1") {
    problems.push("CLOSE_ACCOUNT_ENABLED must be unset or the exact value 1");
  }
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
  // A Vercel Secret that `vercel pull` could not read arrives as the redaction marker. Both targets inject the real
  // GitHub-environment value before this check; any remaining marker is a hard failure.
  const redacted = new Set<string>();
  for (const name of REQUIRED) {
    if (!present(env, name)) problems.push(`${name} is not set`);
    else if (isRedacted(env[name])) {
      redacted.add(name);
      problems.push(
        `${name} is Vercel's redaction marker (a Secret that vercel pull cannot read); the real value must be injected first`,
      );
    }
  }
  const secret = env.NEON_AUTH_COOKIE_SECRET;
  if (
    present(env, "NEON_AUTH_COOKIE_SECRET") &&
    !redacted.has("NEON_AUTH_COOKIE_SECRET") &&
    (secret ?? "").length < MIN_COOKIE_SECRET_LENGTH
  ) {
    problems.push(
      `NEON_AUTH_COOKIE_SECRET is shorter than ${MIN_COOKIE_SECRET_LENGTH} characters, so sign-in would not work`,
    );
  }
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    if (present(env, name) && !redacted.has(name) && !isPostgresUrl(env[name])) {
      problems.push(`${name} is not a Postgres connection URL`);
    }
  }
  if (present(env, "OWNER_EMAIL_ALLOWLIST") && !redacted.has("OWNER_EMAIL_ALLOWLIST")) {
    const problem = allowlistProblem(env.OWNER_EMAIL_ALLOWLIST);
    if (problem) problems.push(`OWNER_EMAIL_ALLOWLIST ${problem}`);
  }
  // Production never captures screenshots (#130): FEEDBACK_SCREENSHOTS must be unset or 0 there.
  problems.push(...screenshotEnvProblems(target, env));
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
    if (closeAccount === "1") {
      problems.push("CLOSE_ACCOUNT_ENABLED must not be enabled in production");
    }
    // Production proves it is looking at ITS database: both connection strings must be on PRODUCTION_DB_HOST.
    const prodHost = productionHost(productionDbHost);
    if (prodHost === "missing") {
      problems.push("PRODUCTION_DB_HOST is not set, so production cannot confirm its database");
    } else if (prodHost === "invalid") {
      problems.push(PRODUCTION_HOST_FORMAT);
    } else {
      for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
        if (
          present(env, name) &&
          !redacted.has(name) &&
          isPostgresUrl(env[name]) &&
          hostOf(env[name]) !== prodHost
        ) {
          problems.push(
            `${name} does not point at PRODUCTION_DB_HOST; production must use its own database`,
          );
        }
      }
    }
  }
  return problems;
}

/** Minimal dotenv reader retained for focused parser tests and utilities that need `export KEY=...` support. */
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

/**
 * Reads the file `vercel pull` writes exactly the way `vercel build` does. Vercel CLI 64.5.0 loads it with
 * dotenv 4.0.0 (a line-by-line KEY=value reader). In particular a double-quoted value turns the two characters `\n` into
 * a newline, one quote is stripped from each end, the result is trimmed, and `export KEY=...` and `#` comment lines are
 * not assignments. Checking what the build will actually see is the point, so keep this in step with the pinned CLI.
 */
export function parseBuildEnvFile(text: string): Env {
  const env: Env = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? "";
    if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
      value = value.replace(/\\n/g, "\n");
    }
    env[match[1]] = value.replace(/(^['"]|['"]$)/g, "").trim();
  }
  return env;
}
