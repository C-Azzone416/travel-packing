// The only way auth code logs. Events are a closed set of codes with no free-form fields, so an email,
// token, session id, or error message cannot be passed in by construction (and cannot leak through a
// careless `String(error)`).

export type AuthEvent =
  | "sign-in-succeeded"
  | "sign-in-failed"
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
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,47}$/;

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
  if (typeof detail.code === "string") {
    const upper = detail.code.toUpperCase();
    safe.code = SAFE_CODE.test(upper) ? upper : "OTHER";
  }
  return safe;
}

export function logAuthEvent(event: AuthEvent, detail?: ProviderDetail): void {
  sink(JSON.stringify({ scope: "auth", event, ...safeDetail(detail) }));
}

/**
 * Logged once when the auth runtime starts: how many addresses the deployed allowlist holds and a keyed fingerprint of it
 * (see allowlist-fingerprint.ts). Never the addresses. Anything that is not a small count and 12 hex characters is dropped.
 */
export function logAllowlistLoaded(count: number, fingerprint: string): void {
  const safeCount = Number.isInteger(count) && count >= 0 && count <= 9999 ? count : -1;
  const safePrint = /^[0-9a-f]{12}$/.test(fingerprint) ? fingerprint : "invalid";
  sink(
    JSON.stringify({
      scope: "auth",
      event: "allowlist-loaded",
      entries: safeCount,
      fingerprint: safePrint,
    }),
  );
}
