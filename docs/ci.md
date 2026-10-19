# CI and Actions minutes (#91)

GitHub bills Actions time per job, **rounded up to a whole minute**, from a monthly allowance with no overage budget.
Everything here is built around that.

## Shape

- **One job, named `ci`.** Every extra job pays for checkout, Node and `npm ci` again (about a minute each, rounded) and
  rounding adds up, so splitting costs more minutes than it saves (a four-way split measured about 29 rounded minutes
  against about 20 for one job). Do not split it again without measured minutes. The name is read by the review gate and by
  the production release check.
- **Gitleaks is the first step of that job** (same pinned action, full history), not a separate workflow with its own minute.
- **The preview deploy is a job in the same workflow** (`deploy`, `needs: ci`, only for a push to `develop`) that calls
  `deploy-vercel.yml`. There is no job waiting on CI. Production is still a manual run on `main` by the owner, with the
  typed SHA (docs/deploy.md).
- **Concurrency:** a new push to a pull request cancels its older run. A push to `develop` never cancels a run (it may be deploying).
- vitest uses threads (about 19% less CPU, same tests and coverage). Running the phone and desktop e2e side by side was tried and
  failed on the 2-core runner (the app's server could not keep up, 21 minutes and mass failures), so e2e stays sequential.

## Modes

The first step after install decides what this run does (`scripts/ci-mode.ts`, logic and tests in `src/tooling/ci-mode.ts`):

| Event                       | Mode                | What runs                                                                                                                                                                                                                                            |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft pull request          | `quick`             | gitleaks, repo hygiene, actionlint, workflow contract, audit, lint, typecheck. The job then **ends red on purpose**: "full validation not run".                                                                                                      |
| Ready pull request          | `full`              | everything                                                                                                                                                                                                                                           |
| Push to `develop` or `main` | `full`, or `reused` | `reused` only when the pushed files are byte-identical (same git tree) to the head of a pull request whose latest `ci` run on that exact head is a completed success. Anything uncertain (no pull request, different files, lookup error) is `full`. |
| Anything else               | `full`              | everything                                                                                                                                                                                                                                           |

Full = the quick checks plus unit tests with the 90% coverage gate, both production builds (Turbopack and webpack) each with
the e2e-code and client-bundle secret scans, and phone + desktop e2e (with the a11y checks).

A green `ci` therefore always means the full validation passed for that exact commit, or identical files did.
Marking a draft ready (`ready_for_review`) starts the full run.

## Working with it (this is how to stay cheap)

1. **Open pull requests as drafts.** Push as often as you like; each push costs the quick run (a few minutes), not the full one.
2. **Batch pushes.** Commit locally, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:e2e`
   yourself, and push once when it is coherent. Do not push to see whether CI passes.
3. **Mark ready once, and not in the same minute as a push.** That run is the full validation. (Events can arrive out of order; the mode step reads the live draft flag, but a push and a ready click together still start two runs.) After review feedback, push the fix as one commit.
4. **Rerun failed jobs only when the failure is not yours** (an infrastructure error). A rerun repeats the whole job and bills it
   again. Never rerun to "see if it is flaky": fix or quarantine the flake.
5. Before merging, `npm run ci:gate -- <pr number>` confirms the latest `ci` run on the pull request's head is green.
   Branch protection is not available on this plan, so that, plus review, is the gate.

## Measured minutes

Rounded billed minutes, from each run's usage page.

| Run                             | Before                                                         | After                            |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| Pull request sync               | ~21 (ci 20 + gitleaks 1)                                       | see the pull request description |
| Final-head (ready) pull request | ~21                                                            | see the pull request description |
| Push to `develop`               | ~39 (ci 18, gate 1, deploy 19 mostly idle waiting, gitleaks 1) | see the pull request description |
| Preview deploy alone            | ~20                                                            | see the pull request description |

## Guardrails

`npm run check:workflows` (run in CI, with `actionlint`) fails when: an action is not pinned to a full SHA; `ci.yml` has a job
besides `ci` and `deploy`; a heavy step is not skipped outside full mode or a cheap check is; gitleaks or the audit is
removed; a draft would pass; the deploy does not need `ci` or can run for a pull request; the `ci` job reads a secret;
cancellation could hit a develop run; or the deploy workflow polls or grows a `push` trigger. Each rule has a mutant test in
`src/tooling/workflow-check.test.ts`.
