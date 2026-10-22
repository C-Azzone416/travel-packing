// Owner allowlist (OWNER_EMAIL_ALLOWLIST): the real access control. Hiding signup is not.
// Fail closed: an empty or missing list admits nobody.

export type Allowlist = ReadonlySet<string>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Comma, semicolon, or whitespace separated emails. Blank entries are ignored. */
export function parseAllowlist(raw: string | undefined): Allowlist {
  const entries = (raw ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((entry) => entry.length > 0);
  return new Set(entries);
}

export function isAllowed(allowlist: Allowlist, email: string | null | undefined): boolean {
  return typeof email === "string" && allowlist.has(normalizeEmail(email));
}

/**
 * A plain address: letters, digits and . _ % + - before the @, letters, digits, dots and hyphens after it, and a top-level
 * domain of two or more letters. Nothing the allowlist is matched against has to be this strict (an entry is only ever
 * compared for equality), but an entry outside it, such as one wrapped in quotes or angle brackets from a paste, can never
 * equal a real address a person signs up with, so it is worth saying so (#93).
 */
const PLAIN_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function isPlainEmail(entry: string): boolean {
  return PLAIN_EMAIL.test(normalizeEmail(entry));
}
