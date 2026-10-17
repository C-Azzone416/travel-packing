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
