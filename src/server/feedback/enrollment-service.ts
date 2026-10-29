// Account-scoped Framebriar enrollment (#259): status, redeem, disconnect, access tokens for the report proxy, and the
// revoke-and-erase seam account deletion will call (#254 follow-up). One enrollment belongs to one Packed Smart account,
// identified only by the verified session's owner id plus the account generation, never by anything a request says.
// Fails closed: no usable key ring means "unavailable" and no network call is made. Nothing here logs, and no credential,
// invitation, owner id or provider text appears in any result.

import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db/retention";
import {
  REDEMPTION_WINDOW_MS,
  accountGeneration,
  beginRedemption,
  clearRedemption,
  commitRedemption,
  eraseEnrollment,
  loadEnrollment,
  loadRedemption,
  updateEnrollment,
  type EnrollmentRow,
  type EnrollmentState,
} from "./enrollment-store";
import type { AccessGrant, FramebriarClient } from "./framebriar-client";
import { open, parseKeyRing, seal, type KeyRing, type SealContext } from "./key-ring";

export type EnrollmentStatus =
  | "unavailable"
  | "not-connected"
  | "connected"
  /** A key ring is present but cannot open this account's row (its key version was removed, or the value is wrong): the credential
   * is unreachable, so the person must redeem a new invitation. Distinct from "unavailable", where nothing is touched. */
  | "needs_reconnect"
  | "expired"
  | "revoked"
  | "disabled";

export interface StatusView {
  status: EnrollmentStatus;
  expiresAt: string | null;
  redemption: "none" | "pending";
  /**
   * Whether the server holds anything for this account's current generation: an enrollment row in ANY state (expired, revoked,
   * switched off, unreadable) or a redemption attempt. Disconnect is offered whenever this is true (#304). The status route never
   * calls Framebriar, so this is a database fact only.
   */
  hasRecord: boolean;
  /** Opaque per-account namespace for the browser's local outbox; null only when the database could not be reached. */
  outboxKey: string | null;
}

/** Errors the HTTP layer maps to a status code. They are codes only: no message carries a value from the provider or the account. */
export type EnrollmentError =
  | "UNAVAILABLE"
  | "ALREADY_CONNECTED"
  | "INVITATION_REJECTED"
  | "UNCERTAIN"
  | "RATE_LIMITED"
  | "NOT_CONNECTED"
  | "NEEDS_RECONNECT"
  | "EXPIRED"
  | "REVOKED"
  | "DISABLED"
  /** Disconnect: the access was ended but the saved copy could not be erased yet. Repeating finishes it. */
  | "PARTIAL"
  /** Disconnect: a connection attempt is still pending and may have made access the app holds no credential for. */
  | "PENDING_REDEMPTION";

export type DisconnectOutcome = "ended" | "nothing" | "erased_unrevocable";

export type Failure = { ok: false; code: EnrollmentError; retryAfterSeconds?: number };

export type RevokeAndEraseResult =
  /** Nothing was held for this account. */
  | { status: "none" }
  /** The family is revoked (or already dead at Framebriar) and every sealed credential is gone. `unrevocableAttempts`
   * counts redemption attempts whose answer was lost: Framebriar has no way to revoke them without their credential, so they
   * end at their fixed deadline. */
  | { status: "erased"; revoked: boolean; unrevocableAttempts: number }
  /** The key ring is present but cannot open the credential, so the family could not be revoked. Everything held is erased, and the
   * family lives until Framebriar's fixed deadline. Whether deletion may report success on this is the deletion policy's call (#261),
   * not this module's. */
  | { status: "erased_unrevocable"; unrevocableAttempts: number }
  /** Revocation succeeded, but erasing the credential failed: it is revoked and useless, and must be erased again. */
  | { status: "partial"; revoked: true; erased: false }
  /** Nothing was changed: Framebriar or the key ring or the database was not usable. Try again. */
  | { status: "failed"; reason: "unavailable" | "uncertain" | "pending-redemption" };

export interface EnrollmentServiceOptions {
  db: Db;
  client: FramebriarClient;
  keys?: () => KeyRing | null;
  now?: () => number;
  newAttemptId?: () => string;
}

/** An access token is reused until this close to its expiry, so a phone and a computer share one refresh an hour. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;
/** After Framebriar refuses a refresh with a rate limit, no more attempts for this account until this has passed. */
const MIN_RETRY_MS = 15 * 1000;

interface Credentials {
  refreshToken: string;
  refreshExpiresAt: number;
  access?: { token: string; expiresAt: number };
}

/** The non-reversible, per-generation namespace the browser keys its local outbox by. */
export function outboxKeyFor(ownerId: string, generation: string): string {
  return createHash("sha256")
    .update(`carrywell-feedback-outbox|v1|${ownerId}|${generation}`)
    .digest("base64url");
}

function parseCredentials(text: string | null): Credentials | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const access = value.access as Record<string, unknown> | undefined;
    if (typeof value.refreshToken !== "string" || typeof value.refreshExpiresAt !== "number")
      return null;
    return {
      refreshToken: value.refreshToken,
      refreshExpiresAt: value.refreshExpiresAt,
      ...(access && typeof access.token === "string" && typeof access.expiresAt === "number"
        ? { access: { token: access.token, expiresAt: access.expiresAt } }
        : {}),
    };
  } catch {
    return null;
  }
}

const grantCredentials = (grant: AccessGrant): Credentials => ({
  refreshToken: grant.refreshToken,
  refreshExpiresAt: grant.refreshExpiresAt,
  access: { token: grant.accessToken, expiresAt: grant.accessExpiresAt },
});

export function createEnrollmentService({
  db,
  client,
  keys = () => parseKeyRing(process.env.FRAMEBRIAR_CREDENTIAL_KEYS),
  now = Date.now,
  newAttemptId = randomUUID,
}: EnrollmentServiceOptions) {
  // Concurrent requests for one account share a single refresh in this instance; across instances the row's revision decides.
  const refreshing = new Map<string, Promise<AccessResult>>();
  const coolingDown = new Map<string, number>();

  const context = (row: { ownerId: string; generation: string }): SealContext => ({
    ownerId: row.ownerId,
    generation: row.generation,
  });

  /** Whether the ring in hand can open this row's credential. Only meaningful when there is a ring. */
  const readable = (row: EnrollmentRow, ring: KeyRing): boolean =>
    parseCredentials(open(ring, context(row), row.keyVersion, row.credentials)) !== null;

  function view(row: EnrollmentRow | null, ring: KeyRing | null): EnrollmentStatus {
    // No ring at all is "unavailable": a missing secret must never be read as lost data, so nothing is judged or touched.
    if (!ring) return "unavailable";
    if (!row) return "not-connected";
    if (row.state !== "active") return row.state;
    if (row.expiresAt.getTime() <= now()) return "expired";
    return readable(row, ring) ? "connected" : "needs_reconnect";
  }

  async function status(ownerId: string): Promise<StatusView> {
    const ring = keys();
    let generation: string;
    try {
      generation = await accountGeneration(db, ownerId);
      const row = await loadEnrollment(db, ownerId, generation);
      const pending = await loadRedemption(db, ownerId, generation);
      const live = pending && now() - pending.createdAt.getTime() < REDEMPTION_WINDOW_MS;
      const state = view(row, ring);
      return {
        status: state,
        expiresAt:
          row && state !== "unavailable" && state !== "needs_reconnect"
            ? row.expiresAt.toISOString()
            : null,
        redemption: live ? "pending" : "none",
        hasRecord: row !== null || pending !== null,
        outboxKey: outboxKeyFor(ownerId, generation),
      };
    } catch {
      return {
        status: "unavailable",
        expiresAt: null,
        redemption: "none",
        hasRecord: false,
        outboxKey: null,
      };
    }
  }

  async function redeem(
    ownerId: string,
    invitation: string,
  ): Promise<{ ok: true; status: "connected"; expiresAt: string } | Failure> {
    const ring = keys();
    if (!ring) return { ok: false, code: "UNAVAILABLE" };
    let generation: string;
    let attemptId: string;
    let seen: EnrollmentRow | null;
    try {
      generation = await accountGeneration(db, ownerId);
      seen = await loadEnrollment(db, ownerId, generation);
      // Anything else (none, expired, revoked, disabled, or one this ring cannot open) is replaced by the new enrollment.
      if (view(seen, ring) === "connected") return { ok: false, code: "ALREADY_CONNECTED" };
      // The attempt id is durable before Framebriar hears about it.
      attemptId = await beginRedemption(db, ownerId, generation, new Date(now()), newAttemptId);
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }

    const outcome = await client.redeem({ invitation, attemptId });
    if (outcome.kind === "uncertain") return { ok: false, code: "UNCERTAIN" };
    if (outcome.kind === "rejected") {
      // A refusal means nothing was spent and nothing exists upstream: the attempt is over.
      try {
        await clearRedemption(db, ownerId, generation, attemptId);
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
      if (outcome.status === 429)
        return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: outcome.retryAfterSeconds };
      return { ok: false, code: "INVITATION_REJECTED" };
    }

    const grant = outcome.value;
    try {
      const sealed = seal(ring, { ownerId, generation }, JSON.stringify(grantCredentials(grant)));
      // The replace names the revision it saw: if another writer changed the row meanwhile, nothing is overwritten.
      const committed = await commitRedemption(db, {
        ownerId,
        generation,
        attemptId,
        keyVersion: sealed.keyVersion,
        credentials: sealed.sealed,
        expiresAt: new Date(grant.refreshExpiresAt),
        expectedRevision: seen?.revision ?? null,
      });
      // The attempt stays, so retrying with the same invitation gets the same family back and commits against the fresh row.
      if (!committed) return { ok: false, code: "UNCERTAIN" };
    } catch {
      // Not committed: the attempt stays, so the same invitation retried with the same id recovers the same family.
      return { ok: false, code: "UNAVAILABLE" };
    }
    return {
      ok: true,
      status: "connected",
      expiresAt: new Date(grant.refreshExpiresAt).toISOString(),
    };
  }

  type AccessResult = { ok: true; token: string } | Failure;

  /** The credentials from a row, re-sealed under the current key when it was sealed under an older one. */
  async function usable(
    row: EnrollmentRow,
    ring: KeyRing,
  ): Promise<{ row: EnrollmentRow; credentials: Credentials } | null> {
    const credentials = parseCredentials(open(ring, context(row), row.keyVersion, row.credentials));
    if (!credentials) return null;
    if (row.keyVersion === ring.current) return { row, credentials };
    const sealed = seal(ring, context(row), JSON.stringify(credentials));
    const revision = await updateEnrollment(db, row, {
      keyVersion: sealed.keyVersion,
      credentials: sealed.sealed,
    });
    // Someone else wrote first: the caller's next read sees their row. Either way these credentials are still the live ones.
    return { row: revision === null ? row : { ...row, ...sealed, revision }, credentials };
  }

  async function refreshOnce(ownerId: string, force: boolean, attempt = 0): Promise<AccessResult> {
    const ring = keys();
    if (!ring) return { ok: false, code: "UNAVAILABLE" };
    let generation: string;
    let loaded: EnrollmentRow | null;
    try {
      generation = await accountGeneration(db, ownerId);
      loaded = await loadEnrollment(db, ownerId, generation);
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }
    if (!loaded) return { ok: false, code: "NOT_CONNECTED" };
    if (loaded.state === "revoked") return { ok: false, code: "REVOKED" };
    if (loaded.state === "disabled") return { ok: false, code: "DISABLED" };
    if (loaded.expiresAt.getTime() <= now()) return { ok: false, code: "EXPIRED" };

    let current: { row: EnrollmentRow; credentials: Credentials } | null;
    try {
      current = await usable(loaded, ring);
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }
    // A ring is present (checked above) and cannot open the row: the credential is unreachable, a new invitation is the way back.
    if (!current) return { ok: false, code: "NEEDS_RECONNECT" };
    const { row, credentials } = current;
    if (!force && credentials.access && credentials.access.expiresAt - now() > REFRESH_MARGIN_MS)
      return { ok: true, token: credentials.access.token };

    const wait = (coolingDown.get(ownerId) ?? 0) - now();
    if (wait > 0)
      return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: Math.ceil(wait / 1000) };

    const outcome = await client.refresh(credentials.refreshToken);
    if (outcome.kind === "uncertain") return { ok: false, code: "UNCERTAIN" };
    if (outcome.kind === "rejected") {
      if (outcome.status === 429) {
        coolingDown.set(
          ownerId,
          now() + Math.max(MIN_RETRY_MS, (outcome.retryAfterSeconds ?? 0) * 1000),
        );
        return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: outcome.retryAfterSeconds };
      }
      const state: EnrollmentState = outcome.status === 403 ? "disabled" : "revoked";
      try {
        await updateEnrollment(db, row, { state });
      } catch {
        return { ok: false, code: "UNAVAILABLE" };
      }
      return { ok: false, code: state === "disabled" ? "DISABLED" : "REVOKED" };
    }

    const grant = outcome.value;
    try {
      const sealed = seal(ring, context(row), JSON.stringify(grantCredentials(grant)));
      const revision = await updateEnrollment(db, row, {
        keyVersion: sealed.keyVersion,
        credentials: sealed.sealed,
        expiresAt: new Date(grant.refreshExpiresAt),
      });
      // Another writer won (a refresh on another instance, a disconnect): this token is still valid for this one request, but
      // the stored row is theirs. If it was a refresh, the next call reuses theirs; if it was an erase, this call must not
      // outlive it, so re-check once.
      if (revision === null && attempt === 0) return refreshOnce(ownerId, false, 1);
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }
    return { ok: true, token: grant.accessToken };
  }

  /** A valid access token for this account's enrollment, refreshing it at most once at a time per account. */
  function accessToken(ownerId: string, force = false): Promise<AccessResult> {
    const running = refreshing.get(ownerId);
    if (running) return running;
    const started = refreshOnce(ownerId, force).finally(() => refreshing.delete(ownerId));
    refreshing.set(ownerId, started);
    return started;
  }

  /** Marks the enrollment ended after Framebriar refused an upload with the access token (it was revoked or switched off). */
  async function markEnded(ownerId: string, state: "revoked" | "disabled"): Promise<void> {
    try {
      const generation = await accountGeneration(db, ownerId);
      const row = await loadEnrollment(db, ownerId, generation);
      if (row && row.state === "active") await updateEnrollment(db, row, { state });
    } catch {
      // The next status read shows whatever the database holds; nothing else to do here.
    }
  }

  /**
   * Disconnect, with the real outcome. "ended": Framebriar revoked the access. "nothing": there was nothing to end (no record, or a
   * record that was already dead). "erased_unrevocable": the app's copy is erased but the access itself could not be ended (the
   * credential was unreadable, or a lost connection attempt may have made a family we hold nothing for), so it runs to Framebriar's
   * fixed deadline. Failures change nothing the caller must undo and can be repeated.
   */
  async function disconnect(
    ownerId: string,
  ): Promise<{ ok: true; outcome: DisconnectOutcome; revoked: boolean } | Failure> {
    const result = await revokeAndEraseEnrollment(ownerId);
    switch (result.status) {
      case "none":
        return { ok: true, outcome: "nothing", revoked: false };
      case "erased":
        if (result.revoked) return { ok: true, outcome: "ended", revoked: true };
        return {
          ok: true,
          outcome: result.unrevocableAttempts > 0 ? "erased_unrevocable" : "nothing",
          revoked: false,
        };
      case "erased_unrevocable":
        return { ok: true, outcome: "erased_unrevocable", revoked: false };
      case "partial":
        return { ok: false, code: "PARTIAL" };
      default:
        return {
          ok: false,
          code:
            result.reason === "uncertain"
              ? "UNCERTAIN"
              : result.reason === "pending-redemption"
                ? "PENDING_REDEMPTION"
                : "UNAVAILABLE",
        };
    }
  }

  /**
   * Revokes the account's Framebriar family, then erases every sealed credential. It reports exactly what happened and never
   * erases a credential whose family might still be live: if Framebriar cannot be reached the credential stays, so it can be
   * revoked later. Account deletion calls this and reports success only for "none" or "erased" (the wiring is a follow-up).
   */
  async function revokeAndEraseEnrollment(ownerId: string): Promise<RevokeAndEraseResult> {
    let generation: string;
    let row: EnrollmentRow | null;
    let pending: Awaited<ReturnType<typeof loadRedemption>>;
    try {
      generation = await accountGeneration(db, ownerId);
      row = await loadEnrollment(db, ownerId, generation);
      pending = await loadRedemption(db, ownerId, generation);
    } catch {
      return { status: "failed", reason: "unavailable" };
    }
    // A redemption whose answer was lost may have made a family we hold no credential for. While it can still be retried,
    // finishing it is the only way to revoke it: do not claim an erase that leaves it behind.
    const live = pending && now() - pending.createdAt.getTime() < REDEMPTION_WINDOW_MS;
    if (live) return { status: "failed", reason: "pending-redemption" };
    if (!row) {
      try {
        if (pending) await clearRedemption(db, ownerId, generation);
      } catch {
        return { status: "failed", reason: "unavailable" };
      }
      return pending
        ? { status: "erased", revoked: false, unrevocableAttempts: 1 }
        : { status: "none" };
    }

    let revoked = false;
    if (row.state === "active" && row.expiresAt.getTime() > now()) {
      const ring = keys();
      if (!ring) return { status: "failed", reason: "unavailable" };
      const credentials = parseCredentials(
        open(ring, context(row), row.keyVersion, row.credentials),
      );
      if (!credentials) {
        // A ring that is present but cannot open the row: the family cannot be revoked and the row is useless. Erase it (and any
        // abandoned attempt), and say plainly that nothing was revoked.
        try {
          if (!(await eraseEnrollment(db, row))) throw new Error("not erased");
          if (pending) await clearRedemption(db, ownerId, generation);
        } catch {
          return { status: "failed", reason: "unavailable" };
        }
        return { status: "erased_unrevocable", unrevocableAttempts: pending ? 1 : 0 };
      }
      const outcome = await client.disconnect(credentials.refreshToken);
      if (outcome.kind === "uncertain") return { status: "failed", reason: "uncertain" };
      if (outcome.kind === "rejected") {
        // 401: Framebriar no longer knows this family (expired or already revoked), so there is nothing left to revoke.
        // Anything else (a rate limit, a switch-off) means the revoke did not happen: keep the credential.
        if (outcome.status !== 401) return { status: "failed", reason: "uncertain" };
      } else revoked = true;
    }

    try {
      // A concurrent write moved the revision: nothing was erased, and the caller retries from the fresh row.
      if (!(await eraseEnrollment(db, row))) throw new Error("not erased");
      if (pending) await clearRedemption(db, ownerId, generation);
    } catch {
      return revoked
        ? { status: "partial", revoked: true, erased: false }
        : { status: "failed", reason: "unavailable" };
    }
    return { status: "erased", revoked, unrevocableAttempts: pending ? 1 : 0 };
  }

  return { status, redeem, disconnect, accessToken, markEnded, revokeAndEraseEnrollment };
}

export type EnrollmentService = ReturnType<typeof createEnrollmentService>;
