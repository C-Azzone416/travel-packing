# Contributing

## Branches

- `main` is production. Never push to it directly.
- `develop` is the integration branch. All PRs target `develop`.
- Work branches are named `<agent>/<issue#>-<slug>`, cut from `develop`
  (for example `dev1/2-scaffold`).
- One agent per issue.

## Pull request flow

1. Open a PR into `develop`. The description says `Closes #<n>` and uses the
   PR template.
2. **QA** reviews (approve or reject; fix and repeat until approved).
3. **Design** reviews any PR labeled `needs-design-review`.
4. **Judge** posts `JUDGE: APPROVED` on the PR. Nobody skips the judge.
5. The dev or PM squash-merges once CI is green, then deletes the remote branch.

## Quality rules

- CI must be green: lint, typecheck, tests, and build.
- Coverage must be at least 90% for lines, branches, functions, and statements
  on all new code.
- `reference/` is read-only and excluded from build, lint, and coverage.

## Secrets and data

- Never commit secrets, tokens, keys, or `.env` files. Secret values live only
  in GitHub Actions secrets and Vercel environment variables.
- Never put real trip data, or exact dates and locations, in code, fixtures,
  logs, screenshots, or client bundles. Use synthetic sample data.
