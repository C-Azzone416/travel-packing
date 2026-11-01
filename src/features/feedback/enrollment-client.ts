// The browser's whole view of the Framebriar enrollment (#260). The enrollment itself lives on the app server (#259), encrypted,
// owned by the signed-in account; the browser holds no refresh or access credential, no invitation, and sends no owner id,
// email or destination. These four calls are same-origin `fetch`es that carry the session cookie, and every answer is reduced
// to a closed set of results the UI can describe truthfully. Nothing here is stored, retried or logged.
// feedback-enrollment-client

export const ENROLLMENT_PATH = "/api/feedback/enrollment";
export const REDEEM_PATH = `${ENROLLMENT_PATH}/redeem`;
export const DISCONNECT_PATH = `${ENROLLMENT_PATH}/disconnect`;

export type EnrollmentState =
  | "unavailable"
  | "not-connected"
  | "connected"
  /** The server holds an enrollment it can no longer open (its key was retired or lost): a new invitation replaces it. */
  | "needs_reconnect"
  | "expired"
  | "revoked"
  | "disabled";

const STATES: readonly EnrollmentState[] = [
  "unavailable",
  "not-connected",
  "connected",
  "needs_reconnect",
  "expired",
  "revoked",
  "disabled",
];

/** The server's answer to "what is my enrollment", as the status route sends it. */
export interface EnrollmentView {
  status: EnrollmentState;
  expiresAt: string | null;
  /** A redemption was started and its answer was lost: paste the SAME invitation again to finish. */
  redemption: "none" | "pending";
  /** The server holds an enrollment in any state, or a redemption attempt: Disconnect has something to remove. */
  hasRecord: boolean;
  /** Opaque, URL-safe, tied to the account (and its generation). The only thing the browser may name its storage with. */
  outboxKey: string | null;
}

const OUTBOX_KEY = /^[A-Za-z0-9_-]{16,64}$/;

export type EnrollmentRead =
  | { kind: "ok"; view: EnrollmentView }
  /** 401 or 403: there is no signed-in, allowed account behind this page any more. */
  | { kind: "signed-out" }
  | { kind: "offline" }
  | { kind: "error"; retryAfterSeconds: number | null };

export type RedeemResult =
  | { kind: "connected"; expiresAt: string | null }
  /** An active enrollment already exists; nothing was spent. */
  | { kind: "already-connected" }
  | { kind: "rejected" }
  /** Framebriar did not answer clearly: the invitation may be spent. Pasting the same one again finishes it, once. */
  | { kind: "uncertain" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable" }
  | { kind: "signed-out" }
  | { kind: "offline" };

/** What a successful Disconnect really did (#304): the access was ended, there was nothing to end, or the app's copy is erased but
 * the access itself could not be ended and runs to Framebriar's fixed deadline. */
export type DisconnectOutcome = "ended" | "nothing" | "erased_unrevocable";
/** Why a Disconnect changed nothing (or not everything): each can be repeated. */
export type DisconnectFailure = "partial" | "unavailable" | "uncertain" | "pending";

const OUTCOMES: readonly DisconnectOutcome[] = ["ended", "nothing", "erased_unrevocable"];

export type DisconnectResult =
  | { kind: "done"; outcome: DisconnectOutcome }
  | { kind: "failed"; reason: DisconnectFailure }
  | { kind: "signed-out" }
  | { kind: "offline" };

type Fetch = typeof fetch;

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
  retryAfterSeconds: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One request. A thrown fetch is "offline"; anything else is an answer, with its JSON body only when it is the v1 shape. */
async function ask(fetchImpl: Fetch, path: string, init: RequestInit): Promise<Answer | "offline"> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
  } catch {
    return "offline";
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (isRecord(parsed) && parsed.v === 1) body = parsed;
  } catch {
    // Not JSON (a proxy error page): the status alone decides.
  }
  const header = response.headers.get("retry-after");
  const fromBody =
    body && typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
  const fromHeader = header && /^\d{1,6}$/.test(header) ? Number(header) : null;
  return { status: response.status, body, retryAfterSeconds: fromBody ?? fromHeader };
}

const errorCode = (answer: Answer): string | null =>
  answer.body && typeof answer.body.error === "string" ? answer.body.error : null;

/** 401 (no session) or 403 FORBIDDEN (not on the allowlist). A 403 BAD_ORIGIN is a different problem and is not this. */
const signedOut = (answer: Answer) =>
  answer.status === 401 || (answer.status === 403 && errorCode(answer) !== "BAD_ORIGIN");

function readView(body: Record<string, unknown>): EnrollmentView | null {
  const { status, expiresAt, redemption, hasRecord, outboxKey } = body;
  if (!STATES.includes(status as EnrollmentState)) return null;
  if (redemption !== "none" && redemption !== "pending") return null;
  if (typeof hasRecord !== "boolean") return null;
  if (expiresAt !== null && typeof expiresAt !== "string") return null;
  if (outboxKey !== null && !(typeof outboxKey === "string" && OUTBOX_KEY.test(outboxKey)))
    return null;
  return {
    status: status as EnrollmentState,
    expiresAt: expiresAt === null ? null : (expiresAt as string),
    redemption,
    hasRecord,
    outboxKey: outboxKey === null ? null : (outboxKey as string),
  };
}

export async function readEnrollment(fetchImpl: Fetch = fetch): Promise<EnrollmentRead> {
  const answer = await ask(fetchImpl, ENROLLMENT_PATH, { method: "GET" });
  if (answer === "offline") return { kind: "offline" };
  if (signedOut(answer)) return { kind: "signed-out" };
  const view = answer.status === 200 && answer.body ? readView(answer.body) : null;
  return view
    ? { kind: "ok", view }
    : { kind: "error", retryAfterSeconds: answer.retryAfterSeconds };
}

/** Redeems a pasted invitation once. The value is passed straight through: it is not kept, logged or retried here. */
export async function redeemInvitation(
  invitation: string,
  fetchImpl: Fetch = fetch,
): Promise<RedeemResult> {
  const answer = await ask(fetchImpl, REDEEM_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invitation }),
  });
  if (answer === "offline") return { kind: "offline" };
  if (signedOut(answer)) return { kind: "signed-out" };
  const code = errorCode(answer);
  if (answer.status === 200 && answer.body?.status === "connected") {
    const expiresAt = answer.body.expiresAt;
    return { kind: "connected", expiresAt: typeof expiresAt === "string" ? expiresAt : null };
  }
  if (answer.status === 409 && code === "ALREADY_CONNECTED") return { kind: "already-connected" };
  if (answer.status === 422) return { kind: "rejected" };
  if (answer.status === 502) return { kind: "uncertain" };
  if (answer.status === 429)
    return { kind: "rate-limited", retryAfterSeconds: answer.retryAfterSeconds };
  return { kind: "unavailable" };
}

/** Ends the enrollment at Framebriar and on the server. Only ever called from an explicit Disconnect, never by sign-out. */
export async function disconnectEnrollment(fetchImpl: Fetch = fetch): Promise<DisconnectResult> {
  const answer = await ask(fetchImpl, DISCONNECT_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (answer === "offline") return { kind: "offline" };
  if (signedOut(answer)) return { kind: "signed-out" };
  const outcome = answer.body?.outcome;
  if (
    answer.status === 200 &&
    answer.body?.status === "not-connected" &&
    OUTCOMES.includes(outcome as DisconnectOutcome)
  ) {
    return { kind: "done", outcome: outcome as DisconnectOutcome };
  }
  const code = errorCode(answer);
  if (answer.status === 409 && code === "PENDING_REDEMPTION")
    return { kind: "failed", reason: "pending" };
  if (answer.status === 503 && code === "PARTIAL") return { kind: "failed", reason: "partial" };
  if (answer.status === 502 && code === "UNCERTAIN") return { kind: "failed", reason: "uncertain" };
  return { kind: "failed", reason: "unavailable" };
}
