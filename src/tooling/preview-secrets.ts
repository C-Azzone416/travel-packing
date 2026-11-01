// `vercel pull` cannot read a Vercel Secret (write-only), so it writes the redaction marker in its place. The four
// Secrets below are therefore injected, right after the pull and before the check and build, from the selected GitHub
// environment's secrets. Nothing here ever returns, logs or throws a value: every message names the variable alone.

import { parseKeyRing } from "../server/feedback/key-ring";
import { parseBuildEnvFile } from "./deploy-env";

type Env = Record<string, string | undefined>;

/** Exactly the variables stored as Vercel Secrets that the build consumes. Nothing else in the file is touched. */
export const INJECTED_SECRETS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "OWNER_EMAIL_ALLOWLIST",
  "NEON_AUTH_COOKIE_SECRET",
] as const;

export type InjectionResult = { ok: true; text: string } | { ok: false; problems: string[] };

/**
 * `vercel build` reads the file with dotenv 4.0.0 (see parseBuildEnvFile): one assignment per line, and inside double quotes
 * the two characters `\n` mean a newline. So a value is written as KEY="value" with each real newline written as `\n`;
 * `"`, `\`, `$` and `#` need no escaping there (that reader neither expands `$` nor treats `#` as a comment, and strips a
 * single quote from each end only). Some values cannot be represented at all, and are refused instead of written wrong.
 */
function unwritable(value: string): string | null {
  if (value !== value.trim()) return "has leading or trailing whitespace";
  // A real carriage return, NUL or line/paragraph separator breaks the one-line-per-assignment reader.
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 13 || code === 0 || code === 0x2028 || code === 0x2029) {
      return "contains a character that cannot be written to the file";
    }
  }
  // The reader turns a literal backslash followed by n into a newline, so such a value would be silently changed.
  if (value.includes("\\n"))
    return "contains a backslash followed by n, which the build's reader would change";
  return null;
}

export function formatEnvLine(name: string, value: string): string {
  return `${name}="${value.replace(/\n/g, "\\n")}"`;
}

/**
 * Replaces the INJECTED_SECRETS entries of a pulled env file with the given values (first occurrence in place, later
 * duplicates dropped, absent ones appended); every other line is kept byte for byte. Fails closed, naming only the
 * variable, if any value is missing, empty, or cannot be written faithfully.
 */
export function injectSecrets(fileText: string, secrets: Env): InjectionResult {
  const problems: string[] = [];
  for (const name of INJECTED_SECRETS) {
    const value = secrets[name];
    if (value === undefined || value.trim() === "") problems.push(`${name} is missing or empty`);
    else {
      const reason = unwritable(value);
      if (reason) problems.push(`${name} ${reason}`);
    }
  }
  if (problems.length) return { ok: false, problems };

  const eol = fileText.includes("\r\n") ? "\r\n" : "\n";
  const written = new Set<string>();
  const kept: string[] = [];
  for (const line of fileText.split(/\r?\n/)) {
    const name = INJECTED_SECRETS.find((candidate) => assigns(line, candidate));
    if (!name) {
      kept.push(line);
    } else if (!written.has(name)) {
      written.add(name);
      kept.push(formatEnvLine(name, secrets[name] as string));
    }
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  for (const name of INJECTED_SECRETS) {
    if (!written.has(name)) kept.push(formatEnvLine(name, secrets[name] as string));
  }
  return { ok: true, text: `${kept.join(eol)}${eol}` };
}

/** Does this line assign `name`, the way the build's reader sees it? */
function assigns(line: string, name: string): boolean {
  return new RegExp(`^\\s*${name}\\s*=`).test(line);
}

/** What the build's reader will see for the injected names, to prove the file round-trips (used by tests and the script). */
export function readBack(text: string): Env {
  const parsed = parseBuildEnvFile(text);
  return Object.fromEntries(INJECTED_SECRETS.map((name) => [name, parsed[name]]));
}

/** The Preview-only secret that seals server-held Framebriar credentials (#259). Optional: the deploy never depends on it. */
export const FRAMEBRIAR_KEYS_SECRET = "FRAMEBRIAR_CREDENTIAL_KEYS";

export type OptionalKeysState =
  /** A valid key ring was written to the file. */
  | "injected"
  /** Not set (the usual state until Caroline adds it), or this is not a Preview: the file carries none, enrollment is unavailable. */
  | "omitted"
  /** Set but not a valid key ring, or not writable to the file: left out, enrollment is unavailable. The deploy goes on. */
  | "invalid";

/**
 * Applies FRAMEBRIAR_CREDENTIAL_KEYS to the pulled env file after the required secrets. Unlike them it can never fail the deploy:
 * a missing, empty, malformed or unwritable ring is simply removed from the file (so the redaction marker `vercel pull` writes in
 * place of a Vercel Secret is never read as a ring), and enrollment fails closed at runtime. It is only ever written for Preview;
 * a Production file never carries it. Nothing returned here holds the value.
 */
export function applyFramebriarKeys(
  fileText: string,
  env: Env,
  target: "preview" | "production",
): { text: string; state: OptionalKeysState } {
  const eol = fileText.includes("\r\n") ? "\r\n" : "\n";
  const kept = fileText.split(/\r?\n/).filter((line) => !assigns(line, FRAMEBRIAR_KEYS_SECRET));
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  const value = env[FRAMEBRIAR_KEYS_SECRET];
  const provided = value !== undefined && value.trim() !== "";
  const state: OptionalKeysState =
    target !== "preview" || !provided
      ? "omitted"
      : parseKeyRing(value) && unwritable(value) === null
        ? "injected"
        : "invalid";
  if (state === "injected") kept.push(formatEnvLine(FRAMEBRIAR_KEYS_SECRET, value as string));
  return { text: `${kept.join(eol)}${eol}`, state };
}
