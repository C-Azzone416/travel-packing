# End-to-end tests (#98)

Two Playwright projects, run as two parallel CI jobs on separate runners from one shared build (docs/ci.md):

| Project   | Browser                                      | What runs                                                        |
| --------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `desktop` | Chromium, 1440×1000                          | **Every** spec.                                                  |
| `phone`   | WebKit with Playwright's `iPhone 15` profile | Only the specs tagged `@device` (`tests/e2e/helpers/device.ts`). |

`phone` is a real phone, not a narrow window: WebKit (the engine of every iPhone browser), a mobile user agent, touch, a 3× pixel
ratio and the Safari viewport (393×659). The app's logic and data flows are the same on every device, so they run once, on desktop.
A spec earns `@device` only when a phone-shaped browser can catch something Chromium at 1440px cannot: layout, tap target size,
overflow, the bottom navigation and sheets, accessibility at phone size, the numeric keypad, or the golden path.

Tag a spec with `test("...", DEVICE, async ...)` or `test.describe("...", DEVICE, () => ...)`. CI fails if the projects in
`playwright.config.ts` and the CI matrix ever differ.

## Timeouts, retries and "flaky" (#120)

CI prints every test with its duration (the `list` reporter) and keeps a trace for each failed attempt in the uploaded
`playwright-report-*` artifact. The `phone` project allows 60 s per test (WebKit on a shared runner is slower than Chromium; `expect`
timeouts are unchanged) and retries a failed test once in CI. A test that fails and then passes is reported as **flaky** in the run's
summary. A "flaky" result means **file an issue or fix the test, not ignore it**: the retry only keeps one slow runner from blocking a
merge, it does not make the test sound.

## Run it locally

```
npx playwright install chromium webkit     # once
npm run build:e2e                          # the build both projects use; or let test:e2e build it
npm run test:e2e                           # both projects (what `npm run verify` runs)
npm run test:e2e -- --project=phone        # just the phone specs (WebKit)
E2E_PREBUILT=1 npm run test:e2e            # start the existing build instead of building again
```

## What runs on `phone`, and why (83 tests)

| Spec                          | Tests | Why it is device-sensitive                                                                                                                                  |
| ----------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a11y.spec.ts`                |    34 | axe on every screen and state at phone size, incl. 320px and 200% text; all but the keyboard-only group (no keyboard on a phone)                            |
| `golden-path.spec.ts`         |     1 | **The golden path**: sign in, create a trip, pack it, review the bag, mark it Ready, still Ready after a reload                                             |
| `shell.spec.ts`               |     5 | navigation, 44px targets, no sideways scroll at 320px, bottom bar vs side rail, screenshots                                                                 |
| `auth.spec.ts`                |     5 | the sign-in screens: no app chrome, 44px targets, field widths, screenshots                                                                                 |
| `auth-screens.spec.ts`        |     6 | the account screens: reachable and outside the shell, 44px targets, axe and screenshots of every state, the numeric-keypad code field                       |
| `dashboard.spec.ts`           |     4 | 320px with a quick view, 44px controls, the hero on phones, screenshots                                                                                     |
| `trip-screen.spec.ts`         |     4 | rows 44px and 320px, the sheet's close button and the bag button not wrapping, screenshots                                                                  |
| `review.spec.ts`              |     2 | 44px targets, screenshots                                                                                                                                   |
| `staples.spec.ts`             |     2 | 44px targets, screenshots                                                                                                                                   |
| `create-flow.spec.ts`         |     2 | switches 44px and no sideways scroll at 320px, screenshots                                                                                                  |
| `trip-themes.spec.ts`         |     2 | the picker at 320px, screenshots                                                                                                                            |
| `trip-persistence.spec.ts`    |     2 | the theme sheet (a bottom sheet on phones): where it sits, focus returning to the button                                                                    |
| `location-modes.spec.ts`      |     2 | the picker's spacing keeps the focus ring uncovered, screenshots                                                                                            |
| `settings.spec.ts`            |     1 | Settings copy and layout at both sizes                                                                                                                      |
| `feedback-connection.spec.ts` |     3 | Settings and the access notice at phone size (a bottom navigation, full-width buttons), axe, and no Feedback entry point on the sign-in and account screens |
| `feedback-report.spec.ts`     |     2 | the review sheet as a bottom sheet, and the real screenshot capture in WebKit, saved offline and delivered on reconnect                                     |
| `parity.spec.ts`              |     1 | a tour of every screen raises no browser errors in the Safari engine                                                                                        |

Not on phone (desktop only): create, copy, archive, remove, pack, review and Ready logic, persistence, location-provider
behaviour, security headers, auth logic, keyboard-only checks, and the theme-art crops.

## Tests that branch on the project

Every test that reads `testInfo.project.name === "phone"` (or `"desktop"`) is tagged `@device`, so it still runs on phone:

| Test                                                                      | Branch                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.spec.ts` navigation is a bottom bar on phones, a rail on desktop   | which navigation is shown                                                                                                                         |
| `trip-persistence.spec.ts` changing the theme from the trip header        | the sheet is inside the viewport on phone only                                                                                                    |
| `auth-screens.spec.ts` controls are 44px targets on phone                 | phone-only size assertion                                                                                                                         |
| `review.spec.ts` every control on the review is a 44px target on phone    | phone-only size assertion                                                                                                                         |
| `settings.spec.ts` no Offline, Waiting or simulated-sync copy             | layout differs by size                                                                                                                            |
| `trip-screen.spec.ts` a sheet can be closed with its visible close button | the bag button fills the card on phone only                                                                                                       |
| `staples.spec.ts` controls are 44px targets on phone                      | phone-only size assertion                                                                                                                         |
| `dashboard.spec.ts` on phones the hero sun clears the hero text           | skipped on desktop (`test.skip(project !== "phone")`)                                                                                             |
| `feedback-report.spec.ts` capture, save offline, deliver                  | Playwright's WebKit keeps storage in memory and cannot store a picture in IndexedDB (real Safari can), so on phone the saved report is notes-only |
| `theme-art.spec.ts` theme art crops                                       | desktop only by design ("one set is enough"); never on phone                                                                                      |

The tests that name the project only to build a unique email or a screenshot file name (`ownerEmailFor(project.name)`) are unaffected.

## Real Safari findings, fixed rather than skipped

Running the device specs in WebKit found four things Chromium could not:

1. **Focus did not return to the control that opened a sheet.** Safari does not focus a button when it is tapped, so the sheet
   remembered `<body>` or `<main>`. `ModalSheet` now remembers the pressed control (a real accessibility bug for Safari users).
2. **The code step could not be verified.** The "pending email" cookie was `Secure`, and the e2e build serves plain
   `http://localhost`, where Chromium accepts a Secure cookie and WebKit refuses it. The e2e build (which no deployed build is)
   now sets it without `Secure`; every deployed build still sends it `Secure` (unit-tested).
3. **axe misread labels below the fold** of a bottom sheet on a 659px-tall screen ("form element has no visible label" for a
   labelled switch), and read text mid fade-in as low contrast. The accessibility helper now waits for animations and re-checks a
   flagged element after scrolling it into view; a real violation still fails (`a11y-helper.spec.ts`).
4. **Next's prefetches, cancelled by a hard navigation**, surface as an unhandled "Fetch API cannot load ... access control checks".
   That is the browser unloading the page, not an app fault; the tour now lets the page go idle before each hard navigation.

## Feedback specs and the fake Framebriar process (#260)

The `feedback-*.spec.ts` files drive the real app and server. The app's **server** talks to a fake Framebriar, a separate process
Playwright starts on `E2E_PORT + 300` (default 3400) through the e2e-only upstream seam; the specs steer it over
`/__control/` from `tests/e2e/helpers/feedback.ts` (`fakeFramebriar.reset()`, `issueInvitation()`, `failNext()`, `setOffline()`,
`revokeAll()`, `counts()`, `delivered()`). The e2e server has a `FRAMEBRIAR_CREDENTIAL_KEYS` key ring so the enrollment feature is on.
`feedback-annotation.spec.ts` (#266) draws on the screenshot (touch pointer events on the phone, a mouse on desktop) and, on desktop, decodes the PNG the fake service received and proves it is the reviewed picture plus the stroke (no pixel outside the stroke's area differs; the ink and both edge rings are at the stroke). The fake is started with `keepMedia` so the uploaded bytes are available (`/__control/media`). WebKit cannot store a picture in IndexedDB, so the delivery proof is desktop-only. `feedback-annotation-shots.spec.ts` renders the design screenshots (opt-in: `FEEDBACK_ANNOTATION_SHOTS=<folder>`).
`feedback-accounts.spec.ts` covers shared-browser account switching, sign-out clearing, cleared-storage recovery and a second device.
See [framebriar.md](framebriar.md#the-e2e-upstream-seam-260).
