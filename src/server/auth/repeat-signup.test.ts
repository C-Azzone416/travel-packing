// #119. Caroline, already set up and signing in fine, submitted the sign-up form with her own address by accident, and then could
// not sign in. Whatever the real cause turns out to be, this must hold: a repeat sign-up for an existing, verified, set-up
// account changes NOTHING about it (password, verified state, setup record, sessions), looks like any other sign-up to the person,
// and leaves "Forgot password" working. Run with the e2e-only provider (it models the real one: a taken address is a no-op) and the
// real services and sign-in gate. The real provider's behaviour for a taken address is the library's (Better Auth returns a
// synthetic success or a 422 and never touches the stored user); confirm on the preview with the logs (see docs/auth-screens.md).

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import {
  requestPasswordReset,
  resendVerificationCode,
  resetOwnerPassword,
  signUpOwner,
  verifyOwnerEmail,
} from "./account-flows";
import { createMemorySetupStore, withSetupGate } from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { createE2eAuthProvider } from "./e2e-provider";
import { createFlowLimits } from "./flow-limits";
import { authorizeOwner } from "./guard";
import { setAuthLogSink } from "./safe-log";
import { createSetupSeals } from "./setup-seal";
import { signInOwner } from "./sign-in";

const OWNER = "owner@example.test";
const PASSWORD = "the-owners-real-password";
const NEW_PASSWORD = "a-brand-new-password-1";
const hex = (email: string) => Buffer.from(email).toString("hex");
const seals = createSetupSeals("s".repeat(40));
const redirectTo = (email: string) =>
  `https://app.example.test/reset-password?for=${seals.seal(email)}&setup=1`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let dir = "";
const dirs: string[] = [];
let env: Record<string, string> = {};
let limits = createFlowLimits();
let events: string[] = [];
let setup: ReturnType<typeof createMemorySetupStore>;
let auth: Parameters<typeof signInOwner>[0] & {
  setup: typeof setup;
  seals: ReturnType<typeof createSetupSeals>;
};
afterAll(() => dirs.forEach((made) => rmSync(made, { recursive: true, force: true })));

const file = (name: string) => join(dir, `${name}-${hex(OWNER)}`);
const account = () =>
  JSON.parse(readFileSync(file("acct"), "utf8")) as { password: string; verified: boolean };
const emailedLink = () => {
  const { token, redirectTo: to } = JSON.parse(readFileSync(file("inbox-reset"), "utf8")) as {
    token: string;
    redirectTo: string;
  };
  return { token, sealed: new URL(to).searchParams.get("for") };
};

/** Sign up (email only), verify with the mailed code, set the password through the emailed link, and sign in once. */
async function setUpOwner() {
  await signUpOwner(auth, limits, "1.1.1.1", OWNER);
  const code = readFileSync(file("inbox-verify"), "utf8").split(":")[0];
  await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code, redirectTo);
  const { token, sealed } = emailedLink();
  expect(await resetOwnerPassword(auth, token, PASSWORD, sealed)).toEqual({ status: "ok" });
  await tick();
  expect(await signInOwner(auth, OWNER, PASSWORD)).toBe("ok");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repeat-signup-"));
  dirs.push(dir);
  env = { AUTH_E2E_FAKE: "1", AUTH_E2E_PASSWORD: "synthetic-e2e-only", AUTH_E2E_STATE_DIR: dir };
  limits = createFlowLimits();
  jar.clear();
  events = [];
  setAuthLogSink(
    (event) => void events.push(typeof event === "string" ? event : JSON.stringify(event)),
  );
  setup = createMemorySetupStore();
  auth = {
    provider: withSetupGate(createE2eAuthProvider(env), setup, parseAllowlist(OWNER)),
    allowlist: parseAllowlist(OWNER),
    setup,
    seals,
  };
});

describe("signing up again with the address of an account that is already set up", () => {
  it("changes nothing: the password, the verified state, the setup record and the session all stay", async () => {
    await setUpOwner();
    const before = { account: account(), setUpAt: await setup.completedAt(OWNER) };
    expect(before.account).toMatchObject({ password: PASSWORD, verified: true });

    // Several times, as a person who is not sure it went through would.
    for (let again = 0; again < 3; again++) {
      limits = createFlowLimits();
      expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER)).toMatchObject({
        status: "ok",
        email: OWNER,
      });
    }

    expect(account()).toEqual(before.account);
    expect(await setup.completedAt(OWNER)).toBe(before.setUpAt);
    // No code was mailed for an account that is already verified, and the session from before is still good.
    expect(existsSync(file("inbox-verify"))).toBe(false);
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("ok");
    // And the real password still signs in, from a fresh start.
    await auth.provider.signOut();
    await tick();
    expect(await signInOwner(auth, OWNER, PASSWORD)).toBe("ok");
  });

  it("looks exactly like any other sign-up: the same answer, and the same log line apart from the provider's own", async () => {
    const fresh = await signUpOwner(auth, limits, "1.1.1.1", "someone@example.test");
    expect(fresh.status).toBe("ok");
    await setUpOwner();
    limits = createFlowLimits();
    const again = await signUpOwner(auth, limits, "1.1.1.1", OWNER);
    expect(again.status).toBe("ok");
    expect(JSON.stringify(events)).not.toContain(OWNER);
  });

  it("'Send a new code' on the code screen does not unverify it or touch its password", async () => {
    await setUpOwner();
    limits = createFlowLimits();
    expect((await resendVerificationCode(auth, limits, "1.1.1.1", OWNER)).status).toBe("ok");
    expect(account()).toMatchObject({ password: PASSWORD, verified: true });
    expect(existsSync(file("inbox-verify"))).toBe(false);
  });

  it("'Forgot password' afterwards still emails a link, and using it sets a new password that signs in", async () => {
    await setUpOwner();
    limits = createFlowLimits();
    await signUpOwner(auth, limits, "1.1.1.1", OWNER);
    limits = createFlowLimits();
    expect(
      (await requestPasswordReset(auth, limits, "1.1.1.1", OWNER, redirectTo(OWNER))).status,
    ).toBe("ok");
    const { token, sealed } = emailedLink();
    expect(await resetOwnerPassword(auth, token, NEW_PASSWORD, sealed)).toEqual({ status: "ok" });
    await tick();
    expect(await signInOwner(auth, OWNER, PASSWORD)).toBe("invalid");
    expect(await signInOwner(auth, OWNER, NEW_PASSWORD)).toBe("ok");
  });
});
