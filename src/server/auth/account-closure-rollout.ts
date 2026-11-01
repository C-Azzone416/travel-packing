import "server-only";

type Env = Record<string, string | undefined>;

/** Destructive account closure is available only after an explicit server-side opt-in. */
export function accountClosureEnabled(env: Env = process.env): boolean {
  return env.CLOSE_ACCOUNT_ENABLED === "1";
}
