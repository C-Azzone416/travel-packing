# Deploying (runbook for #20 / #29)

`develop` deploys a **preview**; `main` deploys **production**. Vercel's GitHub integration is not used: the
`Deploy to Vercel` workflow (`.github/workflows/deploy-vercel.yml`) builds with a pinned Vercel CLI and deploys the
prebuilt output.

## What each run does

1. Waits for the `ci` workflow to pass on the same commit (fails if it failed or never finishes).
2. `vercel pull` for the target, then `scripts/check-deploy-env.ts` checks the pulled variables. It prints variable
   **names** only, and fails when:
   - any test-only variable is present (`NEXT_PUBLIC_E2E_BUILD`, `AUTH_E2E_*`, `E2E_DATABASE_URL`, `SEED_DATABASE_URL`, `OPEN_METEO_GEOCODING_URL`);
   - a required variable is missing;
   - `LOCATION_PROVIDER` is set to anything but `open-meteo` (required in preview; optional in production, where unset
     means location search is off);
   - (preview) `PRODUCTION_DB_HOST` is unset, or `DATABASE_URL` /
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

| Name                      | Preview                      | Production            |
| ------------------------- | ---------------------------- | --------------------- |
| `DATABASE_URL`            | preview Neon branch (pooled) | production (pooled)   |
| `DATABASE_URL_UNPOOLED`   | preview Neon branch (direct) | production (direct)   |
| `NEON_AUTH_BASE_URL`      | preview auth                 | production auth       |
| `NEON_AUTH_COOKIE_SECRET` | its own random value         | its own random value  |
| `OWNER_EMAIL_ALLOWLIST`   | preview owner(s)             | Caroline              |
| `LOCATION_PROVIDER`       | `open-meteo` (required)      | unset or `open-meteo` |

Never set `NEXT_PUBLIC_E2E_BUILD`, `AUTH_E2E_*`, `E2E_DATABASE_URL` or `OPEN_METEO_GEOCODING_URL` in Vercel or GitHub. Never expose the
production `DATABASE_URL` to the Preview environment.

## First production deploy

The production database starts empty (migrations only). Any seeding of production needs Caroline's explicit approval;
the seed guard refuses production runtimes, so it is a deliberate manual step, not part of the pipeline.

## The workflow file

`.github/workflows/deploy-vercel.yml` could not be committed from the agent session that wrote this (the session's
permission check blocked writing a deploy workflow), so the reviewed text is here. A maintainer adds it verbatim to
`.github/workflows/deploy-vercel.yml`; nothing else in this PR depends on it being present.

```yaml
name: Deploy to Vercel

# develop deploys a preview, main deploys production. No direct GitHub-Vercel integration. Each job runs in the GitHub
# environment `preview` or `production`; production is held for manual approval (required reviewers), and each
# environment holds its OWN DATABASE_URL_UNPOOLED secret, so the preview job can never read production's.
on:
  push:
    branches:
      - develop
      - main

concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false

permissions:
  contents: read
  actions: read # to read the `ci` result for this commit

env:
  VERCEL_CLI_VERSION: 64.5.0 # pinned; never @latest
  VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
  VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
  TARGET: ${{ github.ref_name == 'main' && 'production' || 'preview' }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: ${{ github.ref_name == 'main' && 'production' || 'preview' }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install
        run: npm ci

      - name: Require green CI for this commit
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          for attempt in $(seq 1 40); do
            conclusion=$(gh run list --workflow ci.yml --commit "$GITHUB_SHA" --json status,conclusion \
              --jq '[.[] | select(.status == "completed")] | first | .conclusion // "pending"')
            echo "ci for $GITHUB_SHA: $conclusion"
            case "$conclusion" in
              success) exit 0 ;;
              pending) sleep 30 ;;
              *) echo "CI did not succeed; not deploying." >&2; exit 1 ;;
            esac
          done
          echo "Timed out waiting for CI." >&2
          exit 1

      - name: Install Vercel CLI (pinned)
        run: npm install --global "vercel@${VERCEL_CLI_VERSION}"

      - name: Pull Vercel environment
        run: vercel pull --yes --environment="$TARGET" --token="$VERCEL_TOKEN"

      - name: Check the deploy environment (names only, no values)
        env:
          PRODUCTION_DB_HOST: ${{ vars.PRODUCTION_DB_HOST }}
        run: npx tsx scripts/check-deploy-env.ts "$TARGET" ".vercel/.env.${TARGET}.local"

      - name: Build
        run: |
          if [ "$TARGET" = production ]; then vercel build --prod --token="$VERCEL_TOKEN"; else vercel build --token="$VERCEL_TOKEN"; fi

      - name: No test-only code in the build
        run: npm run check:no-e2e-in-build

      - name: Apply database migrations
        env:
          DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}
        run: |
          echo "Migrating the $TARGET database"
          npm run db:migrate:remote

      - name: Seed synthetic data (preview only)
        if: github.ref_name != 'main'
        env:
          SEED_DATABASE_URL: ${{ secrets.DATABASE_URL_UNPOOLED }}
          SEED_ALLOWED_HOSTS: ${{ vars.PREVIEW_DB_HOST }}
          SEED_OWNER_ID: ${{ vars.PREVIEW_SEED_OWNER_ID }}
        run: npm run db:seed -- --yes

      - name: Deploy
        id: deploy
        run: |
          if [ "$TARGET" = production ]; then
            url=$(vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN")
          else
            url=$(vercel deploy --prebuilt --token="$VERCEL_TOKEN")
          fi
          echo "url=$url" >> "$GITHUB_OUTPUT"
          echo "Deployed ($TARGET): $url" >> "$GITHUB_STEP_SUMMARY"

      - name: Smoke test
        env:
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: npx tsx scripts/smoke-test.ts "${{ steps.deploy.outputs.url }}"
```
