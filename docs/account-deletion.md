# Account deletion (#237)

## Rollout gate

Account closure is disabled unless the server receives the exact value `CLOSE_ACCOUNT_ENABLED=1`. Missing, blank, or malformed
configuration fails closed. While disabled, Settings does not render the Close account entry, the public recovery route redirects
to Settings, both server actions reject before reading session or database state, the destructive core refuses direct calls, and
the signed-out reconciler neither queries nor mutates deletion state. The completion route remains available only to consume a
one-time completion cookie already issued after confirmed provider deletion.

The synthetic Playwright environment sets the switch only for its isolated fake-auth/PGlite run. Preview and Production land with
the variable unset. Before either hosted target is enabled, validate this flow with an explicitly approved synthetic account on
the non-production Neon Auth/database branch, including the Framebriar disconnect step and server guard described below (#261).
Delivered Framebriar reports cannot currently be erased through its browser SDK and must not be described as deleted. Landing this code does not authorize changing hosted configuration, creating or deleting hosted accounts,
or exercising the destructive flow against real data.

## User flow

Settings opens one non-backdrop-dismissable sheet with up to two steps. When this account has a Framebriar feedback enrollment (in
any state) or an unfinished connection attempt, **step 1 of 2, "Disconnect feedback first"**, runs inside the sheet: the person
presses Disconnect, sees the real result (the same honest messages as Settings), and only then does Continue lead to step 2. A
failure (unavailable, uncertain, pending connection, partial, offline, signed out) stays on step 1 with a retry and offers nothing
that moves toward deletion; no password or `DELETE` field exists in the page during step 1. Whether step 1 exists is decided when the
sheet opens and latched, so it cannot disappear when the status refreshes. When feedback is not involved, the sheet is exactly step 2
with no step label.

Step 2 is the permanent-deletion confirmation. The owner must enter the current password and type `DELETE`
exactly. The copy says closure permanently deletes the account and cannot be undone. The server action accepts only a
same-origin request, obtains identity and ownership from the provider session (never from form input), applies the existing
per-email/address sign-in limit, and reauthenticates the password immediately before deletion.

The application currently configures only verified email/password accounts. There is no OAuth/social or passwordless sign-in
configuration or UI in this repository. The deletion flow therefore requires that current password. If another sign-in method
is added, account deletion must fail closed until that provider method has an explicit recent-authentication and deletion design;
do not silently treat a fresh session as equivalent to a password for an OAuth/passwordless identity.

## Framebriar feedback comes first (#261)

Closing deletes the app owner row, and the sealed Framebriar credentials hang off it with a cascade. They must therefore be revoked
and erased first, or they would be destroyed without ever being revoked. The rule is enforced on the server, not by the page:

- **The action** (`closeAccountAction`) refuses with a typed `feedbackBlocking` state while the server holds ANY enrollment row (any
  state) or ANY connection attempt (even one past its retry window) for the owner's current account generation. This check runs
  before rate-limit accounting and before reauthentication, so a refusal is not a failed password and learns nothing about it.
- **The destructive core** (`closeAccount`) repeats the check on its own before reauthenticating, so a direct call cannot bypass the
  action.
- **The deletion transaction** (`beginAccountDeletion`) checks once more after taking the owner lock and locking the owner row
  `FOR UPDATE`, before writing anything. A concurrent enrollment or redemption insert waits on that row lock and then fails its
  foreign key once the row is gone, so a connection made between the early check and the delete (BEFORE the fence exists) cannot
  be cascaded away. A refusal writes no fence and deletes nothing.
- **The window after the fence commits (#311).** The deletion commit removes the owner row, and the provider delete follows it, so
  for a few seconds (or longer if the provider is down) a still-valid session on another device could call the enrollment
  routes. Before #311, `accountGeneration` re-provisioned the owner row there without looking at the fence, so a redemption could
  seal brand-new credentials that `completeAccountDeletion` (also used by the signed-out reconciler) then cascaded away WITHOUT
  revoking them, leaving a live Framebriar family behind. That is closed: every enrollment write (provisioning the owner row,
  creating or replacing a redemption attempt, committing a redemption, and every refresh that writes) runs in one transaction that
  takes the same provider-id-scoped owner advisory lock as deletion and provisioning, in the same order (owner lock first; the
  deletion transaction takes its setup lock and row lock after it), then refuses with a typed error while an `account_deletions`
  fence exists for that owner and never recreates a fenced owner row. A write that waits behind `beginAccountDeletion` therefore
  observes its committed fence and is refused; one that commits first leaves a row the deletion's gate sees and refuses to cascade.
  The route answers 503 `ACCOUNT_CLOSING`, which the client shows as the existing "unavailable" copy. Erasing (disconnect) is not
  blocked. PGlite cannot demonstrate real lock contention (one connection), so hosted step 0 below must cover it.
- If the check cannot be evaluated, nothing is attempted and the person is told nothing was deleted.
- The recovery retry after a fence has no owner row left, so it is never blocked.

The page sends the person back to step 1 when the server refuses (a second device or tab connected feedback, or the page was stale).
The password and `DELETE` fields are removed from the page and come back blank.

What "disconnected" means for closure, matching Settings' honest copy:

- `ended`: Framebriar revoked the access and every sealed credential is erased.
- `nothing`: there was nothing live to end (an expired or already revoked record, or Framebriar no longer knew the family).
- `erased_unrevocable`: this app's copy is erased but the access itself could not be ended, so it stops on its own at Framebriar's fixed
  deadline. This covers a credential this server can no longer open, a record Framebriar switched off (`disabled`, 403: the family was
  never revoked and could be live again), and an abandoned connection attempt whose answer was lost (a family nobody holds a
  credential for), even next to a record that did revoke. Closure treats it as disconnected and says plainly that leftover access
  expires on its own, with the date when it was known.
- Failures (`partial`, `unavailable`, `uncertain`, pending connection, offline, signed out) never count: the credential is kept (or
  the erase is repeatable), nothing destructive happens, and the retry works.

Stated limits: reports already delivered to Framebriar cannot be enumerated by app account and its SDK has no delete-by-account
operation, so they are not deleted; leftover access that could not be revoked lives until Framebriar's deadline. Nothing here
authorizes changing Framebriar data or configuration.

## Ordering and interrupted operations

Deletion is intentionally ordered:

0. Refuse while any Framebriar enrollment or connection attempt is held (above).
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

After confirmed closure, the client cleanup seam stops the mounted Framebriar queue and best-effort deletes the closing account's own
unsent-report outbox in this browser profile. The sheet remembers which account is closing (its opaque outbox key, which names the
account and its generation, in module memory only: nothing is written to browser storage) when the person submits, and forgets it as
soon as the attempt does not end in closure, so another account's unsent work in the same browser is never touched. If nothing was
remembered (a direct visit or a reload), every account-scoped outbox and the legacy Framebriar databases are cleared, which is never
fewer than before. It does not hold or reconstruct a browser credential, call the enrollment API after the session is gone, or claim
that delivered reports were deleted. The account-scoped client introduced in #260 keeps enrollment credentials on the server, and
they are revoked and erased in step 1 before any deletion starts.

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

0. an account with a synthetic Framebriar enrollment (against a non-production Framebriar target, never real data) cannot be closed
   until it is disconnected in the sheet, a second device that connects while the sheet is open is refused and sent back to step 1,
   and after Disconnect the sealed enrollment row is gone and closure completes; with the fence committed and the provider delete
   paused, a redemption or refresh from a second device is refused (503 `ACCOUNT_CLOSING`) and leaves no `users`, enrollment or
   attempt row (#311);

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
