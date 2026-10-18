# Deploying (runbook for #20 / #29)

`develop` deploys a **preview**; `main` deploys **production**. Vercel's GitHub integration is not used: the
`Deploy to Vercel` workflow (`.github/workflows/deploy-vercel.yml`) builds with a pinned Vercel CLI and deploys the
prebuilt output.

## What each run does

1. Waits for the `ci` workflow to pass on the same commit (fails if it failed or never finishes).
2. `vercel pull` for the target, then `scripts/check-deploy-env.ts` checks the pulled variables. It prints variable
   **names** only, and fails when:
   - any test-only variable is present (`NEXT_PUBLIC_E2E_BUILD`, anything starting with `AUTH_E2E_`, `E2E_DATABASE_URL`, `SEED_DATABASE_URL`, `OPEN_METEO_GEOCODING_URL`);
   - a required variable is missing, or `NEON_AUTH_COOKIE_SECRET` is shorter than the 32 characters sign-in needs;
   - `LOCATION_PROVIDER` is set to anything but `open-meteo` (required in preview; optional in production, where unset
     means location search is off);
   - `PRODUCTION_DB_HOST` is unset or is not a bare host name (a full connection URL is refused, never guessed at), or `DATABASE_URL` /
     `DATABASE_URL_UNPOOLED` point at the production database host.
3. `vercel build`, then `npm run check:no-e2e-in-build` (the fake sign-in, the e2e driver and the sample fixtures must
   not be in the output).
4. A second check (`scripts/check-migration-target.ts`) looks at the GitHub environment's `DATABASE_URL_UNPOOLED`, the secret
   the migrate and seed steps actually use: in a preview run it must NOT be `PRODUCTION_DB_HOST`, in a production run it
   MUST be. Then migrations run as their own logged step over the **direct** connection (`npm run db:migrate:remote`).
5. Preview only: `npm run db:seed:preview` (`scripts/seed-preview.ts`). With `PREVIEW_SEED_OWNER_ID` set it loads the
   synthetic sample set for that one owner (see the seed guard in `docs/schema.md`). With it **not** set it skips the
   seed, says so in the log and on the run summary page ("preview seed SKIPPED"), and the run carries on: see
   [First preview bootstrap](#first-preview-bootstrap). A set-but-invalid id fails the run with a message that does not
   repeat it. Production runs never reach this step, and the script refuses anything but `TARGET=preview` as well.
6. `vercel deploy --prebuilt`, then the smoke test (`scripts/smoke-test.ts`), which needs no account or session: every
   public auth page answers 200 (`/sign-in`, `/access-denied`, and any page added to the public list in
   `src/server/auth/public-paths.ts`, such as sign-up in #27) and `/` redirects a signed-out visitor to `/sign-in`.

The Vercel CLI version is pinned in the workflow (`VERCEL_CLI_VERSION`); `@neondatabase/auth` is pinned to an exact
version in `package.json`. Bump either in a PR.

## Things to know

- **Preview data is reset on every `develop` push.** The preview job re-runs the seed, which restores the sample trips and
  sets the preview owner's staples back to the defaults. Anything entered by hand in the preview is lost, by design.
- The seed only runs in the preview job, against `PREVIEW_DB_HOST` (its allowlist), and refuses production runtimes.
- A remote seed always needs an explicit owner id; the `seed-owner` stand-in exists for throwaway local databases only.

## First preview bootstrap

The sample trips must belong to a real Better Auth user, and that user can only be created once the sign-up screens are
deployed. So the first preview run happens **without** `PREVIEW_SEED_OWNER_ID`, on purpose:

1. Leave `PREVIEW_SEED_OWNER_ID` unset. Merge to `develop` (or re-run the workflow). It migrates the preview database,
   skips the seed (visible as "preview seed SKIPPED" in the log and on the run summary), deploys, and smoke-tests the
   public auth pages. Nothing creates an auth user, and nothing uses an email, a fixture id or a production identity.
2. Open the preview, sign up as the owner (the screens are #27; until they ship, create the user in the Neon Auth
   console for the **preview** project) and verify the email.
3. Copy that user's id from Neon Auth into the `preview` environment variable `PREVIEW_SEED_OWNER_ID`.
4. Re-run the `Deploy to Vercel` workflow on `develop`. It now seeds the sample trips for that owner only. Re-running is
   safe: the seed replaces its own sample trips and leaves everything else alone.

If the id is wrong (an email, the stand-in id, something that is not an id), the run fails at the seed step with
"PREVIEW_SEED_OWNER_ID is not a Better Auth user id" and nothing is written. Logs never show database URLs, tokens,
emails or user ids.

## What Caroline must set (for #29)

GitHub, repository level (already exist): secret `VERCEL_TOKEN`, variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

GitHub repository variable: `PRODUCTION_DB_HOST` — the production database's bare host name, such as
`ep-xxxx.us-east-2.aws.neon.tech` (not a URL; not a secret). Previews refuse
to deploy if their database has this host.

GitHub **environment `preview`**:

- secret `DATABASE_URL_UNPOOLED` — the **preview** Neon branch's direct connection string;
- variable `PREVIEW_DB_HOST` — that preview database's host name (the seed allowlist);
- variable `PREVIEW_SEED_OWNER_ID` — the Better Auth user id of the preview owner whose account should see the sample trips. **Leave it unset for the first run** ([First preview bootstrap](#first-preview-bootstrap)); set it after the owner has signed up and verified;
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` — only if Vercel deployment protection is on for previews.

In both GitHub environments, restrict deployment branches (`preview`: `develop` only; `production`: `main` only), so a
branch or pull request can never pick up an environment's secrets.

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

      # VERCEL_TOKEN can deploy to production, so only the two Vercel steps that talk to Vercel (pull and deploy) get it (not `npm ci`, whose
      # install scripts run before this point, nor the build, migrate or seed steps).
      - name: Pull Vercel environment
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        run: vercel pull --yes --environment="$TARGET" --token="$VERCEL_TOKEN"

      - name: Check the deploy environment (names only, no values)
        env:
          PRODUCTION_DB_HOST: ${{ vars.PRODUCTION_DB_HOST }}
        run: npx tsx scripts/check-deploy-env.ts "$TARGET" ".vercel/.env.${TARGET}.local"

      # `vercel build` works from the files `vercel pull` wrote; it needs no token (so the build, which runs project
      # code, never sees one).
      - name: Build
        run: |
          if [ "$TARGET" = production ]; then vercel build --prod; else vercel build; fi

      - name: No test-only code in the build
        run: npm run check:no-e2e-in-build

      # The migrate and seed steps use the GitHub environment's secret, which the Vercel env check never sees. Prove it
      # points at the right database first: not production in a preview run, production in a production run.
      - name: Check the migration target
        env:
          DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}
          PRODUCTION_DB_HOST: ${{ vars.PRODUCTION_DB_HOST }}
        run: npx tsx scripts/check-migration-target.ts "$TARGET"

      - name: Apply database migrations
        env:
          DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}
        run: |
          echo "Migrating the $TARGET database"
          npm run db:migrate:remote

      # Preview only. An unset PREVIEW_SEED_OWNER_ID is the first-preview bootstrap: the step logs a visible skip and the run
      # continues (the owner cannot exist until the sign-up screens are deployed). Never reads the production secret.
      - name: Seed synthetic data (preview only; skipped until the owner id exists)
        if: github.ref_name != 'main'
        env:
          SEED_DATABASE_URL: ${{ secrets.DATABASE_URL_UNPOOLED }}
          SEED_ALLOWED_HOSTS: ${{ vars.PREVIEW_DB_HOST }}
          SEED_OWNER_ID: ${{ vars.PREVIEW_SEED_OWNER_ID }}
          PRODUCTION_DB_HOST: ${{ vars.PRODUCTION_DB_HOST }}
        run: npm run db:seed:preview

      - name: Deploy
        id: deploy
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
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
          DEPLOY_URL: ${{ steps.deploy.outputs.url }}
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: npx tsx scripts/smoke-test.ts "$DEPLOY_URL"
```
