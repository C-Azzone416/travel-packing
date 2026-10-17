# Deploying (runbook for #20 / #29)

`develop` deploys a **preview**; `main` deploys **production**. Vercel's GitHub integration is not used: the
`Deploy to Vercel` workflow (`.github/workflows/deploy-vercel.yml`) builds with a pinned Vercel CLI and deploys the
prebuilt output.

## What each run does

1. Waits for the `ci` workflow to pass on the same commit (fails if it failed or never finishes).
2. `vercel pull` for the target, then `scripts/check-deploy-env.ts` checks the pulled variables. It prints variable
   **names** only, and fails when:
   - any test-only variable is present (`NEXT_PUBLIC_E2E_BUILD`, `AUTH_E2E_*`, `E2E_DATABASE_URL`, `SEED_DATABASE_URL`);
   - a required variable is missing;
   - (preview) `LOCATION_PROVIDER` is not `open-meteo`, `PRODUCTION_DB_HOST` is unset, or `DATABASE_URL` /
     `DATABASE_URL_UNPOOLED` point at the production database host.
3. `vercel build`, then `npm run check:no-e2e-in-build` (the fake sign-in, the e2e driver and the sample fixtures must
   not be in the output).
4. Migrations run as their own logged step over the **direct** connection (`npm run db:migrate:remote`).
5. Preview only: `npm run db:seed -- --yes` loads the synthetic sample set (see the seed guard in `docs/schema.md`).
6. `vercel deploy --prebuilt`, then the smoke test (`scripts/smoke-test.ts`): `/sign-in` answers 200 and `/` redirects
   a signed-out visitor to `/sign-in`.

The Vercel CLI version is pinned in the workflow (`VERCEL_CLI_VERSION`); `@neondatabase/auth` is pinned to an exact
version in `package.json`. Bump either in a PR.

## What Caroline must set (for #29)

GitHub, repository level (already exist): secret `VERCEL_TOKEN`, variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

GitHub repository variable: `PRODUCTION_DB_HOST` — the production database's host name (not a secret). Previews refuse
to deploy if their database has this host.

GitHub **environment `preview`**:

- secret `DATABASE_URL_UNPOOLED` — the **preview** Neon branch's direct connection string;
- variable `PREVIEW_DB_HOST` — that preview database's host name (the seed allowlist);
- variable `PREVIEW_SEED_OWNER_ID` — the sign-in id of the preview owner whose account should see the sample trips;
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` — only if Vercel deployment protection is on for previews.

GitHub **environment `production`**: add **required reviewers** (this is the manual approval for every production
deploy and migration), and the secret `DATABASE_URL_UNPOOLED` for the **production** database. Production secrets
exist only in this environment, so the preview job can never read them.

Vercel project environment variables, per environment (Preview and Production get different values):

| Name                      | Preview                      | Production           |
| ------------------------- | ---------------------------- | -------------------- |
| `DATABASE_URL`            | preview Neon branch (pooled) | production (pooled)  |
| `DATABASE_URL_UNPOOLED`   | preview Neon branch (direct) | production (direct)  |
| `NEON_AUTH_BASE_URL`      | preview auth                 | production auth      |
| `NEON_AUTH_COOKIE_SECRET` | its own random value         | its own random value |
| `OWNER_EMAIL_ALLOWLIST`   | preview owner(s)             | Caroline             |
| `LOCATION_PROVIDER`       | `open-meteo`                 | (see #15 / #47)      |

Never set `NEXT_PUBLIC_E2E_BUILD`, `AUTH_E2E_*` or `E2E_DATABASE_URL` in Vercel or GitHub. Never expose the
production `DATABASE_URL` to the Preview environment.

## First production deploy

The production database starts empty (migrations only). Any seeding of production needs Caroline's explicit approval;
the seed guard refuses production runtimes, so it is a deliberate manual step, not part of the pipeline.
