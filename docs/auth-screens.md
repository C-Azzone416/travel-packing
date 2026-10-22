# Account screens: sign-up, verification, forgot and reset password (#27)

The app has one owner (or a few). These screens let that person create an account, confirm their address, and recover a
forgotten password. They sit **outside the signed-in shell** (the proxy marks them, like `/sign-in`). They do not grant access:
the two server controls from #9 are unchanged and still decide everything.

## What gates access (unchanged, and pinned by tests)

1. **`emailVerified === true`** in the Neon adapter (`src/server/auth/neon-adapter.ts`). A user with `false`, `null`, a missing
   value or a non-boolean has no session at all.
2. **The session email must be in `OWNER_EMAIL_ALLOWLIST`** (`guard.ts`), checked at the proxy and again in every data-layer
   entry point.
3. **The account's password must have been set through an emailed link** (#83, `account-setup.ts`). See
   [Pre-registration](#pre-registration-closed-by-setting-the-password-through-the-emailed-link).

`src/server/auth/unverified-denial.test.ts` runs an allowlisted address with `emailVerified` false / null / missing / `"true"` / `1`
through page routes (proxy), API routes, the place-search route, server actions (`withOwner`), the data layer (`run`, which is
refused before the database is touched) and sign-in. Nothing here weakens either control: signing up, verifying and resetting
never create a session on their own, and a verified address that is not allowlisted is signed straight back out.
`src/server/auth/pre-registration.test.ts` does the same for the third control.

## Screens and routes (all public)

| Route                           | What it does                                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sign-up`                      | Email only (#102). Always continues to `/verify`.                                                                                                                                                        |
| `/verify`                       | Enter the 6-digit code. "Send a new code" with a 30-second gap. "Use a different email" goes back to sign-up. A right code goes to `/finish-setup`.                                                      |
| `/finish-setup`                 | "Check your email to finish setting up" (#83): the link that chooses the password was emailed. "Send the link again" with the 30-second gap.                                                             |
| `/forgot-password`              | Email, then always "Check your email". "Send it again" with the same 30-second gap.                                                                                                                      |
| `/reset-password?for=…&token=…` | Choose a new password; with `&setup=1` (the link from `/finish-setup`) the same screen reads "Set your password". A missing, wrong, expired or used token shows "This link isn’t valid" with no form.    |
| `/sign-in`                      | Gains "Forgot password?", "Create an account", a status notice (`?notice=password-updated`, `password-set` or `verified`; any other value is ignored), and one neutral sentence under the generic error. |

The address being verified is remembered in a 30-minute `httpOnly` cookie (`cw-pending-email`), never in the URL, so it does not end up
in history, a shared link or an access log. It grants nothing. With no cookie, `/verify` asks for the address as well.

## Enumeration safety

- **Sign-up** for an address that already has an account looks like any other sign-up (the provider reports success without sending a
  code, and the adapter treats every client error as success).
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

## Sign-up asks for an email only (#102)

The provider's sign-up call needs a password, but since #83 that password can never sign anyone in: the person chooses the real one
through the emailed "finish setting up" link. So the form asks for the email alone (a password box there only confused people), and
the server action makes the password itself: 32 random bytes from the CSPRNG (`crypto.getRandomValues`), base64url (43 characters, inside
any password policy), different on every call. It goes to `provider.signUp` and is dropped: never returned to the browser, logged,
stored or part of the client bundle. The link replaces it. A password refused by the provider is now only a server error ("Something
went wrong on our side"); there is no password-policy message on the sign-up form.

**Retrying an abandoned sign-up.** Someone who started but never entered the code used to be able to sign in with the password they typed
and be sent back to `/verify` for a fresh code. They no longer know a password, so sign-in cannot do that. What works, with no password:

1. **Sign up again** with the same address. It always lands on `/verify` (the same screen as any sign-up). With the real provider a
   taken address is a client error that sends nothing, which the app treats as success and logs as `sign-up-provider-rejected`; so
   the code from the first attempt still works if it has not expired.
2. **"Send a new code"** on `/verify` (the provider's `sendVerificationOtp`) mails a new code that replaces the old one. It needs no password and
   is the way back once a code has expired. Note that a repeat sign-up starts the 30-second gap again, so this button reappears 30
   seconds after it.

Pinned by `pre-registration.test.ts` ("retrying an abandoned sign-up") and `auth-screens.spec.ts`. The real provider's behaviour for a
taken address is not testable in CI; confirm it on the preview.

## Why did no code arrive? (server-side events, #93)

The browser answer is the same whether or not a code was sent (see above), so the **server log** says what happened. Each sign-up,
resend and reset request logs exactly one of these lines (JSON, `scope: "auth"`), and never an address, password, code, token, secret or
the allowlist:

| Event                                                                      | Meaning                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sign-up-provider-ok` / `code-send-provider-ok` / `reset-send-provider-ok` | The provider was called and accepted the request.                                                                                                                                                                                                                  |
| `…-provider-rejected` (with `status` and `code`)                           | The provider answered with a client error (a 4xx). The screen still shows success, but **no code was sent**. `code` is the provider's machine code, e.g. `INVALID_ORIGIN` (the app's URL is not one of the auth project's trusted domains), `USER_ALREADY_EXISTS`. |
| `…-provider-failed` / `sign-up-failed`                                     | The provider was unreachable or returned a server error. The screen shows an error.                                                                                                                                                                                |
| `…-skipped-allowlist`                                                      | The address is not on the deployed `OWNER_EMAIL_ALLOWLIST`; the provider was not called.                                                                                                                                                                           |
| `…-skipped-cooldown`                                                       | A code for this address was requested in the last 30 seconds (limits are per server instance, in memory); the provider was not called.                                                                                                                             |
| `…-skipped-limit`                                                          | The address or caller hit an hourly cap; the provider was not called.                                                                                                                                                                                              |

Once per server start the app also logs `allowlist-loaded` with the number of addresses, how many of them are **malformed** (not a plain address: quoted, in angle brackets, `mailto:`...; such an entry can never match a real sign-up) and a **keyed fingerprint** of the allowlist. The
deploy job prints the fingerprint of the GitHub copy in the step "Inject deployment secrets" (`allowlist N entries, fingerprint …`):
if the two match, Vercel and GitHub hold the same allowlist and cookie secret (see docs/deploy.md). No page or endpoint answers
"is this address allowed?".

## Verification, then what? (#83)

A right sign-up code **never signs anyone in**, however the provider behaves. The app ends any session the provider started, emails a
link to the verified address, and shows "Check your email to finish setting up". The person chooses their password through that link,
signs in with it, and only then has a session. Signing in before that (right password, verified address, link never used) also gives no
session; it sends the link again and shows the same screen.

Signing in with the right password for an _unverified_ address sends a fresh code and goes to `/verify`. A wrong password, or any
address the app has never heard of, stays the one generic error, with one neutral sentence under it (the same for everyone) pointing to
the emailed link and to "reset your password".

## Reset: link, not code

Design specified a reset **link**. The adapter calls the provider's `requestPasswordReset({ email, redirectTo })` with the app's own
`/reset-password` URL plus `?for=<seal>` (and `&setup=1` for the sign-up link), and later `resetPassword({ token, newPassword })`.
The provider is expected to append `token=` to that return address; if it glues it on with a second `?`, the page splits it back out
(`link-params.ts`) instead of rejecting a good link. **Confirm this against the first real email.** The page never validates a token on load: a usable-looking
`?token=` shows the form, anything else shows the invalid-link screen, and a token the provider rejects on submit redirects to
`/reset-password?error=invalid` so the token is gone from the address. The page sends `Referrer-Policy: no-referrer`.

Switching to a reset **code** would be confined to `neon-adapter.ts`, `account-flows.ts` and the reset screens; the provider interface
(`types.ts`) is where the two meet.

**Needs a person (Caroline): confirm the production Neon Auth project sends a reset link (not a code), and that the app's origin is a
trusted origin of the project (otherwise `redirectTo` is refused and the emailed link cannot land here).** Same for previews.

## Sessions after a reset

A successful reset signs out _this browser_ and does not sign anyone in. Ending the person's **other** sessions is the provider's job
(its reset endpoint decides); the app cannot enumerate another browser's sessions. Worth confirming alongside the item above.

## Pre-registration: closed by setting the password through the emailed link

The gap (found reviewing #81): sign-up is open for any address on `OWNER_EMAIL_ALLOWLIST`, so **anyone who knows the owner's email
could sign up with it first, with their own password.** (Since #102 the app's own form takes no password, so the attacker calls the
auth service's public sign-up endpoint directly; the gap and its closure are unchanged, and the tests do exactly that.) The code goes to the owner's inbox, so they cannot verify it, but when the
owner later enters that code the account becomes verified **with the other person's password**. The Neon Auth sign-up endpoint is
public per project, so this exists with or without the app's screens.

How it is closed (#83): being verified is no longer enough to sign in. The app also requires a record that the account's password was
set **through a link that only the inbox owner receives**:

- The record is the table `account_setups` (an HMAC-SHA-256 digest of the normalized address, keyed from `NEON_AUTH_COOKIE_SECRET`; no raw address is stored). It is added to,
  never removed from, and is created **only** when a reset link is used successfully: the "finish setting up" link after sign-up, or any
  forgot-password link.
- Sign-in is refused for an allowlisted address with no record. This is enforced by wrapping the auth provider (`withSetupGate`), so the
  proxy, server actions and the data layer all see it, and so does a session the attacker minted by calling the auth service directly
  with the password they registered: the app reads that session and refuses it.
- **A session made before the setup stays dead after it.** The record keeps when the setup happened, and the provider says when each
  session was created (Better Auth's `session.createdAt`, read by the adapter). The gate refuses a session created at or before the setup,
  or one that does not say when it was made. Without this, an attacker who signed in at the provider with the pre-registered password
  and kept the cookie would get the owner's session the moment the owner used the link (QA's finding on #84). `pre-registration.test.ts`
  covers it. It does not rely on the provider revoking sessions on reset (nor on that being configured).
- The link carries `?for=<seal>`: the address, signed with a server secret and expiring with the link, so using the link records
  **which** account was set up (the provider's reset call does not say). Only the app can make a seal and it is only ever emailed to the
  address it names. A missing or altered seal still changes the password but records nothing.
- An address that is not allowlisted is untouched by all of this: it never reaches the provider, and the existing access-denied
  behaviour for a valid-but-not-allowed account is unchanged.

So the attacker's password can never sign in: before verification the account is unverified; after, it is not set up; and using the
link replaces it. The owner does **not** need to sign up first or use the Neon console. `pre-registration.test.ts` runs the whole
attack against a real account model (and fails without the gate), and `auth-screens.spec.ts` does the same in the browser.

Limits of this protection, stated plainly:

- The seal and the address digest are keyed with separate keys derived from `NEON_AUTH_COOKIE_SECRET` (labelled HMAC derivations; the
  secret itself signs nothing), so a leaked table cannot be tested against known addresses. **Rotating that secret makes every setup
  record unreadable**: everyone then uses an emailed link once more (it signs everyone out anyway). Keep the project's trusted origins
  exact: a forged Host header would otherwise also leak a valid seal.
- It protects **sign-in to the app**. The provider's own public sign-in still accepts the attacker's password for a verified account;
  that can only matter to the app, which refuses it.
- If the owner never uses the emailed link, nobody can sign in (the attacker included). "Send the link again" and "Forgot password?"
  both send one.
- The setup records live in the app database. With no database, nobody can sign in (the app has no data either).

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
