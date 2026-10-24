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
   gate).

## Overrides

The 64.5.0 graph shipped with known advisories in transitive packages (`tar`, `js-yaml`, `minimatch`, `path-to-regexp`, `smol-toml`,
`ajv`, `undici`, `zod`). `package.json` `overrides` pins each to a fixed release without changing the CLI version: same-major for
the first six, `undici` 5.x to 6.29.1 and `zod` to 4.6.6 (a major jump), which brought `npm audit` to 0 findings. `@fastify/busboy`
drops out of the graph with `undici` 6. After any change here, prove it from the lock: `npm ci --ignore-scripts`, `vercel --version`,
`vercel build --help`, `vercel deploy --help`, and an offline `vercel build` of the app. Re-check the overrides on every CLI upgrade;
drop any the new release no longer needs.
