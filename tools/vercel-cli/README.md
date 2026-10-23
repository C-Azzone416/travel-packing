# The locked Vercel CLI (#208)

The deploy workflow runs the Vercel CLI in steps that hold a production-capable `VERCEL_TOKEN`. A top-level version pin does not
fix the CLI's transitive dependencies, so this directory is its own small package: `package.json` names the one version,
`package-lock.json` locks the whole graph with an integrity hash for every package. The workflow installs it with
`npm ci --prefix tools/vercel-cli --ignore-scripts` and puts `node_modules/.bin` on the PATH; it never runs `npm install`, a global
install or `npx` for the CLI, so nothing is resolved after the locked install. `workflow-check.ts` (run by `npm run check:workflows`
and the unit tests) fails if the workflow, `package.json`, the lockfile and the `VERCEL_CLI_VERSION` pin in the workflow disagree,
if any locked package has no integrity hash or comes from outside the npm registry, or if a global or unlocked install comes back.

## Upgrading

1. Change the version here and `VERCEL_CLI_VERSION` in `.github/workflows/deploy-vercel.yml` together.
2. `cd tools/vercel-cli && npm install --package-lock-only --ignore-scripts`
3. Read the lockfile diff and `npm audit` for the new graph before merging (this directory is outside the app's `npm audit --omit=dev`
   gate). At 64.5.0 the graph carries known advisories in transitive packages of the CLI itself (for example `tar`, `smol-toml`,
   `js-yaml`, `minimatch`); `npm audit fix` suggests an older major, which is not a fix. Newer releases are not clean either, so the
   advisories are tracked as a finding, not blocked on.
