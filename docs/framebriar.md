# Framebriar: package access and the fake service (#127, #130)

The app sends feedback to the shared Framebriar service through its browser SDK, `@masra91/framebriar`. The SDK is private.
As a temporary CI workaround, this public repository vendors only the exact `0.4.1` npm distributable at
`vendor/framebriar/framebriar-0.4.1.tgz`. It does not include the Framebriar service, owner admin tooling, infrastructure,
credentials, invitations or backend configuration. We consume the SDK and never change the service here. The contract remains
the private source repository's `docs/general-feedback-v2.md` and `docs/distribution.md`.

Nothing in this repository holds a token, an invitation or an endpoint credential. Every value below is a placeholder.

## Installing the package

`package.json` pins the dependency to `file:vendor/framebriar/framebriar-0.4.1.tgz`; `package-lock.json` pins that archive's
npm SHA-512 integrity. A normal `npm ci` installs it without `.npmrc`, `GITHUB_PACKAGES_TOKEN`, `packages: read`, or access to
the private repository. The vendored artifact's source tag, commit, license, size and hashes are recorded in
[`vendor/framebriar/README.md`](../vendor/framebriar/README.md).

The package has no runtime npm dependencies. Its 32 extracted files match a fresh SDK build from private source tag `v0.4.1`
byte-for-byte. The package manifest retains `license: UNLICENSED`; vendoring it does not make it open-source.

Update the archive deliberately and in its own change after reading the private package changelog. Use an already-authorized
source route, compare the published distributable with the matching source tag, and update the archive and every provenance
value together. Never copy the Framebriar backend, admin or infrastructure sources, and never add credentials, invitations,
tokens or backend configuration to this repository.

The shared Framebriar backend still owns its Azure Blob storage and the SDK continues to use the existing endpoint/protocol.
This repository neither provisions nor configures Blob storage; runtime service access remains a separate operational setup.

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
