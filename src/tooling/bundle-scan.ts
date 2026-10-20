// Scans what the browser can download (the client bundle) for secrets and server-only code (#22). Pure so a test can
// inject a fake secret and prove the scan fails; scripts/check-client-bundle.ts runs it on `.next/static`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Environment variables that must never be named in client code: their names mean a server secret leaked in. */
export const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_AUTH_COOKIE_SECRET",
  "NEON_AUTH_BASE_URL",
  "OWNER_EMAIL_ALLOWLIST",
  "SEED_DATABASE_URL",
  "SEED_ALLOWED_HOSTS",
  "SEED_OWNER_ID",
  "VERCEL_TOKEN",
  "AUTH_E2E_PASSWORD",
  "E2E_DATABASE_URL",
  "OPEN_METEO_GEOCODING_URL",
  "LOCATION_PROVIDER",
  "WEATHER_PROVIDER",
  "OPEN_METEO_FORECAST_URL",
  "OPEN_METEO_ARCHIVE_URL",
] as const;

/** Shapes of secret VALUES (a connection string with a password, a private key, common token prefixes). */
export const SECRET_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "a database URL with credentials",
    pattern: /postgres(?:ql)?:\/\/[^\s"'/:@]+:[^\s"'/@]+@/,
  },
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "an AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "a Stripe-style secret key", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
];

/** Strings unique to server-only modules (each must stay in src/server); a hit means server code reached the browser. */
export const SERVER_ONLY_MARKERS: readonly { name: string; text: string; source: string }[] = [
  {
    name: "the migration runner",
    text: "createMigrationConnection",
    source: "src/server/db/neon.ts",
  },
  { name: "the data-layer runtime", text: "getDataContext", source: "src/server/data/runtime.ts" },
  { name: "the owner gate", text: "authorizeOwner", source: "src/server/auth/guard.ts" },
  {
    name: "the weather provider",
    text: "createOpenMeteoWeatherProvider",
    source: "src/server/weather/open-meteo.ts",
  },
  { name: "the seed guard", text: "assertSeedAllowed", source: "src/server/seed/guard.ts" },
];

export interface ScanFile {
  path: string;
  text: string;
}

export interface Finding {
  path: string;
  problem: string;
}

/** Findings never include the matched text itself: a leaked secret must not be copied into a CI log. */
export function scanFiles(files: readonly ScanFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const { path, text } of files) {
    for (const name of SECRET_ENV_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(text)) {
        findings.push({ path, problem: `names the server secret ${name}` });
      }
    }
    for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
      if (pattern.test(text)) findings.push({ path, problem: `contains ${name}` });
    }
    for (const marker of SERVER_ONLY_MARKERS) {
      if (text.includes(marker.text)) {
        findings.push({ path, problem: `contains server-only code (${marker.name})` });
      }
    }
  }
  return findings;
}

const TEXT_FILE = /\.(?:js|mjs|cjs|css|html|json|map|txt)$/;

export function readBundle(dir: string): ScanFile[] {
  const out: ScanFile[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (TEXT_FILE.test(name)) out.push({ path, text: readFileSync(path, "utf8") });
    }
  };
  walk(dir);
  return out;
}

export function scanDirectory(dir: string): Finding[] {
  return scanFiles(readBundle(dir));
}
