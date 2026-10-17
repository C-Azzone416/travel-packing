// The typed result every data-layer entry point returns, so the UI can show truthful Saving / Saved / Error
// states (#19). Messages are generic by design: they never contain trip dates, destinations, item names,
// emails, or provider/database error text.

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  /** A domain rule refused the change (e.g. markReady before everything is packed). */
  | "REJECTED"
  /** A lookup the change depends on (e.g. resolving a place) is unavailable right now. Nothing was saved. */
  | "UNAVAILABLE"
  | "INTERNAL";

export interface ServiceError {
  code: ErrorCode;
  message: string;
  /** For REJECTED: the domain's machine-readable reason (e.g. NOT_ALL_PACKED). Contains no user data. */
  reason?: string;
  /** For INVALID_INPUT: the field paths that failed (never their values). */
  fields?: string[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

const MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Access denied",
  NOT_FOUND: "Not found",
  INVALID_INPUT: "Invalid input",
  REJECTED: "That change isn't allowed right now",
  UNAVAILABLE: "That isn't available right now. Try again.",
  INTERNAL: "Something went wrong",
};

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(
  code: ErrorCode,
  extra: Pick<ServiceError, "reason" | "fields"> = {},
): Result<never> {
  return { ok: false, error: { code, message: MESSAGES[code], ...extra } };
}
