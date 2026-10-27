# CI (#3, #91, #98)

The repository is public, so standard GitHub-hosted runner minutes are free. CI is built for **wall-clock time** without
weakening a gate. (While the repo was private it was built to spend as few billed minutes as possible; that history is why
the mode logic below exists, and it still saves time.)

## Shape

Parallel jobs in one workflow (`.github/workflows/ci.yml`):

| Job         | Runs in                 | What                                                                                                                                                                                                                                       |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`      | every run               | Decides `quick`, `full` or `reused` (below). Every heavy job waits for it, so they can never disagree.                                                                                                                                     |
| `checks`    | every run, at once      | gitleaks (full history, first), repo hygiene, actionlint, workflow contract, dependency audit, lint, typecheck.                                                                                                                            |
| `unit`      | full                    | Unit tests with the 90% coverage gate.                                                                                                                                                                                                     |
| `build`     | full                    | The production builds (Turbopack and webpack), each with the e2e-code check and the client-bundle secret scan.                                                                                                                             |
| `e2e-build` | full                    | The app built WITH the e2e-only code (`npm run build:e2e`), uploaded once as a one-day artifact. Never deployed.                                                                                                                           |
| `e2e`       | full, after e2e-build   | Phone (a real iPhone profile in **WebKit**, the `@device` specs) and desktop (**Chromium**, every spec), **at the same time, each on its own runner** with its own in-memory database; both download the build. See [docs/e2e.md](e2e.md). |
| `ci`        | always (`if: always()`) | **The one required check.** Needs every job above; see below.                                                                                                                                                                              |
| `deploy`    | push to `develop` only  | `needs: ci`, calls `deploy-vercel.yml`. Nothing waits idle for CI. Production stays a manual, owner-only, SHA-typed run.                                                                                                                   |

- **`ci` is the stable name** read by the review gate (`npm run ci:gate`), the production release check and the deploy. Adding or
  renaming the jobs above it never changes what is required. It decides from the mode: **full** needs every job `success` (a
  skipped or cancelled job is a failure); **reused** needs `mode` and `checks` to succeed, and the heavy jobs skipped on purpose
  (or successful); **quick** (a draft) is always red. `src/tooling/workflow-check.test.ts` runs the real step script for every
  combination.
- Running phone and desktop on **one** 2-core runner was tried (#91) and broke the app's server; separate runners are what make
  the split work. The browser download is cached by Playwright version.
- **Concurrency:** a new push to a pull request cancels its older run. A push to `develop` never cancels a run (it may be deploying).
- vitest uses threads (about 19% less CPU, same tests and coverage).
- Root dependency installs use the run's short-lived `GITHUB_TOKEN` with `packages: read` to fetch the private Framebriar SDK.
  That token is supplied only for pushes and same-repository pull requests; a fork receives an empty package token and fails
  closed instead of receiving the private package. The deploy still runs only for a push to `develop`.
- `npm run check:workflows` enforces all of this with a mutant test per rule: the job set, every heavy job gated on the mode, gitleaks
  first, the e2e matrix being exactly phone and desktop on separate runners, the artifact being named, hidden-file-inclusive and
  one-day, the production build never carrying the e2e flag, and the deploy workflow never touching an artifact.

## Modes

The `mode` job decides what this run does (`scripts/ci-mode.ts`, logic and tests in `src/tooling/ci-mode.ts`):

| Event                       | Mode                | What runs                                                                                                                                                                                                                                            |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft pull request          | `quick`             | gitleaks, repo hygiene, actionlint, workflow contract, audit, lint, typecheck. The job then **ends red on purpose**: "full validation not run".                                                                                                      |
| Ready pull request          | `full`              | everything                                                                                                                                                                                                                                           |
| Push to `develop` or `main` | `full`, or `reused` | `reused` only when the pushed files are byte-identical (same git tree) to the head of a pull request whose latest `ci` run on that exact head is a completed success. Anything uncertain (no pull request, different files, lookup error) is `full`. |
| Anything else               | `full`              | everything                                                                                                                                                                                                                                           |

**The reuse rule needs the pull request to be up to date with develop when it is merged.** A pull request's `ci` run
validates the merge of its head with develop as it was at that moment, and a squash merge produces the same files as the
head only when develop has not moved since the head last contained it. If develop moved, the trees differ, the mode is
`full`, and nothing is reused (that is what happened on `6125273`). `src/tooling/ci-mode-squash.test.ts` proves both cases with
real git, including that the pull request's head is fetched by id into a clone that never had it.

Full = the quick checks plus unit tests with the 90% coverage gate, both production builds (Turbopack and webpack) each with
the e2e-code and client-bundle secret scans, and phone + desktop e2e (with the a11y checks), all as parallel jobs.

A green `ci` therefore always means the full validation passed for that exact commit, or identical files did.
Marking a draft ready (`ready_for_review`) starts the full run.

## Verify locally first (#95)

CI confirms; it is not where bugs are found.

- `npm run verify` runs what full-mode `ci` runs, cheapest first, stopping at the first failure: gitleaks (only if installed
  here; otherwise it says plainly that it was skipped), repo hygiene, actionlint (same rule), workflow contract, audit, lint,
  typecheck, unit tests with the 90% coverage gate, both production builds with their bundle scans, the e2e build, and phone + desktop e2e
  run one after the other from that build (`CI=1`, default port 3102; an `E2E_PORT` / `E2E_DB_PORT` already set in your environment wins, so two verifies on one machine can run side by side: `E2E_PORT=3199 E2E_DB_PORT=5699 npm run verify`). It ends with a short summary naming the head commit; paste it into the pull request.
- `npm run verify:quick` is everything before the builds (it still includes the unit tests and coverage gate).
- A **pre-push hook** runs `verify:quick`. `npm install` turns it on (`prepare` points git at `.githooks`); nothing to
  install by hand and no dependency. Emergency bypass: `git push --no-verify`, then run `npm run verify` yourself before
  marking the PR ready.
- `check:workflows` (so CI too) fails when `ci.yml` and `verify` run different checks or in a different order (`build:e2e`, then `test:e2e`), so they cannot
  drift. Adding a check means adding it to both (`src/tooling/verify.ts`).
- The local run is in addition to CI, never instead of it.

## Working with it

1. **Run `npm run verify` before you mark a PR ready**, and paste its summary in the pull request template's line. CI confirms;
   it is not where bugs should be found, and a red full run costs everyone the wait.
2. **Open pull requests as drafts.** Each push runs the quick checks only (a couple of minutes), not the full run.
3. **Batch pushes.** Commit locally, let the pre-push hook run, and push when it is coherent.
4. **Mark ready once, and not in the same minute as a push.** That run is the full validation. (Events can arrive out of
   order; the mode job reads the live draft flag, but a push and a ready click together still start two runs.)
5. **Rerun failed jobs only when the failure is not yours** (an infrastructure error). Never rerun to "see if it is flaky":
   fix or quarantine the flake.
6. Before merging, `npm run ci:gate -- <pr number>` confirms the latest `ci` run on the pull request's head is green.
   Branch protection is not available on this plan, so that, plus review, is the gate.

## Wall time

Before: a full `ci` run took about 19 minutes (one serial job, develop `6125273`).

After (first green run on the parallel jobs, PR #104): **8 min 21 s** end to end. Per job (start offset, duration):

| Job             | Starts at | Takes |
| --------------- | --------: | ----: |
| `mode`          |      +3 s |  46 s |
| `checks`        |      +3 s |  71 s |
| `build`         |     +52 s |  77 s |
| `unit`          |     +51 s | 152 s |
| `e2e-build`     |     +52 s |  66 s |
| `e2e (desktop)` |    +120 s | 325 s |
| `e2e (phone)`   |    +120 s | 376 s |
| `ci`            |    +498 s |   2 s |

The critical path is `mode` (46 s) then `e2e-build` (66 s) then the slower e2e job. Everything else finishes inside it.

## Guardrails

`npm run check:workflows` (run in CI, with `actionlint`) fails when: an action is not pinned to a full SHA; `ci.yml` has a job
outside the set above; a heavy job is not gated on the mode or a cheap check is; gitleaks or the audit is weakened; the `ci`
summary does not need every job, can be skipped, or would pass a draft; the e2e matrix is not exactly phone and desktop on
separate runners, or one of them is sharded or serialised; the production build carries the e2e flag or uploads anything;
the e2e artifact is wrong; any job reads a secret but `GITHUB_TOKEN`, or uses `continue-on-error`; the deploy does not need
`ci` (and only `ci`), can run for a pull request, or polls; or the deploy workflow touches an artifact or grows a `push`
trigger. Each rule has a mutant test in `src/tooling/workflow-check.test.ts`.
