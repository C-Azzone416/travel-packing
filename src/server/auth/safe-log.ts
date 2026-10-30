// The only way auth code logs. Events are a closed set of codes with no free-form fields, so an email,
// token, session id, or error message cannot be passed in by construction (and cannot leak through a
// careless `String(error)`).

export type AuthEvent =
  | "sign-in-succeeded"
  | "sign-in-failed"
  | "sign-in-input-invalid"
  | "sign-in-credentials-rejected"
  | "sign-in-provider-rate-limited"
  | "sign-in-provider-unavailable"
  | "sign-in-provider-rejected"
  | "sign-in-provider-response-invalid"
  | "sign-in-session-not-created"
  | "sign-in-session-cleanup-failed"
  | "sign-in-setup-unavailable"
  | "sign-in-unavailable"
  | "sign-in-denied"
  | "sign-in-unverified"
  | "sign-in-setup-pending"
  | "account-setup-completed"
  | "sign-in-rate-limited"
  | "sign-up-requested"
  | "sign-up-failed"
  // Why a sign-up, code or link did or did not reach the provider (server-only; the browser sees the same answer for all).
  | "sign-up-skipped-allowlist"
  | "sign-up-skipped-cooldown"
  | "sign-up-skipped-limit"
  | "sign-up-provider-ok"
  | "sign-up-provider-rejected"
  | "code-send-skipped-allowlist"
  | "code-send-skipped-cooldown"
  | "code-send-skipped-limit"
  | "code-send-provider-ok"
  | "code-send-provider-rejected"
  | "code-send-provider-failed"
  | "reset-send-skipped-allowlist"
  | "reset-send-skipped-cooldown"
  | "reset-send-skipped-limit"
  | "reset-send-provider-ok"
  | "reset-send-provider-rejected"
  | "reset-send-provider-failed"
  | "verification-succeeded"
  | "verification-failed"
  | "verification-denied"
  | "code-sent"
  | "password-reset-requested"
  | "password-reset-succeeded"
  | "password-reset-failed"
  | "flow-rate-limited"
  | "sign-out"
  | "unauthenticated"
  | "forbidden"
  | "provider-error";

export type AccountClosureProviderOutcome =
  | "confirmed"
  | "provider-rejected"
  | "transport-error"
  | "nonterminal-response"
  | "unexpected-cookie-mutation"
  | "early-error";

export type AuthLogSink = (line: string) => void;

const defaultSink: AuthLogSink = (line) => console.info(line);

let sink: AuthLogSink = defaultSink;

/** Test hook: capture log lines. Pass nothing to restore the default. */
export function setAuthLogSink(next?: AuthLogSink): void {
  sink = next ?? defaultSink;
}

/**
 * What a provider said when it refused a call, reduced to two safe facts: the HTTP status (three digits) and the provider's
 * machine error code (upper-case letters, digits and underscores, never its message, which can echo input).
 */
export interface ProviderDetail {
  status?: number;
  code?: string;
  reference?: string;
}

/** Provider codes that are useful for operations and known not to contain user input. Everything else is OTHER. */
const SAFE_PROVIDER_CODES = new Set([
  "CREDENTIAL_ACCOUNT_NOT_FOUND",
  "EMAIL_NOT_VERIFIED",
  "EMAIL_PASSWORD_DISABLED",
  "FAILED_TO_CREATE_SESSION",
  "INTERNAL_ERROR",
  "INVALID_EMAIL",
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_ORIGIN",
  "INVALID_PASSWORD",
  "INVALID_OTP",
  "INVALID_REDIRECT_URL",
  "INVALID_TOKEN",
  "NETWORK_ABORT",
  "NETWORK_DNS",
  "NETWORK_ERROR",
  "NETWORK_REFUSED",
  "NETWORK_RESET",
  "NETWORK_TIMEOUT",
  "NETWORK_TLS",
  "PASSWORD_TOO_LONG",
  "PASSWORD_TOO_SHORT",
  "SESSION_EXPIRED",
  "TOO_MANY_ATTEMPTS",
  "UNAUTHORIZED",
  "USER_ALREADY_EXISTS",
  "USER_NOT_FOUND",
  "UNEXPECTED_COOKIE_MUTATION",
]);
const REFERENCE = /^[0-9a-f]{12}$/;

/** A short random support reference. It identifies one attempt and is never derived from an address or credential. */
export function createAuthReference(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function safeDetail(detail: ProviderDetail | undefined): ProviderDetail {
  if (!detail) return {};
  const safe: ProviderDetail = {};
  if (
    Number.isInteger(detail.status) &&
    (detail.status as number) >= 100 &&
    (detail.status as number) <= 599
  ) {
    safe.status = detail.status;
  }
  if (typeof detail.code === "string" && detail.code.length > 0) {
    const upper = detail.code.toUpperCase();
    safe.code = SAFE_PROVIDER_CODES.has(upper) ? upper : "OTHER";
  }
  if (typeof detail.reference === "string" && REFERENCE.test(detail.reference))
    safe.reference = detail.reference;
  return safe;
}

export function logAuthEvent(event: AuthEvent, detail?: ProviderDetail): void {
  sink(JSON.stringify({ scope: "auth", event, ...safeDetail(detail) }));
}

/**
 * Preview-only account-closure observability. The shape is deliberately closed: no response body, message,
 * identity, credential or request value can be supplied. Production emits nothing even if a caller invokes it.
 */
export function logAccountClosureProviderCall(
  detail: {
    outcome: AccountClosureProviderOutcome;
    status?: number;
    code?: string;
    elapsedMs: number;
  },
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.VERCEL_ENV !== "preview") return;
  const provider = safeDetail(detail);
  const code =
    detail.outcome === "confirmed" || detail.outcome === "early-error"
      ? provider.code
      : provider.code === undefined || provider.code === "OTHER"
        ? "UNKNOWN"
        : provider.code;
  const elapsedMs =
    Number.isInteger(detail.elapsedMs) && detail.elapsedMs >= 0 && detail.elapsedMs <= 300_000
      ? detail.elapsedMs
      : undefined;
  try {
    sink(
      JSON.stringify({
        scope: "auth",
        event: "account-closure-provider-call",
        stage: "delete-user",
        outcome: detail.outcome,
        ...provider,
        ...(code === undefined ? {} : { code }),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      }),
    );
  } catch {
    // Diagnostics must never change a destructive call's outcome.
  }
}

/**
 * Logged once when the auth runtime starts: how many addresses the deployed allowlist holds, how many of those are not plain
 * addresses (a paste artifact such as quotes can never match a real sign-up), and a keyed fingerprint of it (see
 * allowlist-fingerprint.ts). Never the addresses. Anything that is not a small count and 12 hex characters is dropped.
 */
export function logAllowlistLoaded(count: number, fingerprint: string, malformed = 0): void {
  const small = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= 9999 ? value : -1;
  const safePrint = /^[0-9a-f]{12}$/.test(fingerprint) ? fingerprint : "invalid";
  sink(
    JSON.stringify({
      scope: "auth",
      event: "allowlist-loaded",
      entries: small(count),
      malformed: small(malformed),
      fingerprint: safePrint,
    }),
  );
}
