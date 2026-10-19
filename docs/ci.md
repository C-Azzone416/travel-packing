# CI layout (#87)

One workflow, `.github/workflows/ci.yml`, runs these jobs at the same time wherever the arrows allow. Healthy, the whole thing takes
well under ten minutes (it used to be one 18-minute serial job that twice hit its timeout).

```text
checks ─────────────────────────────┐
unit ───────────────────────────────┤
build ──────────────────────────────┼──> ci   (the one required check)
e2e-build ──> e2e (phone)   ────────┤
          └─> e2e (desktop) ────────┘
```

| Job         | What it does                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks`    | repo hygiene, actionlint, the workflow contract, the dependency audit, lint, typecheck                                                                                                           |
| `unit`      | unit and integration tests with the 90% coverage gate (lines, branches, functions, statements)                                                                                                   |
| `build`     | the production build with each bundler (Turbopack, webpack), each followed by the "no e2e-only code" and the client-bundle secret scans. Built exactly as production builds, with no test flags  |
| `e2e-build` | the app built once WITH the e2e-only sign-in and database driver (`NEXT_PUBLIC_E2E_BUILD=1`), uploaded as an artifact for the e2e jobs. It is never the production build, and nothing deploys it |
| `e2e`       | a matrix of `phone` and `desktop`, each on its own runner with its own in-memory database, downloading the `e2e-build` artifact (no rebuild), with the Playwright browsers cached by version     |
| `ci`        | the **only** check branch protection requires and the deploy waits on. It runs even if something above failed (`if: always()`) and passes only when every job above succeeded                    |

## Why the build is made twice

The browser tests need the e2e-only sign-in compiled in; a deployable build must have it compiled out, and a scan proves that. They are
different builds on purpose, so `build` (production) and `e2e-build` (test) run side by side instead of one reusing the other.

## What to know

- **Required check:** keep `ci` as it is. Adding, removing or renaming the other jobs does not change what is required, as long as `ci`
  lists them in `needs` (`npm run check:workflows` fails if it forgets one, or loses `if: always()`, because a skipped required check
  counts as a pass).
- **Playwright reports** are uploaded per project: `playwright-report-phone` and `playwright-report-desktop` (each holds that
  project's `test-results/`, including the named screenshots, whose file names already start with the project).
- **Running one project locally:** `npx playwright test --project=phone`. Setting `E2E_PREBUILT=1` starts an existing build instead of
  building (CI uses it with the downloaded artifact).
- **Playwright browsers** are cached under `~/.cache/ms-playwright`, keyed by the Playwright version; `--with-deps` still installs the
  system libraries on every run.
- **Timeouts** are per job and nest with the deploy's wait for CI (see the deploy runbook).
