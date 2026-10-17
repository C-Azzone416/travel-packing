// Auth configuration from environment variable NAMES that already exist (.env.example). Missing or invalid
// configuration is reported by name only, never by value, and the app then denies everything (fail closed).

import { parseAllowlist, type Allowlist } from "./allowlist";

export interface AuthConfig {
  baseUrl: string;
  cookieSecret: string;
  allowlist: Allowlist;
}

export type AuthConfigResult = { ok: true; config: AuthConfig } | { ok: false; problems: string[] };

export const MIN_COOKIE_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function loadAuthConfig(env: Env): AuthConfigResult {
  const problems: string[] = [];
  const baseUrl = (env.NEON_AUTH_BASE_URL ?? "").trim();
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET ?? "";
  const allowlist = parseAllowlist(env.OWNER_EMAIL_ALLOWLIST);

  if (!baseUrl) problems.push("NEON_AUTH_BASE_URL is not set");
  else if (!isUrl(baseUrl)) problems.push("NEON_AUTH_BASE_URL is not a valid URL");
  if (!cookieSecret) problems.push("NEON_AUTH_COOKIE_SECRET is not set");
  else if (cookieSecret.length < MIN_COOKIE_SECRET_LENGTH)
    problems.push(`NEON_AUTH_COOKIE_SECRET is shorter than ${MIN_COOKIE_SECRET_LENGTH} characters`);
  if (allowlist.size === 0) problems.push("OWNER_EMAIL_ALLOWLIST has no entries");

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, config: { baseUrl, cookieSecret, allowlist } };
}
