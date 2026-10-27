# Framebriar: package access and the fake service (#127, #130)

The stable Preview and exact local development origin can send feedback to the shared Framebriar service through its browser
SDK, `@masra91/framebriar`. Production contains no feedback UI or browser SDK. The SDK is private, and this repository
consumes Mason's maintained `0.4.1` GitHub Package directly. It does not copy the package archive, Framebriar service, owner
admin tooling, infrastructure, credentials, invitations or backend configuration into the repository. We consume the SDK and
never change the service here. The contract remains the private source repository's `docs/general-feedback-v2.md` and
`docs/distribution.md`.

Nothing in this repository holds a token, an invitation or an endpoint credential. Every value below is a placeholder. What
is captured, owner setup and the local delivery check are in [feedback.md](feedback.md).

Account-scoped enrollment held on the server (one invitation per account, not per browser) is described in
[framebriar-enrollment.md](framebriar-enrollment.md).

## Installing the package

`package.json` pins `@masra91/framebriar` to exact version `0.4.1`; `package-lock.json` pins the private GitHub Package URL and
npm SHA-512 integrity. The committed `.npmrc` contains only the `@masra91` registry route and `${NODE_AUTH_TOKEN}` placeholder.
It contains no credential. CI supplies a read-only package credential only to `npm ci --ignore-scripts`; the allowlisted,
pinned `esbuild` and `unrs-resolver` lifecycle scripts and the Vercel/Next build run afterward without it. Fork pull requests get no credential and fail closed at install.

The package has no runtime npm dependencies. Published `0.4.1` identifies private source repository `masra91/framebriar` and
source tag `v0.4.1`; the package manifest retains `license: UNLICENSED`. Private-package access is not a credential for the
Framebriar service and does not change the package's stated terms.

Update the exact version deliberately and in its own change after reading the private package changelog. Use an authorized
package-reader route, verify the published version and lockfile integrity, and review the matching private source tag. Never copy
the package archive, Framebriar backend, admin or infrastructure sources, and never add credentials, invitations, tokens or
backend configuration to this repository.

The shared Framebriar backend still owns its Azure Blob storage and the SDK continues to use the existing endpoint/protocol.
This repository neither provisions nor configures Blob storage; runtime service access remains a separate operational setup.

## Preview build and exact-origin boundary

The real feature modules are compiled into Preview, `next dev` and the synthetic e2e build. `next.config.ts` replaces every
app entry point (`FeedbackAccess`, `FeedbackButton`, `FeedbackNotice`, `FeedbackSettings`) with one inert module in Production
and ordinary non-development builds, for both Turbopack and webpack. `npm run check:no-feedback-in-build` proves the UI plus
the access, outbox and local-report SDK chunks are absent after both production builds;
`npm run check:preview-feedback-in-build` proves they are present after either Preview build.

Preview and development have a second, runtime boundary: the provider starts only when `window.location.origin` is exactly
`https://travel-packing-preview.vercel.app` in a Preview build or `http://localhost:8080` in development. Start local work
with `npm run dev -- --hostname localhost --port 8080`. A different host, scheme or port—including arbitrary Vercel Preview
deployment URLs—shows no feedback UI and starts no access controller, IndexedDB outbox or network work. Production's
compile-time replacement is the stronger boundary and its CSP does not allow the Framebriar origin. The stable Preview's CSP
allows only the pinned service endpoint; Azure CORS independently allows only approved app origins.

The e2e build is the sole exception to the port check. It contains the real SDK and talks, through the app's own server, to a
synthetic fake service (see "The e2e upstream seam" below). `NEXT_PUBLIC_E2E_BUILD` is refused in every Vercel environment and
the e2e artifact is never deployed.

## Screenshots: the build switch

Within Preview/local/e2e builds, **screenshot capture** has its own build-time choice,
`FEEDBACK_SCREENSHOTS`:

| Build                                           | Framebriar UI/SDK | Capture code   |
| ----------------------------------------------- | ----------------- | -------------- |
| Stable Preview, exact local development, e2e    | Yes               | Yes by default |
| Production                                      | **No**            | **No**         |
| Preview/local/e2e with `FEEDBACK_SCREENSHOTS=0` | Yes               | No             |

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

Whose reports these are (#260): the browser holds **no Framebriar credential at all**. The enrollment belongs to the signed-in
account and lives on the server ([framebriar-enrollment.md](framebriar-enrollment.md)); delivery goes to the app's own
`/api/feedback/reports`, and the server talks to Framebriar. What is written but not yet sent is kept per account: one IndexedDB
database per account, `framebriar-v1-acct-<outboxKey>`, where `outboxKey` is an opaque value from the server (never the email or
user id). Signing out clears that account's unsent notes and screenshots from the device first (Delete unsent reports in Settings
does the same on request) and nothing is delivered while signed out; the server enrollment is not touched, so signing back in is
still Connected. When the provider mounts it also deletes every other account's database and the old per-browser
`framebriar-enrollment-*` / `framebriar-v1-outbox-*` ones, so an account switch without a sign-out click (an expired session)
cannot leave the first account's reports for the second. A queued report is never submitted through another account's session.
Cleared browser storage loses only unsent reports; the account stays connected and a second device needs no new invitation.
The screen shows truthfully: not connected, connected, expired, ended, switched off, rate limited, offline, unavailable (including a
server without its key ring) and needs reconnect.

1. **Saved on this device.** Send prepares the report with the SDK (`prepareLocalFeedback`) and commits it to the durable outbox
   (`createDurableFeedback`, IndexedDB, 10 reports / 32 MiB, kept until delivered or cleared). Only a committed save says "Saved".
   Storage full, unavailable or unconfirmed say so and keep the notes; a retry after an unconfirmed save reuses the same report id,
   so it cannot duplicate. Cancel while saving abandons an uncommitted save.
2. **Received.** The outbox delivers later, with persisted backoff, resuming when the connection comes back (online event, connected
   status, page shown). The service's confirmation turns the open sheet into "Received. Thank you." or raises a toast.

Annotation (#266). The review sheet shows the screenshot large (`ScreenshotEditor.tsx`) and the person can mark it. The marks are plain
data in the picture's natural pixels (`annotation-model.ts`: four inks, Undo / Clear drawing with Undo restoring a Clear, bounds on
strokes and points, pointer to natural-pixel mapping with letterboxing, stroke width = 4 CSS px as shown). They live only in the open
sheet's React state, keyed by the outbox scope (`use-annotation-draft.ts`), so cancel, sign-out, an account switch or a second sheet can
never show or attach them; nothing is stored. At Send, `annotation-final.ts` makes the one decision before anything reaches the route or
the outbox: no picture (unticked: nothing is composited), the reviewed Blob untouched (no marks), or `annotation-composite.ts` draws the
strokes (two rings under the ink, so they show on light and dark pictures) onto the natural-size image and exports a PNG. A result that is
not **strictly under** 4,000,000 bytes (`screenshot-limit.ts`) is refused with a recoverable message; it is never shrunk, cropped, sent
without its marks or replaced. The feature is Preview-only like the rest of the feedback UI (the editor has a build marker, so the
Production absence check covers it and the Preview positive check requires it).

What a report may contain (`capture-policy.ts`): the person's notes, an optional screenshot, and approved codes and numbers only: the
screen code (`trips`, `new-trip`, `trip`, `review`, `staples`, `other`; never the path), a viewport class, the input kind, the app
version, the capture time. No trip names, places, dates, emails or ids. The sheet lists what is sent. Capture is blocked on Settings
and the sign-in and account screens, in the entry point, the sheet context and the capture code itself.

Screenshots follow the build switch above: ticked by default where the Preview/local/e2e build has them (the capture is taken before
the sheet opens so the sheet is not in it). The capture uses `html-to-image` (MIT), imported only by the capture module, so it
is absent from Production bundles.

## The fake Framebriar service (tests only)

`src/test/fake-framebriar.ts` is an in-process stand-in for the service. It answers the SDK's wire contract: invitation
redeem, refresh, disconnect, report intake, media upload with an upload ticket, and CORS. It validates reports with the SDK's own
`normalizeReport`, so tests exercise the real SDK against it.

- **Two layers.** Unit tests (`src/test/fake-feedback-server.ts` for the app's own routes, this file for the wire) run in process. The
  e2e run uses the same wire fake as a small separate process (below).
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

A real end-to-end delivery is a manual check at the stable Preview or exact local origin `http://localhost:8080`, after
invitation creation is separately approved. The fake proves the protocol without real user data but is never a substitute for
that bounded check.

## The e2e upstream seam (#260)

The server's Framebriar client talks to one pinned address. In the **e2e build only** (`NEXT_PUBLIC_E2E_BUILD=1`),
`src/server/feedback/e2e-upstream.ts` sends calls to that address to `http://127.0.0.1:$E2E_FRAMEBRIAR_PORT/api` instead (any other
URL is refused), and lifts the per-account redemption limit, because the run connects the same accounts repeatedly. The fake is
`tests/e2e/support/fake-framebriar-server.ts`, a Node process wrapping `createFakeFramebriar()` with control routes under
`/__control/` (health, reset, invite, fail-next, revoke-all, offline, enrollment-ms, counts, delivered), started by Playwright on
`E2E_PORT + 300`. `next.config.ts` resolves the module to `e2e-upstream.disabled.ts` (which returns nothing) in every other build,
and `npm run check:no-e2e-in-build` fails a build that contains its marker `e2e-framebriar-upstream`. The browser needs no routing
any more, so `routeFramebriar` is not used by the feedback specs.
