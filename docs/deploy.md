# Deploying (runbook for #20 / #29)

A push to `develop` deploys a **preview**, after a green `ci` on that push: `ci.yml` has a `deploy` job (`needs: ci`) that
calls the deploy workflow, so nothing waits idle for CI (idle waiting is billed; see [docs/ci.md](ci.md)). **Production**
is released by hand, never by a push (see [Production release gate](#production-release-gate)). Vercel's GitHub
integration is not used: the `Deploy to Vercel` workflow (`.github/workflows/deploy-vercel.yml`, triggered only by that call and
by a manual run) builds with a pinned Vercel CLI and deploys the prebuilt output.

Both supported routes—the Preview call after a green `develop` CI run and the manual Production dispatch—first populate
`node_modules` in GitHub Actions. A direct Vercel dashboard/Git build is intentionally unsupported: `vercel.json` disables
Vercel's install step so package credentials never reach its builder. Re-enable that integration only with a separately
reviewed credential-isolation design; otherwise it will fail closed because dependencies are absent.

## What each run does

0. The `gate` job (no secrets, no environment) decides the target, or fails the run: see
   [Production release gate](#production-release-gate). Everything below runs in the `deploy` job, in the GitHub
   environment the gate chose.
1. **Preview:** CI already passed on this exact push (the caller's `needs: ci`). **Production:** a single look, with no waiting
   (`scripts/require-ci.ts`): the latest `ci` run on the typed commit must be complete and green, or the run stops.
   The same check is available to anyone before a merge: `npm run ci:gate -- <pr number or full sha>`.
2. `vercel pull` for the target, then the five build settings that decide which builder `vercel build` uses (framework, build command,
   output directory, root directory, install command; settings only, never the ids) are printed to the log. The repo's `vercel.json` names the framework (`nextjs`) and sets the install command to the empty string: the dedicated root install already populated `node_modules`, so the Vercel/Next compilation cannot run a second package install. The four write-only Vercel Secrets are then written into the pulled file from the selected GitHub environment (see [Deploy secrets](#deploy-secrets)). Then `scripts/check-deploy-env.ts` checks the
   file the build will use. It prints variable **names** only, and fails when:
   - any test-only variable is present (`NEXT_PUBLIC_E2E_BUILD`, anything starting with `AUTH_E2E_`, `E2E_DATABASE_URL`, `SEED_DATABASE_URL`, `OPEN_METEO_GEOCODING_URL`);
   - any package-auth variable is present (`NODE_AUTH_TOKEN`, `NPM_AUTH_TOKEN`, `NPM_TOKEN`, `FRAMEBRIAR_PACKAGES_TOKEN`);
   - a required variable is missing, or `NEON_AUTH_COOKIE_SECRET` is shorter than the 32 characters sign-in needs;
   - any required variable is still Vercel's redaction marker (`[SENSITIVE]`, what `vercel pull` writes
     for a Secret it cannot read), or either database URL is not a `postgres://` / `postgresql://` URL with a host, or
     `OWNER_EMAIL_ALLOWLIST` is empty or is not a comma-separated list of well-formed emails. Both target files are read
     exactly the way `vercel build` reads them;
   - `LOCATION_PROVIDER` is set to anything but `open-meteo` (required in preview; optional in production, where unset
     means location search is off);
   - `PRODUCTION_DB_HOST` is unset or is not a bare host name (a full connection URL is refused, never guessed at), or `DATABASE_URL` /
     `DATABASE_URL_UNPOOLED` point at the production database host.
3. `vercel build`, then `scripts/check-build-output.ts` (the output must contain server functions: an output without them deploys "fine" and
   answers every request with a 404), then `npm run check:no-e2e-in-build` (the fake sign-in, the e2e driver and the sample fixtures must
   not be in the output). Target-specific scans inspect this exact Vercel artifact before upload: Preview must contain the
   Framebriar UI and every browser SDK module the app uses; Production must contain neither feedback UI/SDK nor screenshot
   capture. These scans read `.vercel/output`, the directory the following deploy step uploads, rather than an intermediate
   `.next` tree. A target whose build-time gate was misread therefore fails closed before deploy.
4. A second check (`scripts/check-migration-target.ts`) looks at the GitHub environment's `DATABASE_URL_UNPOOLED`, the secret
   the migrate and seed steps actually use: in a preview run it must NOT be `PRODUCTION_DB_HOST`, in a production run it
   MUST be. Then migrations run as their own logged step over the **direct** connection (`npm run db:migrate:remote`).
5. Preview only: `npm run db:seed:preview` (`scripts/seed-preview.ts`). With `PREVIEW_SEED_OWNER_ID` set it loads the
   synthetic sample set for that one owner (see the seed guard in `docs/schema.md`). With it **not** set it skips the
   seed, says so in the log and on the run summary page ("preview seed SKIPPED"), and the run carries on: see
   [First preview bootstrap](#first-preview-bootstrap). A set-but-invalid id fails the run with a message that does not
   repeat it. Production runs never reach this step, and the script refuses anything but `TARGET=preview` as well.
6. `vercel deploy --prebuilt` (a preview names its target with `--target=preview`: Vercel assigns a project's **first** deployment to
   production when none is given; both deploys label the deployment with the release commit, `--meta releaseSha=$GITHUB_SHA`),
   then `scripts/check-deploy-target.ts` reads the CLI's own output and **fails the run if a preview run created a Production
   deployment** (or a production run a Preview one). The run summary then says **"Deployment: SUCCEEDED"**: the deployment is
   live whatever the checks below say, and each check reports on its own line.
7. **Preview:** the smoke test (`scripts/smoke-test.ts`) on the deployment's address, with the protection-bypass secret for the
   protected Preview. **Production:** a production deployment's generated address is behind Vercel Authentication, so it is never
   smoke-tested. Instead `scripts/verify-production-alias.ts` first proves the public Production alias (`PRODUCTION_ALIAS`,
   `packed-smart.vercel.app`) is **this** deployment (two read-only Vercel REST calls): the deployment found by its address is
   READY, a production deployment, and carries `meta.releaseSha` equal to the commit being released, and the alias's
   `deploymentId` is that deployment. Vercel moves the alias a few seconds after READY, so the alias check is retried for about
   two minutes; after that a stale alias fails the run ("still points to dpl_OLD, not this run's dpl_NEW") and **nothing is
   smoke-tested through it**. Only then the smoke test runs against the alias, with no bypass secret. Its summary lines are
   **"Production alias check: PASSED/FAILED"** and **"Smoke test: PASSED/FAILED"**, so a live deployment with a failed check
   reads that way. The smoke test needs no account or session: every public auth page answers 200 (`/sign-in`, `/access-denied`, and any page added to the public list in
   `src/server/auth/public-paths.ts`, such as sign-up in #27) and `/` redirects a signed-out visitor to `/sign-in` **on the same
   host**. **A Vercel Authentication answer (a 401, a redirect to vercel.com's sign-on, its nonce cookie) is never a pass**; it is
   reported as "Vercel Authentication answered, not the app". When a check fails it also prints the response's
   `x-vercel-error` and `x-vercel-id` headers and the first 200 characters of its body (never the request headers, the `Location` header or the bypass secret), which tells a Vercel platform error from the app's own answer.

The Vercel CLI is installed from its own lockfile, `tools/vercel-cli` (the exact version, every transitive and its integrity hash; `npm ci --prefix tools/vercel-cli --ignore-scripts`, then on the PATH; never a global install or `npx`), and `VERCEL_CLI_VERSION` in the workflow must equal the locked version: see [tools/vercel-cli/README.md](../tools/vercel-cli/README.md) for how to upgrade it. `@neondatabase/auth` is pinned to an exact
version in `package.json`. Bump either in a PR.

The application install fetches the private Framebriar SDK with the expiring, read-only
`FRAMEBRIAR_PACKAGES_TOKEN` repository secret. That step uses `npm ci --ignore-scripts`; a separate credential-free step runs
only the pinned `esbuild` and `unrs-resolver` lifecycle scripts required by the toolchain. `vercel build` skips dependency installation and receives no package credential. The secret is
stored only in GitHub Actions, never Vercel, and the production-capable `VERCEL_TOKEN` is not exposed to install or build.

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
2. Open the preview, sign up as the owner at `/sign-up`, enter the code emailed to the address, then open the link emailed
   next ("Check your email to finish setting up") and choose a password, and sign in. Nothing needs to be created in the Neon Auth
   console, and it does not matter who signs up first: a password chosen by anyone else can never sign in
   ([how this works](auth-screens.md#pre-registration-closed-by-setting-the-password-through-the-emailed-link)). Only an address on
   `OWNER_EMAIL_ALLOWLIST` can sign up.
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
- secrets `DATABASE_URL` (the preview branch's pooled connection string), `OWNER_EMAIL_ALLOWLIST` and
  `NEON_AUTH_COOKIE_SECRET` (the same values as the Vercel Preview Secrets, see [Deploy secrets](#deploy-secrets));
- secret `FRAMEBRIAR_CREDENTIAL_KEYS` (optional, #259) — the key ring that seals server-held Framebriar credentials, the same value as the Vercel Preview
  Secret. The deploy never fails without it: feedback enrollment is simply unavailable. Generation and rotation: [framebriar-enrollment.md](framebriar-enrollment.md);
- variable `PREVIEW_DB_HOST` — that preview database's host name (the seed allowlist);
- **secret** `PREVIEW_SEED_OWNER_ID` — the Better Auth user id of the preview owner whose account should see the sample trips. **Leave it unset for the first run** ([First preview bootstrap](#first-preview-bootstrap)); set it after the owner has signed up and verified;
- secret `VERCEL_AUTOMATION_BYPASS_SECRET` — only if Vercel deployment protection is on for previews.

In both GitHub environments, restrict deployment branches (`preview`: `develop` only; `production`: `main` only), so a
branch or pull request can never pick up an environment's secrets.

GitHub **environment `production`**: secrets `DATABASE_URL` (the production pooled connection string),
`DATABASE_URL_UNPOOLED` (the production direct connection string), `OWNER_EMAIL_ALLOWLIST`, and
`NEON_AUTH_COOKIE_SECRET`; each matches the corresponding Vercel Production Secret. Production secrets exist only in
this environment, so the preview job can never read them. (GitHub's native required reviewers are
not available on this plan, so the approval is the explicit gate below; if the plan ever allows required reviewers,
add them as a second lock, not a replacement.)

Vercel project environment variables, per environment (Preview and Production get different values):

| Name                         | Preview                                                                   | Production            |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------- |
| `DATABASE_URL`               | preview Neon branch (pooled)                                              | production (pooled)   |
| `DATABASE_URL_UNPOOLED`      | preview Neon branch (direct)                                              | production (direct)   |
| `NEON_AUTH_BASE_URL`         | preview auth                                                              | production auth       |
| `NEON_AUTH_COOKIE_SECRET`    | its own random value                                                      | its own random value  |
| `OWNER_EMAIL_ALLOWLIST`      | preview owner(s)                                                          | Caroline              |
| `CLOSE_ACCOUNT_ENABLED`      | unset initially; exact `1` only after the documented release gates        | unset initially       |
| `LOCATION_PROVIDER`          | `open-meteo` (required)                                                   | unset or `open-meteo` |
| `WEATHER_PROVIDER`           | `open-meteo`                                                              | `open-meteo`          |
| `FRAMEBRIAR_CREDENTIAL_KEYS` | optional Secret, see [framebriar-enrollment.md](framebriar-enrollment.md) | never set             |

Never set `NEXT_PUBLIC_E2E_BUILD`, `AUTH_E2E_*`, `E2E_DATABASE_URL` or `OPEN_METEO_GEOCODING_URL` in Vercel or GitHub. Never expose the
production `DATABASE_URL` to the Preview environment. `CLOSE_ACCOUNT_ENABLED` is deliberately absent from both hosted targets when
the feature lands; enabling it is a separate release decision after the gates in [account-deletion.md](account-deletion.md).

## The stable Preview address (#96)

Every deploy gets its own `travel-packing-<hash>-….vercel.app` URL, which is no use as a sign-in or reset-link address (the auth
project has to trust each origin it serves). So after a good preview deploy the workflow points ONE stable name,
`https://travel-packing-preview.vercel.app`, at it, with the existing `VERCEL_TOKEN` and `VERCEL_ORG_ID` (`scripts/assign-alias.ts`; the
first run creates the name, and if Vercel refuses it the step fails loudly and nothing else changes).

It uses Vercel's REST API (look up the deployment, then `POST /v2/deployments/{id}/aliases` for the team) and not `vercel alias set`:
the CLI loads the token's user first (`GET /v2/user`), which answers 404 "User not found" for this token however `--scope` is given
(develop runs after #99 and #100), while pull and deploy never make that call. If the REST call is refused with 401/403/404 the token
itself lacks access to the team; that is a credential matter for the repository owner (a token created under an account that is a member
of the team), not something the workflow can fix.

The alias moves only when all of this holds, in this order, in the same job:

1. the build, the deploy, the "landed in the right environment" check and the **smoke test of the deployment URL** all passed (a failed
   step ends the job; no later step runs `always()` or continues past a failure, and `check:workflows` forbids both);
2. it is a **preview** run (production never gets an alias);
3. **this run's commit is still the `develop` head**. Deploys are serialized by the workflow's concurrency group and never cancelled, so an older
   run can finish after a newer push; it then skips the alias with a notice (`alias skipped: develop has moved on...`) and the newer run moves it.
   A head that cannot be read fails the step, loudly, with the alias untouched (`scripts/check-alias-head.ts`, `src/tooling/alias-head.ts`);

then the alias itself is **smoke-tested** (the same checks as the deployment URL).

**Old Preview deployments are deleted (#135).** Only the alias address should stay reachable: old per-deploy URLs keep talking to the Preview
database with stale code (they caused the #119 lock-out). After the alias smoke test, the last step (`scripts/cleanup-previews.ts`, logic in
`src/tooling/preview-cleanup.ts`) deletes every Preview deployment of the project except the one the alias points to, with the same
`VERCEL_TOKEN` (`GET /v6/deployments?target=preview`, then `DELETE /v13/deployments/{id}`). It deletes nothing unless the alias target is
confirmed two ways (the alias's own answer and this run's deployment agree) and is among the listed Previews; it checks each deployment's own
target again, so Production is never touched; it skips builds still in progress (the next run takes them); it retries on 429. It logs counts only
(`preview-cleanup: deleted N, kept 1`) and always exits 0, so it can never fail a deploy. The first run after it merged also clears the backlog.

On Preview (`VERCEL_ENV=preview` at runtime) the app builds its reset-link return address from that stable origin and ignores the host the
request arrived on (`src/server/auth/request-origin.ts`), so no per-deployment URL reaches an emailed link. Everywhere else (production, local) it is
still derived from the request. The Neon Auth Preview project must trust exactly `https://travel-packing-preview.vercel.app` (add it under
trusted domains); that is a Neon setting, not part of the workflow.

**Order matters (trust the origin only after the alias is ours).** The name `travel-packing-preview.vercel.app` is a public `*.vercel.app`
name that nobody holds until the first successful run assigns it to this project; until then anyone with a Vercel account could claim it, and
every reset and finish-setup link on Preview is built on exactly that origin. So:

1. Let the first preview run assign the alias, and confirm it is this project's (the run summary line `Preview alias: https://travel-packing-preview.vercel.app -> https://<deployment host> (dpl_…, replacing … / first assignment)`).
2. Only then add `https://travel-packing-preview.vercel.app` to the Neon Auth Preview trusted domains.
3. If the alias step ever fails with "in use" or a refusal, **do not** trust that origin in Neon; tell the PM (someone else may hold the name, and reset links on Preview would point at their site).
4. Until the alias is ours, reset and finish-setup links on Preview point at an unassigned name and will not work.

## Deploy secrets

`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `OWNER_EMAIL_ALLOWLIST` and `NEON_AUTH_COOKIE_SECRET` are stored in Vercel as
**Secrets** (write-only). `vercel pull` cannot read a Secret, so it writes the 11-character redaction marker
`[SENSITIVE]` into the pulled target file instead, and `vercel build` would use that marker as if it were the value. The
step "Inject deployment secrets" replaces exactly those four entries with the selected GitHub environment's secrets of
the same names, right after the pull and before the check and build (`scripts/inject-deploy-secrets.ts`). Preview and
Production use the same names but separate values and separate GitHub environments.

- The values reach the script only through the step's `env:` from `secrets.*`, so GitHub masks them. They are never
  printed (the script prints variable names only), never put on the run summary, never uploaded and never committed. The
  file is made readable by the job's user alone.
- Fails closed: if any of the four is missing, empty, or cannot be written to the file faithfully (leading or trailing
  whitespace, a carriage return, or a literal backslash followed by `n`), the run stops and names only the variable.
  Quotes, backslashes, `$`, `#` and newlines inside a value are written correctly for the reader `vercel build` uses.
- The validator (step 2) then checks the injected file: no variable may still be the redaction marker, both database
  URLs must be Postgres URLs, the target must use the correct database host, the allowlist must be well-formed emails,
  and the cookie secret must be at least 32 characters.
- **Rotating a target secret means updating both copies together**: the Vercel Secret used by the running target and
  the matching GitHub environment secret used by its build and check. If they differ, the deployed app and build
  disagree, and Vercel will not show the old value to compare. Generate the new value once, apply it to both, then
  discard it.

### Checking that Vercel and GitHub hold the same allowlist

Both copies of `OWNER_EMAIL_ALLOWLIST` (and the cookie secret) are write-only secrets, so nobody can read them side by side. Compare
**fingerprints** instead (#93): a 12-character keyed digest (HMAC, keyed from `NEON_AUTH_COOKIE_SECRET`) of the normalized, sorted
addresses, plus a count. It contains no address and cannot be tested against guessed addresses without the cookie secret.

- GitHub's copy: the deploy log's step "Inject deployment secrets" prints `allowlist N entries (M malformed), fingerprint <12 hex>`.
- Vercel's copy: the running app logs `{"scope":"auth","event":"allowlist-loaded","entries":N,"malformed":M,"fingerprint":"<12 hex>"}` once when it starts.
  Read it with `vercel logs --deployment <url> --query allowlist-loaded` (or the project's Logs page, filter `allowlist-loaded`) after the first request.
- Same fingerprint: the two copies match. Different: the allowlist **or the cookie secret** differs between Vercel and GitHub; rotate
  both together (see above). `entries: 0` means the allowlist is empty or unset in that copy.
  `malformed` counts entries that are not plain addresses (for example wrapped in quotes or angle brackets from a paste, or with a `mailto:` prefix):
  such an entry can never equal the address someone signs up with, so `malformed` above 0 on the Vercel side is the first thing to fix (set the value
  as bare addresses separated by commas). The deploy check refuses such an entry in GitHub's copy.

This is deliberately not an HTTP endpoint (a public "is this address allowed?" check would be an oracle). Whether the deployed app
admits a particular address is shown by the sign-up events in docs/auth-screens.md ("Why did no code arrive?").

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
- After the gate, the run still checks (once, without waiting) that CI is green on that commit, checks the Vercel variables and that
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
