# Travel Packing

Responsive, same-origin Next.js (App Router, TypeScript strict) app. See
`TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md` for the design and
`CONTRIBUTING.md` for the workflow.

## Requirements

Node 22 LTS (`.nvmrc`), npm.

## Commands

| Command                          | What it does                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                         | Install exact dependencies from the lockfile                                                                                                                                                                                                                                                                                                                               |
| `npm run dev`                    | Start the dev server                                                                                                                                                                                                                                                                                                                                                       |
| `npm run lint`                   | ESLint + Prettier check                                                                                                                                                                                                                                                                                                                                                    |
| `npm run typecheck`              | `tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                             |
| `npm test`                       | Unit tests (Vitest) with coverage gate                                                                                                                                                                                                                                                                                                                                     |
| `npm run test:coverage`          | Same as `npm test`; **fails below 90%** on lines, branches, functions, statements                                                                                                                                                                                                                                                                                          |
| `npm run test:e2e`               | Playwright smoke tests on phone (390×844) and desktop (1440×1000); builds and serves the app first. Run `npx playwright install chromium` once. The specs run against a real Postgres wire-protocol server (PGlite, migrated and seeded, in memory) with the e2e-only fake sign-in; both are compiled out of normal builds. Override ports with `E2E_PORT` / `E2E_DB_PORT` |
| `npm run ci:gate -- <pr or sha>` | Is `ci` green on exactly that commit? Needs `gh` signed in. Run it before a merge                                                                                                                                                                                                                                                                                          |
| `npm run verify`                 | Everything full-mode CI runs, locally, cheapest first, stopping at the first failure; prints a pasteable summary. Run it before marking a PR ready                                                                                                                                                                                                                         |
| `npm run verify:quick`           | The cheap part (before the builds); the pre-push hook runs it. `git push --no-verify` bypasses the hook in an emergency                                                                                                                                                                                                                                                    |
| `npm run build`                  | Production build                                                                                                                                                                                                                                                                                                                                                           |
| `npm run db:generate`            | Generate the next migration from `src/server/db/schema.ts` (see `docs/schema.md`)                                                                                                                                                                                                                                                                                          |
| `npm run db:check`               | Validate the migration set                                                                                                                                                                                                                                                                                                                                                 |
| `npm run db:seed`                | Load the synthetic sample set into a local PGlite database (or `SEED_DATABASE_URL` with `--yes` and `SEED_ALLOWED_HOSTS`); refuses production                                                                                                                                                                                                                              |
| `npm run db:migrate:remote`      | Apply pending migrations over one direct connection (`DATABASE_URL_UNPOOLED`); not run by CI                                                                                                                                                                                                                                                                               |
| `npm run db:migrate`             | Apply all migrations to an empty in-memory Postgres, roll back, and re-apply (no real database)                                                                                                                                                                                                                                                                            |

Fresh clone check: `npm ci && npm run lint && npm run typecheck && npm run test:coverage && npm run build`.

## Folder conventions

- `src/domain/` — pure logic, no framework imports
- `src/server/` — data access and authorization
- `src/app/` — routes and UI
- `tests/e2e/` — Playwright specs
- `reference/` — read-only approved prototype; excluded from build, lint, and coverage

Unit tests live beside the code as `*.test.ts(x)`.

## Environment

Copy `.env.example` to `.env.local` and fill in values locally. The file lists variable names
only; never commit real values.

## Coverage exclusions

Only tests, `.d.ts` type-only files, and the framework-only root layout are excluded; each is
justified in a comment in `vitest.config.ts`.
