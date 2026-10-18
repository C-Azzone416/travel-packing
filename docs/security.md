# Security verification (#22)

What the repository checks automatically, and what it deliberately does not do yet.

## Checked in CI

- **Client bundle scan** (`npm run check:client-bundle`, after both the Turbopack and webpack builds): nothing in
  `.next/static` may name a server secret (`DATABASE_URL`, `NEON_AUTH_COOKIE_SECRET`, ...), contain a secret-shaped value
  (a database URL with a password, a private key, common token shapes) or contain server-only code. Findings print the
  file and the problem, never the matched text. `src/tooling/bundle-scan.test.ts` injects fake secrets and proves the
  scan, and the CLI, fail on them.
- **E2E-only code** stays out of builds (`npm run check:no-e2e-in-build`).
- **Dependency audit:** `npm audit --omit=dev --audit-level=high` fails the build; Dependabot opens weekly update PRs
  for npm and GitHub Actions (they go through the normal gates, nothing auto-merges).
- **Repository hygiene** (`npm run check:repo-hygiene`) and the secret scan (gitleaks).

## Headers (`src/security/headers.ts`, applied to every route)

CSP (`default-src 'self'`; no framing; `object-src 'none'`; forms post only to this origin; no foreign origins, because
geocoding and weather are only ever called by the server), HSTS (2 years, subdomains), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. E2E checks the
real responses and that the CSP produces no violations while the app loads. Known gap: scripts and styles allow
`'unsafe-inline'` because Next emits an inline bootstrap; a nonce-based policy needs per-request middleware (follow-up).

## Logging

App logs are a closed set of event codes (auth, data, locations), so nothing sensitive can reach them by construction.
Anything else goes through `src/server/redact.ts` (`logWarning` / `logInfo`), which scrubs emails, dates, credentials in
URLs and bearer tokens from text, and the values of sensitive fields (destinations, item names, trips, emails, tokens).
ESLint forbids raw `console.*` in app code outside those sinks.

## Rate limiting

- **Sign-in:** only FAILED attempts count, so knowing the owner's email cannot lock the owner out. The lockout is keyed on
  (email, address): 10 failures per 15 minutes from one address for one email; failures from elsewhere do not block it,
  and a success clears the pair. Looser backstops cap guessing spread across addresses (50 per email) and one address
  trying many accounts (40 per address). The check happens BEFORE the credentials are looked at, and a closed
  `sign-in-rate-limited` event is logged. `SIGN_IN_ATTEMPTS_PER_15_MIN` raises the base number (1-10000; a bad value uses
  the default); e2e sets it high because every test signs in from one address. The client address is the first
  `x-forwarded-for` entry, which is right only because Vercel overwrites that header with the real client address;
  revisit if the app is ever hosted elsewhere.
- **Place search:** per session (`LOCATION_SEARCHES_PER_MINUTE`, from #47).
- **Limits are per server instance (memory).** A limit shared across instances needs a store the app does not have; per
  the issue, that approach is for Caroline to review (#28). Mutation endpoints are owner-gated and locked but not yet
  rate limited for the same reason.
