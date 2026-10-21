# Framebriar: package access and the fake service (#127, #130)

The app sends feedback to the shared Framebriar service through its browser SDK, `@masra91/framebriar`. The SDK is a **private**
npm package on GitHub Packages (`masra91/framebriar`). We consume it and never change that repository or the service. The
contract is that repository's `docs/general-feedback-v2.md` and `docs/distribution.md`.

Nothing in this repository holds a token, an invitation or an endpoint credential. Every value below is a placeholder.

## Installing the package

`.npmrc` is committed and holds only the registry for the `@masra91` scope and a placeholder for the token:

```ini
@masra91:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

The SDK version is pinned exactly in `package.json` (`0.4.1`) and in `package-lock.json`. Update it deliberately, in its own
change, after reading that package's changelog.

**Locally.** Export a token that can read the package, then install as usual:

```sh
export GITHUB_PACKAGES_TOKEN=$(gh auth token)   # a classic PAT with read:packages also works
npm ci
```

`gh auth token` works when the account behind `gh` can read `masra91/framebriar` and its token includes `read:packages`
(`gh auth refresh -s read:packages` adds it). Put the `export` in your shell profile, never in a file in this repository.
Without it, `npm ci` fails with a 401 for that one package. The pre-push hook and `npm run verify` do not install anything,
but they need the package to be present in `node_modules`.

**In CI and deploy.** The `npm ci` step of every job in `ci.yml` and `deploy-vercel.yml` sets
`GITHUB_PACKAGES_TOKEN: ${{ github.token }}` (and nothing else does), and the workflows grant `packages: read`.
`npm run check:workflows` fails if an install step lacks the token, if any other step gets it, or if an installing job cannot
read packages. We do not use `actions/setup-node`'s `registry-url`: it writes a second `.npmrc` that fights this one and makes
GitHub Packages the default registry for every dependency.

**Owner step (blocks CI).** The package's settings, **Manage Actions access**, must list `C-Azzone416/travel-packing` with read
access. Until it does, the GitHub token gets a 401 on the package and every CI install fails. Vercel itself never installs: the
deploy builds in Actions with `vercel build` and uploads the result, so the Vercel project needs no token.

## Screenshots: the build switch (Production never captures)

Feedback (notes and approved context codes) ships in every environment, Production included. Only **screenshot capture** is a
build-time choice, `FEEDBACK_SCREENSHOTS`:

| Build                                   | Capture code in the bundle                  |
| --------------------------------------- | ------------------------------------------- |
| Local development, e2e, Preview deploys | Yes (the default)                           |
| Production (`VERCEL_ENV=production`)    | **Never.** Forced off, whatever else is set |
| Anywhere with `FEEDBACK_SCREENSHOTS=0`  | No                                          |

When off, `next.config.ts` resolves `@/features/feedback/screenshot-capture` to `screenshot-capture.disabled.ts` (the same
mechanism as the e2e-only modules, for both Turbopack and webpack), so the capture code is not in the bundle at all. Import the
module only by that exact specifier. Guards:

- `npm run build:production` and `npm run build:webpack` build with `VERCEL_ENV=production`; CI and `npm run verify` then run
  `npm run check:no-capture-in-build`, which fails if the module's marker is in `.next`.
- The production deploy builds with `FEEDBACK_SCREENSHOTS=0`, and `check-deploy-env` fails a production environment where the
  variable is set to anything but `0`. A preview may set it to `0` or `1`.

## Sending a report (#132)

The header's Feedback button opens the review sheet (design's #129 section 4). Nothing leaves the device until the person presses
Send, and saving and delivering are different steps with different words:

1. **Saved on this device.** Send prepares the report with the SDK (`prepareLocalFeedback`) and commits it to the durable outbox
   (`createDurableFeedback`, IndexedDB, 10 reports / 32 MiB, kept until delivered or cleared). Only a committed save says "Saved".
   Storage full, unavailable or unconfirmed say so and keep the notes; a retry after an unconfirmed save reuses the same report id,
   so it cannot duplicate. Cancel while saving abandons an uncommitted save.
2. **Received.** The outbox delivers later, with persisted backoff, resuming when the connection comes back (online event, connected
   status, page shown). The service's confirmation turns the open sheet into "Received. Thank you." or raises a toast.

What a report may contain (`capture-policy.ts`): the person's notes, an optional screenshot, and approved codes and numbers only: the
screen code (`trips`, `new-trip`, `trip`, `review`, `staples`, `other`; never the path), a viewport class, the input kind, the app
version, the capture time. No trip names, places, dates, emails or ids. The sheet lists what is sent. Capture is blocked on Settings
and the sign-in and account screens, in the entry point, the sheet context and the capture code itself.

Screenshots follow the build switch above: ticked by default where the build has them (the capture is taken before the sheet opens so
the sheet is not in it), absent in Production. The capture uses `html-to-image` (MIT), imported only by the capture module, so it is
absent from production bundles too.

## The fake Framebriar service (tests only)

`src/test/fake-framebriar.ts` is an in-process stand-in for the service. It answers the SDK's wire contract: invitation
redeem, refresh, disconnect, report intake, media upload with an upload ticket, and CORS. It validates reports with the SDK's own
`normalizeReport`, so tests exercise the real SDK against it.

- **No network.** The SDK pins its endpoint (`FEEDBACK_ENDPOINT`) and refuses any other, so a test never repoints the SDK. Unit tests
  pass `fake.fetch` as the SDK's `fetchImpl` (and stub the global `fetch` for report delivery). E2E specs call
  `routeFramebriar(context, fake)` from `src/test/fake-framebriar-playwright.ts`, which answers every request to the pinned
  address from the fake inside the Playwright process.
- **Failure modes.** `failNext(route, { kind: "status", status: 429, retryAfterSeconds: 5 })`, `{ kind: "network" }` and
  `{ kind: "malformed" }` for `redeem`, `refresh`, `disconnect`, `report` and `media`; `setOffline(true)`; `revokeAll()`; an
  injectable clock for expiry.
- **Privacy.** It records method, route and status only (never a token, invitation, note or body), and it never logs.
- **It cannot ship.** Nothing in `src/app`, `src/features` or `src/server` imports it. The client-bundle scan
  (`npm run check:client-bundle`) fails the build if its marker, a Framebriar-related secret name (`GITHUB_PACKAGES_TOKEN`,
  `NODE_AUTH_TOKEN`) or a GitHub/npm token shape appears in a client bundle. An invitation looks like any 43-character
  base64url string, so it has no scan pattern; the rule is that nothing stores one, and the SDK clears it after redeeming.
- **Types.** The SDK ships plain `.mjs`; `src/types/framebriar-sdk.d.ts` declares the parts this repository uses. Extend it as the
  integration grows.

A real end-to-end delivery is a manual Preview check with an invitation Caroline issues (#133); the fake is never a substitute.
