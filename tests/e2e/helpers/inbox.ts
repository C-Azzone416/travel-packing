import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The e2e fake sign-in "emails" verification codes and reset links into files (src/server/auth/e2e-provider.ts), so a
// test reads its inbox the way a person would. Everything lives in the temp state dir and is random per run: no real
// address, code or token is ever in source, a log, or a screenshot's filename.
const STATE_DIR = join(process.cwd(), "test-results", "e2e-sessions");
const hex = (email: string) => Buffer.from(email.trim().toLowerCase()).toString("hex");

/** Forget the account and anything "emailed" to it, so a test can sign up from scratch. */
export function resetAccount(email: string): void {
  const tag = hex(email);
  if (!existsSync(STATE_DIR)) return;
  for (const name of readdirSync(STATE_DIR)) {
    if (name.endsWith(tag)) rmSync(join(STATE_DIR, name), { force: true });
  }
}

/** The six-digit code most recently emailed to this address, or null if none was sent. */
export function verificationCode(email: string): string | null {
  const file = join(STATE_DIR, `inbox-verify-${hex(email)}`);
  return existsSync(file) ? readFileSync(file, "utf8").split(":")[0] : null;
}

/** The reset-link token most recently emailed to this address, or null if none was sent. */
export function resetToken(email: string): string | null {
  const file = join(STATE_DIR, `inbox-reset-${hex(email)}`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** A six-digit code that is not the current one. */
export function wrongCodeFor(email: string): string {
  return verificationCode(email) === "000000" ? "000001" : "000000";
}

/** The next unused slot in the newcomer pool (a counter in the temp state dir, so retries never reuse a slot too soon). */
export function nextNewcomerSlot(): number {
  const file = join(STATE_DIR, "newcomer-slot");
  mkdirSync(STATE_DIR, { recursive: true });
  const slot = existsSync(file) ? Number(readFileSync(file, "utf8")) || 0 : 0;
  writeFileSync(file, String(slot + 1));
  return slot;
}
