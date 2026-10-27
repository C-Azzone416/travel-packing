// Sends one reviewed report to the app's own authenticated route (#260), in the shape the SDK's durable outbox expects of a
// transport. The SDK's own transport wants an HTTPS endpoint and a Bearer token; here the browser holds no token at all, the
// session cookie authorizes the request and the server holds the Framebriar credential (#259). Every outcome is mapped to one of
// the SDK's delivery codes so its outbox keeps, retries, backs off or gives up on the report exactly as designed:
//   - "access-required": the enrollment or the session is not usable right now. Kept, retried in five minutes.
//   - "quota" / "unavailable" / "network": kept, retried with backoff (and the server's Retry-After when it sent one).
//   - "invalid-media" / "permanent" / "conflict": the report can never be accepted as it is. Kept on this device, never resent.
//   - "invalid-ack": the answer did not match this report, so it is treated as not delivered.
// feedback-delivery-proxy

import { FeedbackSubmitError } from "@masra91/framebriar/browser/submit-feedback";
import type { NormalizedReport } from "@masra91/framebriar/protocol";

export const REPORTS_PATH = "/api/feedback/reports";
export const DELIVERY_TIMEOUT_MS = 60_000;

/** Enrollment problems the server names on a 409. The status route reports the same; the caller refreshes it. */
export type EnrollmentProblem = "NOT_CONNECTED" | "EXPIRED" | "REVOKED" | "DISABLED";
const PROBLEMS: readonly string[] = ["NOT_CONNECTED", "EXPIRED", "REVOKED", "DISABLED"];

export interface DeliveryOptions {
  fetchImpl?: typeof fetch;
  /** False stops a send before any request (nothing to send with while the enrollment is not connected). */
  isConnected?: () => boolean;
  /** Called when the server says the enrollment itself is the problem, so the UI can show the truth at once. */
  onEnrollmentProblem?: (problem: EnrollmentProblem) => void;
  /** Called when the server says "too many for now", so the UI can say reports are waiting. */
  onRateLimited?: (retryAfterSeconds: number | null) => void;
  timeoutMs?: number;
}

interface SendInput {
  report: NormalizedReport;
  media: Blob | null;
  signal?: AbortSignal;
}

const fail = (code: string, message: string, retryAfterMs?: number): never => {
  const error = new FeedbackSubmitError(code, message);
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  throw error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createProxySend(options: DeliveryOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DELIVERY_TIMEOUT_MS;

  return async function send({ report, media, signal }: SendInput) {
    if (options.isConnected && !options.isConnected()) {
      fail("access-required", "Feedback is not connected.");
    }
    if (signal?.aborted) fail("cancelled", "Delivery was cancelled; the report is kept.");

    // Two parts and nothing else: the reviewed report, and the PNG when the report says it has one.
    const form = new FormData();
    form.append(
      "report",
      new Blob([JSON.stringify(report)], { type: "application/json" }),
      "report.json",
    );
    if (media) form.append("media", new Blob([media], { type: "image/png" }), "media.png");

    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(REPORTS_PATH, {
        method: "POST",
        body: form,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      if (signal?.aborted) fail("cancelled", "Delivery was cancelled; the report is kept.");
      return fail("network", "Delivery could not be confirmed. The report is kept.");
    }

    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await response.json();
      if (isRecord(parsed) && parsed.v === 1) body = parsed;
    } catch {
      // Not JSON: the status alone decides.
    }
    const retryHeader = response.headers.get("retry-after");
    const seconds =
      body && typeof body.retryAfterSeconds === "number"
        ? body.retryAfterSeconds
        : retryHeader && /^\d{1,6}$/.test(retryHeader)
          ? Number(retryHeader)
          : null;
    const retryAfterMs = seconds === null ? undefined : seconds * 1000;
    const code = body && typeof body.error === "string" ? body.error : null;

    if (response.ok) {
      const ok =
        response.status === 200 &&
        body !== null &&
        body.id === report.id &&
        body.gameId === report.gameId &&
        body.status === "ready";
      if (!ok) fail("invalid-ack", "The answer did not match this report. It is kept.");
      return Object.freeze({ id: report.id, gameId: report.gameId, status: "ready" });
    }

    const { status } = response;
    if (status === 401 || (status === 403 && code !== "BAD_ORIGIN")) {
      return fail("access-required", "You are not signed in for feedback.");
    }
    if (status === 409 && code && PROBLEMS.includes(code)) {
      options.onEnrollmentProblem?.(code as EnrollmentProblem);
      return fail("access-required", "Feedback is not connected.");
    }
    if (status === 413) {
      // Too big for this route (the host's request limit): nothing about retrying changes that.
      return report.media
        ? fail("invalid-media", "This report's screenshot is too large to send.")
        : fail("permanent", "This report is too large to send.");
    }
    if (status === 429) {
      options.onRateLimited?.(seconds);
      return fail("quota", "Feedback is limited for now.", retryAfterMs);
    }
    if (status === 502 || status === 503 || status === 408 || status >= 500) {
      return fail("unavailable", "Feedback is temporarily unavailable.", retryAfterMs);
    }
    // 400, 403 BAD_ORIGIN, 415 and anything else 4xx: this request cannot succeed as it is.
    return fail("permanent", "The server rejected this report.");
  };
}
