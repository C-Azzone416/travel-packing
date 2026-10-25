// Repository hygiene rules, enforced in CI by `npm run check:repo-hygiene`. They exist because a blanket
// `git add -A` once swept a 38 MB local Postgres data directory (.data/seed-db) into a commit. Local databases, build
// output, test output, dependencies, and real env files must never be committed, and no committed file is large.

export const MAX_FILE_BYTES = 1024 * 1024;

/** Generated lockfiles are exempt from the size limit (they grow with the dependency tree); the path rules still apply. */
const SIZE_EXEMPT = new Set(["package-lock.json"]);

export interface TrackedFile {
  path: string;
  bytes: number;
  /** Text is supplied only for public documentation, so email literals can be rejected without reading binary files. */
  text?: string;
}

const MARKDOWN = /\.mdx?$/i;
const EMAIL_LITERAL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

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
  for (const { path, bytes, text } of files) {
    for (const [pattern, why] of FORBIDDEN_PATHS) {
      if (pattern.test(path)) problems.push(`${path}: ${why} must not be committed`);
    }
    if (bytes > MAX_FILE_BYTES && !SIZE_EXEMPT.has(path)) {
      problems.push(`${path}: ${bytes} bytes exceeds the ${MAX_FILE_BYTES}-byte limit`);
    }
    if (MARKDOWN.test(path) && text !== undefined && EMAIL_LITERAL.test(text)) {
      problems.push(
        `${path}: email address literals must not be committed in public documentation`,
      );
    }
  }
  return problems;
}
