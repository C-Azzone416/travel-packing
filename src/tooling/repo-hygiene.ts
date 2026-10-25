// Repository hygiene rules, enforced in CI by `npm run check:repo-hygiene`. They exist because a blanket
// `git add -A` once swept a 38 MB local Postgres data directory (.data/seed-db) into a commit. Local databases, build
// output, test output, dependencies, and real env files must never be committed, and no committed file is large.

export const MAX_FILE_BYTES = 1024 * 1024;

/** Generated lockfiles are exempt from the size limit (they grow with the dependency tree); the path rules still apply. */
const SIZE_EXEMPT = new Set(["package-lock.json"]);

export interface TrackedFile {
  path: string;
  bytes: number;
  /** Present for text files only. Binary files are intentionally left undefined. */
  text?: string;
  /** Set when a tracked file exists but cannot be inspected. */
  inspectionFailed?: boolean;
}

const EMAIL_LITERAL = /[a-z0-9._%+-]+@(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|localhost)\b/gi;
const RESERVED_EXAMPLE_DOMAINS = ["example.com", "example.org", "example.net"] as const;

function isReservedEmailDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".invalid") ||
    RESERVED_EXAMPLE_DOMAINS.some(
      (reserved) => normalized === reserved || normalized.endsWith(`.${reserved}`),
    )
  );
}

function containsNonReservedEmail(text: string): boolean {
  for (const match of text.matchAll(EMAIL_LITERAL)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 256), match.index);
    // A URL password followed by @host is email-shaped but is not an email address.
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s/@]*:$/i.test(before)) continue;
    const domain = match[0].slice(match[0].lastIndexOf("@") + 1);
    if (!isReservedEmailDomain(domain)) return true;
  }
  return false;
}

/** Path rules: each is `[pattern, why]`. Paths use forward slashes, relative to the repository root. */
const FORBIDDEN_PATHS: readonly (readonly [RegExp, string])[] = [
  [/(^|\/)\.data\//, "local database directory (.data/)"],
  [/(^|\/)(PG_VERSION|pg_wal)(\/|$)/, "a Postgres data directory"],
  [/(^|\/)node_modules\//, "installed dependencies"],
  [/(^|\/)\.next\//, "Next.js build output"],
  [/(^|\/)(test-results|playwright-report)\//, "test output"],
  [/(^|\/)coverage\//, "coverage output"],
  // Real env files carry secrets. Only the names-only template may be committed.
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, "an env file (only .env.example is allowed)"],
];

/** Every problem found, as short human-readable lines. Empty means clean. */
export function findHygieneProblems(files: readonly TrackedFile[]): string[] {
  const problems: string[] = [];
  for (const { path, bytes, text, inspectionFailed } of files) {
    for (const [pattern, why] of FORBIDDEN_PATHS) {
      if (pattern.test(path)) problems.push(`${path}: ${why} must not be committed`);
    }
    if (bytes > MAX_FILE_BYTES && !SIZE_EXEMPT.has(path)) {
      problems.push(`${path}: ${bytes} bytes exceeds the ${MAX_FILE_BYTES}-byte limit`);
    }
    if (inspectionFailed) {
      problems.push(`${path}: tracked file could not be inspected`);
    } else if (text !== undefined && containsNonReservedEmail(text)) {
      problems.push(`${path}: email address literals must use reserved example domains`);
    }
  }
  return problems;
}
