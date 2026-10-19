# Account screens: sign-up, verification, forgot and reset password (#27)

The app has one owner (or a few). These screens let that person create an account, confirm their address, and recover a
forgotten password. They sit **outside the signed-in shell** (the proxy marks them, like `/sign-in`). They do not grant access:
the two server controls from #9 are unchanged and still decide everything.

## What gates access (unchanged, and pinned by tests)

1. **`emailVerified === true`** in the Neon adapter (`src/server/auth/neon-adapter.ts`). A user with `false`, `null`, a missing
   value or a non-boolean has no session at all.
2. **The session email must be in `OWNER_EMAIL_ALLOWLIST`** (`guard.ts`), checked at the proxy and again in every data-layer
   entry point.

`src/server/auth/unverified-denial.test.ts` runs an allowlisted address with `emailVerified` false / null / missing / `"true"` / `1`
through page routes (proxy), API routes, the place-search route, server actions (`withOwner`), the data layer (`run`, which is
refused before the database is touched) and sign-in. Nothing here weakens either control: signing up, verifying and resetting
never create a session on their own, and a verified address that is not allowlisted is signed straight back out.

## Screens and routes (all public)

| Route                     | What it does                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/sign-up`                | Email + password. Always continues to `/verify`.                                                                                           |
| `/verify`                 | Enter the 6-digit code. "Send a new code" with a 30-second gap. "Use a different email" goes back to sign-up.                              |
| `/forgot-password`        | Email, then always "Check your email". "Send it again" with the same 30-second gap.                                                        |
| `/reset-password?token=…` | Choose a new password. A missing, wrong, expired or used token shows "This link isn’t valid" with no form.                                 |
| `/sign-in`                | Gains "Forgot password?", "Create an account", and a status notice (`?notice=password-updated` or `verified`; any other value is ignored). |

The address being verified is remembered in a 30-minute `httpOnly` cookie (`cw-pending-email`), never in the URL, so it does not end up
in history, a shared link or an access log. It grants nothing. With no cookie, `/verify` asks for the address as well.

## Enumeration safety

- **Sign-up** for an address that already has an account looks like any other sign-up (the provider reports success without sending a
  code, and the adapter treats every client error except "password refused" as success).
- **Addresses not on the allowlist** get the identical screens, copy and (with the timing floor) timing, but **nothing is created,
  mailed or verified**: only allowlisted addresses ever reach the provider. Their code step simply never succeeds ("That code isn't
  right or has expired…"), and they hit the same five-attempt lock. No screen says "not invited" or "not allowed". Pinned by
  `account-flows.test.ts` and `account-actions.test.ts` ("nothing is created or sent").
- **Asking for a code or link** succeeds for every address; "Check your email" is the same sentence for an address with an account
  and one without (`auth-screens.spec.ts` compares the rendered text).
- **A wrong, expired, used or malformed code** is one message. We deliberately do not split "wrong" from "expired": the provider checks
  expiry before the value, so telling them apart would reveal that an address has a pending sign-up. (Design's spec had two messages;
  this is the one deviation, and it is a copy-only change to reverse.)
- **Limits are the only visible difference, and they apply to every address alike**: a 30-second gap per address and kind (the first send
  counts), 5 sends an hour per address and kind, 20 sends and 10 sign-ups an hour per caller, and 5 wrong codes per 15 minutes per address.
  A newly sent code clears the wrong-code lock.
- The timing floor (`AUTH_FLOW_MIN_MS`, default 800 ms, `min-duration.ts`) makes a request that reached the provider and one that did not
  take the same time.
- Logs are a closed set of event codes (`safe-log.ts`); no address, code, token or password is ever logged. Tests assert it.

## Verification, then what?

After a valid code the app asks the provider for the session. If verifying started one (Better Auth's auto sign-in), the allowlist is
checked and the person lands in the app. If not, they go to `/sign-in?notice=verified` and sign in with the password they chose. **Which
of the two production does is not knowable until the first real sign-up**; both paths are tested and neither skips a control.

Signing in with the right password for an unverified address sends a fresh code and goes to `/verify` (the person just proved the
password, so nothing is revealed). A wrong password stays the one generic error.

## Reset: link, not code

Design specified a reset **link**. The adapter calls the provider's `requestPasswordReset({ email, redirectTo })` with the app's own
`/reset-password` URL, and later `resetPassword({ token, newPassword })`. The page never validates a token on load: a usable-looking
`?token=` shows the form, anything else shows the invalid-link screen, and a token the provider rejects on submit redirects to
`/reset-password?error=invalid` so the token is gone from the address. The page sends `Referrer-Policy: no-referrer`.

Switching to a reset **code** would be confined to `neon-adapter.ts`, `account-flows.ts` and the reset screens; the provider interface
(`types.ts`) is where the two meet.

**Needs a person (Caroline): confirm the production Neon Auth project sends a reset link (not a code), and that the app's origin is a
trusted origin of the project (otherwise `redirectTo` is refused and the emailed link cannot land here).** Same for previews.

## Sessions after a reset

A successful reset signs out _this browser_ and does not sign anyone in. Ending the person's **other** sessions is the provider's job
(its reset endpoint decides); the app cannot enumerate another browser's sessions. Worth confirming alongside the item above.

## What the tests cover, and what they cannot

- Unit/DOM: adapter mapping and error classification, flow services, limits, the timing floor, the pending-address cookie, the actions,
  the pages, and every form (field errors linked with `aria-describedby`, one live region for the resend gap announced twice, never
  per tick, focus on the heading and on the first invalid field).
- Browser (`tests/e2e/auth-screens.spec.ts`, both viewports): the whole journey with a fake inbox, the unverified-user denial path,
  the unlisted-address path, reset once and never twice, axe on every screen and state, 44px targets, no sideways scroll, and named
  screenshots in `test-results/screenshots/`.
- **Not covered**: the real Neon Auth project (no credentials exist in CI) — error codes are mapped from the SDK's types and common
  Better Auth codes and fall back to the safe answer; real email delivery and the contents of the emails ("someone tried to sign up"
  mail for an existing address is a provider setting, not something the app can send); and a screen-reader pass (see
  `docs/accessibility.md`).

## Settings and variables

- `AUTH_FLOW_MIN_MS` (default 800) and `AUTH_FLOW_CALLERS_PER_HOUR` (default 10) are optional tuning knobs; a bad value uses the default.
  The browser tests set them to 0 and 10000.
- Per-instance memory limits (like the sign-in limits): a limit shared across serverless instances is Caroline's call (#28).
