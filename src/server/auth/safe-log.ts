// The only way auth code logs. Events are a closed set of codes with no free-form fields, so an email,
// token, session id, or error message cannot be passed in by construction (and cannot leak through a
// careless `String(error)`).

export type AuthEvent =
  | "sign-in-succeeded"
  | "sign-in-failed"
  | "sign-in-denied"
  | "sign-in-rate-limited"
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

export function logAuthEvent(event: AuthEvent): void {
  sink(JSON.stringify({ scope: "auth", event }));
}
