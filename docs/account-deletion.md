# Account deletion (#237)

## User flow

Settings opens a non-backdrop-dismissable confirmation sheet. The owner must enter the current password and type `DELETE`
exactly. The server action accepts only a same-origin request, obtains identity and ownership from the provider session (never
from form input), applies the existing per-email/address sign-in limit, and reauthenticates the password immediately before
deletion.

The application currently configures only verified email/password accounts. There is no OAuth/social or passwordless sign-in
configuration or UI in this repository. The deletion flow therefore requires that current password. If another sign-in method
is added, account deletion must fail closed until that provider method has an explicit recent-authentication and deletion design;
do not silently treat a fresh session as equivalent to a password for an OAuth/passwordless identity.

## Ordering and interrupted operations

Deletion is intentionally ordered:

1. Reauthenticate with the raw auth provider and require the returned user id and normalized email to match the session that
   opened the flow.
2. In one database transaction, insert `account_deletions(user_id)` idempotently, remove the matching `account_setups` digest,
   and delete `users`. Foreign-key cascades hard-delete all owned trips (including Recently deleted), stops, items/progress,
   preferences, weather suggestions, Staples, saved lists/items, and account preferences.
3. Revoke every provider session except the fresh current session.
4. Ask the provider to delete the identity; provider deletion removes the final session and cookie.
5. Report success only after the provider confirms deletion.

Steps 2–4 cannot be a distributed transaction. If the database loses its commit acknowledgement, the action re-reads the durable
fence and never claims that nothing was deleted unless the fence is confirmed absent; if that read also fails, the UI says the
outcome is unknown. If either provider call fails or its outcome is ambiguous after step 2, the durable fence remains. Normal
request guards deny the identity. Owner provisioning and deletion both acquire the same provider-id-scoped transaction advisory
lock before checking or inserting the fence, so a provisioning request that began on a stale `READ COMMITTED` snapshot waits and
then observes the committed fence instead of recreating `users`. A correct password sign-in for that fenced identity is routed
only to the public `/close-account` recovery screen; the raw session is never accepted by the app/data guards. Retrying repeats
the database transaction safely, then session revocation and identity deletion. A fence lookup failure also denies access.

This ordering prefers privacy and containment over preserving app access during a provider outage: once the database transaction
commits, app data stays deleted. The recovery screen is the escape hatch for completing provider cleanup after an interruption.

## Client integration seam

The only confirmed-success boundary is `closeAccount()` returning `{ status: "ok" }`, after the provider has confirmed the
terminal `User deleted` response. Only that branch issues a five-minute, identity-free signed value in an HttpOnly,
`SameSite=Strict` cookie scoped to `/close-account/complete`, then redirects to that public route. Partial, unknown,
wrong-password, CSRF, and provider-error branches never issue the cookie and cannot run client-side account cleanup.

The completion route calls a same-origin server action that validates and expires the exact-path cookie before returning success
to the browser. Only then does the client invoke the feature-independent cleanup seam. Direct visits, refreshes, altered or
expired signals, and a second sequential use skip cleanup. The signal contains only a version, expiry, random nonce, and keyed
digest—no user id, email, credential, or provider token—and it never appears in the URL. Navigation to sign-in runs in `finally`,
including when signal consumption or local cleanup fails or exceeds its bounded wait, so an already-deleted user cannot be
stranded.

When Framebriar is integrated, keep it out of the destructive server transaction and implement the existing client cleanup seam:

1. stop the Framebriar outbox, best-effort clear its browser-profile-local outbox, then disconnect access; and
2. do not request deletion of separately retained delivered reports without a separate product/privacy design and verified
   hosted retention behavior.

Framebriar currently has no app-account identifier in the clean baseline used by this branch. Do not add a Framebriar dependency
here; resolve the `SettingsScreen.tsx` and `globals.css` integration seams after this change lands.

## Retained fence and privacy decision

`account_deletions` intentionally retains an opaque provider user id and `started_at`, with no email, credential, preference,
trip, packing-list, or location data. That record is necessary to block cached/stale provider sessions and concurrent mutations
from recreating owner data, and to make a partially completed deletion retryable after a process restart.

The fence is still account-linked retained data. Consequently this design promises deletion of the auth identity and all owned
app content, not absolute erasure of every database value. No expiry is encoded because issue #28 has not established the
maximum session/cache/backup interval or legal retention policy. Before expiring tombstones, product/privacy must choose a period
that exceeds every possible stale-session lifetime and define backup/log handling. Neon must also be verified not to reuse a
deleted provider user id on re-registration; until that hosted behavior is confirmed, id reuse would leave a newly registered
identity fenced rather than risk reopening deleted data.

## Verification boundary

Automated tests use synthetic accounts, the in-memory/PGlite database, and mocked/provider-fake responses. They verify the full
owned-row cascade, cross-owner isolation, the write fence, idempotent retries, wrong-password behavior, CSRF origin checking,
provider failures, and the recovery sign-in path. They never call Neon or a deployed environment.

Before enabling this feature in a disposable non-production Neon Auth project, verify with a synthetic email that:

1. a password sign-in creates at least two sessions;
2. `revokeOtherSessions()` invalidates the other session and keeps the current one;
3. `deleteUser({ password })` returns the confirmed terminal response
   `{ success: true, message: "User deleted" }`, deletes the identity, clears the current cookie, and invalidates every remaining
   session; a response such as `{ success: true, message: "Verification email sent" }` is not treated as deletion;
4. the same email can register again and receives a different provider user id;
5. deletion is enabled for the project and the SDK response shapes match the installed `@neondatabase/auth@0.6.0-beta` adapter.

Do not run that check against Production or with a real account. Provider-side retention, audit logs, backups, and deletion
timelines remain hosted-service policy questions and are not asserted by this code.
