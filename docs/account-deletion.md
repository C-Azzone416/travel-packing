# Account deletion (#237)

## Rollout gate

Account closure is disabled unless the server receives the exact value `CLOSE_ACCOUNT_ENABLED=1`. Missing, blank, or malformed
configuration fails closed. While disabled, Settings does not render the Close account entry, the public recovery route redirects
to Settings, both server actions reject before reading session or database state, the destructive core refuses direct calls, and
the signed-out reconciler neither queries nor mutates deletion state. The completion route remains available only to consume a
one-time completion cookie already issued after confirmed provider deletion.

The synthetic Playwright environment sets the switch for its isolated fake-auth/PGlite run. Production remains disabled. Preview
may carry exact `1` only for an explicitly approved, owner-only destructive test on its isolated Neon Auth/database branch after
the owner has confirmed the test account's Framebriar enrollment is already disconnected. That exception does not complete #261
or authorize general rollout: enrollment revocation and erasure must still participate in truthful deletion retries before the
feature is offered to enrolled users. Delivered Framebriar reports cannot currently be erased through its browser SDK and must
not be described as deleted. No deployment setting authorizes creating or deleting an account; the owner separately performs and
accepts the destructive test.

## User flow

Settings opens a non-backdrop-dismissable confirmation sheet. The owner must enter the current password and type `DELETE`
exactly. The copy says closure permanently deletes the account and cannot be undone. The server action accepts only a
same-origin request, obtains identity and ownership from the provider session (never from form input), applies the existing
per-email/address sign-in limit, and reauthenticates the password immediately before deletion.

The application currently configures only verified email/password accounts. There is no OAuth/social or passwordless sign-in
configuration or UI in this repository. The deletion flow therefore requires that current password. If another sign-in method
is added, account deletion must fail closed until that provider method has an explicit recent-authentication and deletion design;
do not silently treat a fresh session as equivalent to a password for an OAuth/passwordless identity.

## Ordering and interrupted operations

Deletion is intentionally ordered:

1. Reauthenticate with the raw auth provider and require the returned user id and normalized email to match the session that
   opened the flow.
2. In one database transaction, insert the transient `account_deletions(user_id, identity_created_at, setup_email_digest)`
   fence idempotently, remove the matching `account_setups` digest,
   and delete `users`. Foreign-key cascades hard-delete all owned trips (including Recently deleted), stops, items/progress,
   preferences, weather suggestions, Staples, saved lists/items, and account preferences.
3. Revoke every provider session except the fresh current session.
4. Ask the provider to delete the identity; provider deletion removes the final session and cookie.
5. After the provider confirms deletion, acquire the owner lock again, perform a final owner-row cascade sweep, and delete the
   transient fence last. Report success only after that transaction is confirmed.

Steps 2–5 cannot be a distributed transaction. If the database loses its initial commit acknowledgement, the action re-reads
the fence and never claims that nothing was deleted unless the fence is confirmed absent; if that read also fails, the UI says
the outcome is unknown. If either provider call fails or its outcome is ambiguous after step 2, the transient recovery fence remains. Normal
request guards deny the identity. Owner provisioning and deletion both acquire the same provider-id-scoped transaction advisory
lock before checking or inserting the fence, so a provisioning request that began on a stale `READ COMMITTED` snapshot waits and
then observes the committed fence instead of recreating `users`. A correct password sign-in for that fenced identity is routed
only to the public `/close-account` recovery screen; the raw session is never accepted by the app/data guards. Retrying repeats
the database transaction safely, then session revocation and identity deletion. A fence lookup failure also denies access.

Owner provisioning, deletion, and terminal cleanup use the same provider-id-scoped transaction advisory lock. The installed
Neon server SDK otherwise trusts a signed session-data cookie for 300 seconds, so every app session read explicitly bypasses
that cache and revalidates upstream. The data layer revalidates the raw provider session again after acquiring the owner lock
and before provisioning; it must still resolve to the same owner. A request authorized before provider deletion therefore
cannot recreate `users` after terminal cleanup removes the fence.

The provider's immutable user `createdAt` is carried on authoritative sessions and password sign-in responses. The transient
fence records it so a provider id reused by a later identity cannot enter the old recovery flow or be deleted by an old terminal
cleanup. A mismatched authoritative session removes only the obsolete fence under the owner lock; it does not sweep the new
identity's owner data. Under-lock data revalidation compares both provider id and identity creation time.

Password-reset setup completion takes an opaque-email advisory lock before consuming the provider token and holds it through
the `account_setups` write. Both deletion sweeps take the same lock after the owner lock, and terminal cleanup repeats the
setup-row deletion. A reset can therefore complete before the first sweep, between the two sweeps, or fail after identity
deletion, but cannot recreate a setup row after confirmed closure.

This ordering prefers privacy and containment over preserving app access during a provider outage: once the initial database
transaction commits, app data stays deleted. Provider-first deletion is deliberately rejected because a later database failure
would strand owned content after the identity needed to authorize a retry was gone.

If the provider confirms identity deletion but the final fence-removal transaction cannot be confirmed, the app does not claim
closure completed. A temporary opaque fence may remain for operational recovery; owned content and the identity are already
gone, and the UI says not to create a new account yet. A lost commit acknowledgement is re-read, so a fence confirmed absent
still counts as success.

Managed Neon Auth documents `neon_auth.user` in the same branch database as its immediate source of truth. After a
transport-ambiguous delete, the server queries only for existence of the exact fenced `(id, createdAt)` pair. A present row
keeps the fence; an absent row permits the same generation-bound terminal cleanup; a permission, connection, timestamp, or
result-shape error keeps the fence. The signed-out sign-in page runs the same bounded server-side reconciler so an identity
that is already gone does not need to authenticate again after a database outage. It selects only exact identities already
absent from the auth table, marks each attempted fence before cleanup, and waits five minutes before retrying that fence. New
or older candidates therefore progress past a failing batch while repeated public requests cannot hot-loop the same cleanup.
The attempt timestamp is pending-only state and is deleted with the fence. Browser input supplies none of the identity or
cleanup keys. This design remains release-blocked until the disposable non-production branch verifies that the deployed
app database role can select this existence result from `neon_auth.user` and that the documented column names/timestamp
precision match the installed service.

## Client integration seam

The only confirmed-success boundary is `closeAccount()` returning `{ status: "ok" }`, after terminal provider deletion and
confirmed removal of the transient fence. Only that branch issues a five-minute, identity-free signed value in an HttpOnly,
`SameSite=Strict` cookie scoped to `/close-account/complete`, then redirects to that public route. Partial, unknown,
wrong-password, CSRF, and provider-error branches never issue the cookie and cannot run client-side account cleanup.

The completion route calls a same-origin server action that validates and expires the exact-path cookie before returning success
to the browser. Only then does the client invoke the feature-independent cleanup seam. Direct visits, refreshes, altered or
expired signals, and a second sequential use skip cleanup. The signal contains only a version, expiry, random nonce, and keyed
digest—no user id, email, credential, or provider token—and it never appears in the URL. Navigation to sign-in runs in `finally`,
including when signal consumption or local cleanup fails or exceeds its bounded wait, so an already-deleted user cannot be
stranded.

After confirmed closure, the client cleanup seam stops the mounted Framebriar queue and best-effort deletes every account-scoped
or legacy Framebriar IndexedDB database in this browser profile. It does not hold or reconstruct a browser credential, call the
enrollment API after the session is gone, or claim that delivered reports were deleted. The account-scoped client introduced in
#260 keeps enrollment credentials on the server; #261 must call `revokeAndEraseEnrollment` before account deletion and remains a
separate release-integration gate.

Delivered reports may contain identifying notes or Preview screenshots, and the current protocol has no delete-by-account
operation. Do not claim those hosted reports are erased, transmit a new identifier, or change the hosted service without a
separate product/privacy decision.

## No account tombstone after confirmed closure

`account_deletions` contains an opaque provider user id, the provider identity creation time, and the keyed setup-email digest
while deletion is incomplete. Those values are used only to bind retries and repeat both cleanup sweeps. The row is removed
after the provider's terminal response and the final app-data sweep. Confirmed normal closure therefore leaves no app setup,
owner, owned-content, or deletion-fence row.

Provider user-id uniqueness is not trusted as a safety mechanism. Recovery and cleanup require the recorded identity creation
time to match; the setup digest is removed, the positive setup result is not cached across requests, and a later identity must
complete its own inbox-owned setup-link flow. An absent fence never authorizes an old session by itself: every request performs
an authoritative provider session read.

This application can promise removal from its live app database and provider identity only to the extent verified by those
systems. Neon/provider audit logs, caches, deletion timelines, and database backups follow their configured service policies and
are not synchronously erased or verified by this request. Partial failures may temporarily retain the recovery fence as
described above; the app never labels that state complete.

## Verification boundary

Automated tests use synthetic accounts, the in-memory/PGlite database, and mocked/provider-fake responses. They verify the full
owned-row cascade, cross-owner isolation, the transient write fence and terminal removal, idempotent retries, authoritative
session reads, stale-request revalidation, wrong-password behavior, CSRF origin checking, provider failures, and the recovery
sign-in path. Contract tests require deletion, provisioning, and terminal cleanup to await the same owner lock. PGlite has one
connection and serializes transactions even without the advisory lock, so its concurrency test verifies the durable outcome but
cannot demonstrate real PostgreSQL lock contention. Automated tests never call Neon or a deployed environment.

Before enabling this feature in a disposable non-production Neon Auth project, verify with a synthetic email that:

1. a password sign-in creates at least two sessions;
2. `revokeOtherSessions()` invalidates the other session and keeps the current one;
3. `deleteUser({ password })` returns the confirmed terminal response
   `{ success: true, message: "User deleted" }`, deletes the identity, clears the current cookie, and invalidates every remaining
   session; a response such as `{ success: true, message: "Verification email sent" }` is not treated as deletion;
4. the same email can register again; record whether the provider id changes, and confirm `user.createdAt` is present and
   stable on password sign-in and cache-bypassed session reads but changes for the newly created identity;
5. an authoritative `getSession` rejects a revoked session immediately rather than honoring the 300-second session-data cookie;
6. deletion is enabled and response shapes match the installed `@neondatabase/auth@0.6.0-beta` adapter; using the app's
   existing pooled database role, select only `exists(...)` for a synthetic `(id, createdAt)` from `neon_auth.user`, then
   verify it changes immediately from true to false when that synthetic identity is deleted; and
7. on two independent PostgreSQL connections, pause deletion after it takes the owner lock and starts its transaction, start
   provisioning for the same provider id, then commit deletion; provisioning must wait, refuse the fenced identity, and leave
   `users` empty with exactly one transient `account_deletions` row. Repeat with provisioning first and deletion second, then
   simulate terminal provider deletion and verify the final locked sweep leaves both tables empty.

Do not run that check against Production or with a real account. No hosted test is authorized by this document. Provider-side
retention, audit logs, backups, and deletion timelines remain hosted-service policy questions and are not asserted by this code.
