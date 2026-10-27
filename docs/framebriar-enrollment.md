# Account-scoped Framebriar enrollment: server side (#259, part of #258)

One redeemed Framebriar invitation belongs to one Packed Smart **account**, not to one browser. The signed-in account can send
feedback from a phone and a computer, and after clearing browser storage, without another invitation, until Framebriar's fixed
deadline or a revocation. A different account never inherits it. **Preview only**: Production has no Framebriar server path.

This page is the server half. The browser half (the account-scoped outbox, the Settings UI, logout clearing) is #260. The API contract
the browser builds against is the comment pinned on [#258](https://github.com/C-Azzone416/travel-packing/issues/258).

## What is stored, and where

| Data                                                             | Where                                                           | Notes                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Refresh credential, cached access token                          | `framebriar_enrollments.credentials`, **AES-256-GCM sealed**    | Never in the browser, a log, an error, a build artifact or source control               |
| Family deadline, state (`active`/`revoked`/`disabled`), revision | same row, plain metadata                                        | Framebriar is the authority for the deadline; this app never extends it                 |
| A redemption in flight                                           | `framebriar_redemptions` (one per account): the attempt id      | Written **before** the network call; removed in the same transaction as the enrollment  |
| The invitation                                                   | **nowhere**                                                     | Used for one call and discarded; the browser holds it in memory only for a retry        |
| The account generation                                           | `users.generation`, a random uuid set when the user row is made | Part of every key; a recreated account gets a new one, so it can never match an old row |

Both tables reference `users(id, generation)` with `ON DELETE CASCADE`, so a row can only exist for the generation that made it.
(Cascading is a backstop only: account deletion must call `revokeAndEraseEnrollment` first, see below.)

The sealed value is bound to the owner, the generation and the key version as additional authenticated data, so a ciphertext copied to
another account or key version does not open. The browser's local outbox is namespaced by `outboxKey`, a digest of owner and
generation: opaque, per account, never reused, and carrying no owner id or email.

## The key ring: `FRAMEBRIAR_CREDENTIAL_KEYS`

A **Preview-only** secret. Format (JSON, one line):

```json
{ "current": "k1", "keys": { "k1": "<base64 of 32 random bytes>" } }
```

Every version in `keys` can open a row; only `current` seals. Up to 8 versions, names `A-Za-z0-9_-`, at most 16 characters.

**Generate** (the output is the whole secret value; do not paste it anywhere but the two places below):

```sh
printf '{"current":"k1","keys":{"k1":"%s"}}' "$(openssl rand -base64 32)"
```

**Where Caroline puts it** (the same value in both, as with the other secrets):

1. Vercel project, environment **Preview** only, name `FRAMEBRIAR_CREDENTIAL_KEYS`, as a Secret.
2. GitHub **environment `preview`**, secret `FRAMEBRIAR_CREDENTIAL_KEYS`. The deploy step "Inject deployment secrets" writes it into the
   pulled env file (`vercel pull` cannot read a Vercel Secret), because the build bakes the function environment from that file.

Never set it in Production or in the `production` GitHub environment; the injection script never writes it for a production run even
if it is present.

**Until it exists, or if it is invalid, the deploy still succeeds.** The injection step leaves the variable out, the routes answer
`status: "unavailable"`, and feedback shows as unavailable on Preview. Nothing else in the app changes. The deploy log says which
case it was (`FRAMEBRIAR_CREDENTIAL_KEYS injected | omitted | invalid`), never the value.

**Rotate:**

1. Add a new version and make it current: `{"current":"k2","keys":{"k1":"…","k2":"<new>"}}`. Update both places and let a Preview deploy
   finish. New seals use `k2`; each existing row is re-sealed under `k2` the next time that account's enrollment is used.
2. Check what is left on `k1`: `select key_version, count(*) from framebriar_enrollments group by 1;`
3. When nothing is on `k1` (or after 30 days, the longest an enrollment lives), remove `k1` from the ring.

**Loss:** a lost or wrong key cannot be recovered, and it is handled in two different ways on purpose:

- **The secret is missing entirely** (the variable is absent, empty or not a valid ring): status is `unavailable`. Nothing is judged or
  erased, because a missing secret is a configuration problem, not lost data. Put the ring back and everything works again.
- **A valid ring is present but cannot open an account's row** (that row's key version was removed from the ring, or the value is a
  different key): status is `needs_reconnect`. The credential is unreachable, so the person redeems a **new invitation**, which
  replaces the row (same attempt-id rules as any redemption, and a compare-and-swap on the row revision so it never overwrites a
  row that changed meanwhile). **Disconnect** also works: it erases the row and answers `revoked: false`, because nothing was revoked.
  The old Framebriar family can no longer be revoked from here; it simply ends at its fixed deadline (30 days). Tell the Framebriar owner
  if you want it revoked from their side.

So recovering from key loss is: generate a new ring (`openssl` command above), set it in both places, deploy, and have each affected
account redeem a new invitation.

## Behaviour that matters

- **Redemption** is exactly-once from the person's side. The attempt id is persisted first. If the answer is lost (timeout, network, 5xx,
  garbage), the invitation may be spent upstream: the status says `redemption: "pending"` and the person retries with the same
  invitation; the server reuses the same attempt id for 15 minutes (Framebriar's idempotency window, **to be verified against the live
  service before release**), so no second invitation is spent and no unknown family is created. Success is reported only after the
  encrypted row is committed. A refusal clears the attempt.
- **Refresh** is coalesced: concurrent requests for one account share one refresh in an instance, a cached access token is reused until
  two minutes before it expires, and across instances every write names the row revision it read and loses cleanly (compare and swap),
  so two phones cannot corrupt the credential. The refresh credential does not rotate (a response that tries to is refused). A Framebriar
  rate limit stops further attempts for that account until it has passed.
- **`needs_reconnect`**: see Loss above. It is only ever reported for an `active`, unexpired row; an expired, revoked or disabled row keeps its own status.
- **Fail closed**: an unreachable Framebriar, key ring or database is `UNCERTAIN`/`UNAVAILABLE`, never a guess. A 401 from Framebriar marks the
  enrollment `revoked`, a 403 `disabled`; the status route then says so and nothing more is sent.
- **The report proxy** talks to one fixed address (`FRAMEBRIAR_ENDPOINT` in `framebriar-client.ts`); no request field names a destination. It
  checks authentication, the trusted origin, a rate limit, the exact content type, and size **while reading**; the game, protocol version,
  report id and build id shape; and for a screenshot the PNG signature, size and SHA-256 against what the report declares. It answers
  `ready` only for a receipt with the same report id and game, and keeps no byte after delivery. Vercel rejects request bodies over about
  4.5 MB before they reach the app, so a large screenshot answers 413 even though the SDK allows 8 MiB: the real limit is part of the
  separately approved Preview check.
- **Production**: the whole path is compiled out. `next.config.ts` resolves `@/server/feedback/runtime` to `runtime.disabled.ts` (four
  handlers that answer 404) in every build that is not stable Preview, local development or the e2e build, and
  `npm run check:no-feedback-in-build` fails a Production build that contains the marker `framebriar-enrollment-server`.

## Account deletion (follow-up, not wired here)

`revokeAndEraseEnrollment(ownerId)` in `enrollment-service.ts` is the seam #254's confirmed deletion must call **before** the account row
goes. It revokes the family at Framebriar, then erases every sealed credential, and returns what actually happened:

| Result                                                | Meaning                                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ status: "none" }`                                  | Nothing was held.                                                                                                                                                                              |
| `{ status: "erased", revoked, unrevocableAttempts }`  | Gone. `revoked: false` means the family was already dead; `unrevocableAttempts` counts lost-answer redemptions Framebriar cannot revoke without their credential (they end at their deadline). |
| `{ status: "partial", revoked: true, erased: false }` | The family is revoked but the row is still there. Not complete: retry.                                                                                                                         |
| `{ status: "failed", reason }`                        | Nothing changed (`unavailable`, `uncertain`, or `pending-redemption`: a retryable redemption exists). Not complete: retry.                                                                     |

Deletion reports success only for `none` or `erased`. Anything else lands the person in #254's "Finish account closure" recovery and they
retry; there is no background retry queue. Reports already delivered to Framebriar are not deleted (the protocol has no delete-by-account).

## Tests

Synthetic only: `src/server/feedback/__fixtures__/fake-service.ts` stands in for Framebriar (no SDK, no network). Covered: two accounts,
two devices, cleared-browser recovery, account generation non-reuse, expiry/revoked/disabled/quota/unavailable, failed-redemption
recovery with the same attempt id, concurrent refresh, key rotation and loss, the proxy's body/type/size/SSRF/origin rejections, the
deletion seam's partial failures, and that no secret, email or owner id appears in a response, a log line or the database row.
