# Deploying (runbook for #20 / #29)

A push to `develop` deploys a **preview**. **Production** is released by hand, never by a push (see
[Production release gate](#production-release-gate)). Vercel's GitHub integration is not used: the `Deploy to Vercel`
workflow (`.github/workflows/deploy-vercel.yml`) builds with a pinned Vercel CLI and deploys the prebuilt output.

## What each run does

0. The `gate` job (no secrets, no environment) decides the target, or fails the run: see
   [Production release gate](#production-release-gate). Everything below runs in the `deploy` job, in the GitHub
   environment the gate chose.
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

1. Leave `PREVIEW_SEED_OWNER_ID` unset. Merge to `develop`. It migrates the preview database,
   skips the seed (visible as "preview seed SKIPPED" in the log and on the run summary), deploys, and smoke-tests the
   public auth pages. Nothing creates an auth user, and nothing uses an email, a fixture id or a production identity.
2. Open the preview, sign up as the owner (the screens are #27; until they ship, create the user in the Neon Auth
   console for the **preview** project) and verify the email.
3. Copy that user's id from Neon Auth into the `preview` environment **secret** `PREVIEW_SEED_OWNER_ID`.
4. Open the latest `Deploy to Vercel` run on `develop` (Actions) and choose **Re-run all jobs**. (Do not use `Run workflow` on
   `develop`: the gate refuses a manual run anywhere but `main`, by design.) It now seeds the sample trips for that owner only. Re-running is
   safe: the seed replaces its own sample trips and leaves everything else alone.

If the id is wrong (an email, the stand-in id, something that is not an id), the run fails at the seed step with
"PREVIEW_SEED_OWNER_ID is not a Better Auth user id" and nothing is written. Logs never show database URLs, tokens,
emails or user ids.

## What Caroline must set (for #29)

GitHub, repository level (already exist): variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

**`VERCEL_TOKEN`: store it as a secret in each GitHub environment (`preview` AND `production`), not at repository level.**
A repository-level secret can be read by a workflow on any branch, which would let a pushed branch use it. Be plain
about what this does and does not buy: a Vercel token is not scoped to an environment, so the token the preview job
holds can also deploy to production's Vercel project. Environment secrets only stop other branches from reading it. The
remaining controls are that only the two Vercel steps (pull and deploy) read it, the Vercel CLI is pinned, and nothing
else in the job sees it (`npm run check:workflows` enforces the first). Use a token limited to this one project if
Vercel offers that on your plan, and rotate it if it may have been exposed.

GitHub repository **secret** `PRODUCTION_DB_HOST` — the production database's bare host name, such as
`ep-xxxx.us-east-2.aws.neon.tech` (not a URL). Previews refuse to deploy if their database has this host. It is a
secret only so the run log masks it: GitHub prints every step's `env:` values in the log and masks secrets alone, so a
variable would show the production host (and, for `PREVIEW_SEED_OWNER_ID`, the preview owner's user id) on every step.
If `PRODUCTION_DB_HOST` already exists as a repository variable, create the secret with the same value and delete the
variable. `PREVIEW_DB_HOST` stays a variable: it is the preview host, which is fine to print.

GitHub **environment `preview`**:

- secret `DATABASE_URL_UNPOOLED` — the **preview** Neon branch's direct connection string;
- variable `PREVIEW_DB_HOST` — that preview database's host name (the seed allowlist);
- **secret** `PREVIEW_SEED_OWNER_ID` — the Better Auth user id of the preview owner whose account should see the sample trips. **Leave it unset for the first run** ([First preview bootstrap](#first-preview-bootstrap)); set it after the owner has signed up and verified;
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` — only if Vercel deployment protection is on for previews.

In both GitHub environments, restrict deployment branches (`preview`: `develop` only; `production`: `main` only), so a
branch or pull request can never pick up an environment's secrets.

GitHub **environment `production`**: the secret `DATABASE_URL_UNPOOLED` for the **production** database. Production
secrets exist only in this environment, so the preview job can never read them. (GitHub's native required reviewers are
not available on this plan, so the approval is the explicit gate below; if the plan ever allows required reviewers,
add them as a second lock, not a replacement.)

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

## Production release gate

GitHub's required reviewers are not available on this plan, so the gate is explicit and lives in the workflow
(`scripts/release-gate.ts`, tested in `src/tooling/release-gate.test.ts`):

- **A push to `main` does not deploy production.** Only a push to `develop` deploys (the preview).
- **Production is a manual run**: Actions, `Deploy to Vercel`, `Run workflow`, branch **`main`**, and type the **full
  40-character SHA** of the commit being released into `release_sha`. It must equal the tip of `main` at the moment
  of the run (if `main` moved since you copied it, the run refuses and nothing deploys).
- **Only the repository owner**: both the person who started the run and the person who re-ran it must be the owner.
- A manual run from any other branch, any other event, a blank/short/wrong SHA or a different person is refused by the
  `gate` job, before any secret or environment is touched. Refusals name the rule, never the typed value.
- The `production` environment is restricted to `main`, an independent second lock **on production's database secret and
  environment**: a run whose gate was edited on another branch cannot use them. It does not protect the Vercel token (see
  above: that token can deploy to either target, so keep it in the environments and out of the repository secrets). Keep
  `main` protected so only reviewed changes reach it.
- The owner check is on the GitHub **account**. It stops other people. It does not stop anything that holds the owner's
  own credentials (for example an agent session signed in as the owner), and the typed SHA is a safeguard against
  mistakes, not proof that a human typed it. Treat the owner's GitHub login and tokens as the production key.
- After the gate, the run still waits for green CI on that commit, checks the Vercel variables and that
  `DATABASE_URL_UNPOOLED` is production's own database, migrates, deploys and smoke-tests. It never seeds production.

To release: merge to `main` (by the normal reviewed path), copy the commit SHA, run the workflow as above.

## The workflow file

The reviewed workflow is `.github/workflows/deploy-vercel.yml` (the file is the source of truth; this page no longer
carries a copy). CI keeps it honest without printing any value: `actionlint` (a pinned release, verified by SHA-256)
checks syntax and expressions, and `npm run check:workflows` (`src/tooling/workflow-check.ts`) requires every action in
every workflow to be pinned to a full commit SHA and enforces the deploy contract: a push to `main` cannot trigger a
deploy, the gate holds no secret or environment, the deploy job's environment and `TARGET` come from the gate,
`VERCEL_TOKEN` is read by exactly the pull and deploy steps, only the direct `DATABASE_URL_UNPOOLED` is used, the
migration target is checked before migrating or seeding, and the only seed in the pipeline is the preview-only
`db:seed:preview`.
