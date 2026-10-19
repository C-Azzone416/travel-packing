// #83, the attack this exists to stop. Someone who knows the owner's address signs up with it FIRST, with their own password.
// The account stays unverified; when the real owner later enters the mailed code it becomes verified WITH THE ATTACKER'S
// PASSWORD. Run end to end with the e2e-only provider (a real account model with codes and links), the real services, and the
// real sign-in gate: that password must never open a session, however it is tried.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  resetOwnerPassword,
  signUpOwner,
  verifyOwnerEmail,
} from "./account-flows";
import { createMemorySetupStore, withSetupGate } from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { createE2eAuthProvider } from "./e2e-provider";
import { authorizeOwner } from "./guard";
import { createFlowLimits } from "./flow-limits";
import { setAuthLogSink } from "./safe-log";
import { createSetupSeals } from "./setup-seal";
import { signInOwner } from "./sign-in";

// Every test starts from a clean provider (no accounts, no mail) and clean limits.
let dir = "";
let env: Record<string, string> = {};
const dirs: string[] = [];
afterAll(() => dirs.forEach((made) => rmSync(made, { recursive: true, force: true })));

const OWNER = "owner@example.test";
const ATTACKER_PASSWORD = "the-attackers-password";
const OWNER_PASSWORD = "the-owners-real-password";
const hex = (email: string) => Buffer.from(email).toString("hex");
const code = () => readFileSync(join(dir, `inbox-verify-${hex(OWNER)}`), "utf8").split(":")[0];
/** The link as the provider would email it: the app's return address plus the token. */
const emailedLink = () => {
  const { token, redirectTo } = JSON.parse(
    readFileSync(join(dir, `inbox-reset-${hex(OWNER)}`), "utf8"),
  ) as { token: string; redirectTo: string };
  const url = new URL(redirectTo);
  return { token, sealed: url.searchParams.get("for") };
};

let setup: ReturnType<typeof createMemorySetupStore>;
let auth: Parameters<typeof signInOwner>[0] & {
  setup: typeof setup;
  seals: ReturnType<typeof createSetupSeals>;
};
let limits = createFlowLimits();
const seals = createSetupSeals("s".repeat(40));
/** Real people sign in seconds after setting up; the tests need a clock tick between the two (a session must be strictly newer). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const redirectTo = (email: string) =>
  `https://app.example.test/reset-password?for=${seals.seal(email)}&setup=1`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pre-registration-"));
  dirs.push(dir);
  env = { AUTH_E2E_FAKE: "1", AUTH_E2E_PASSWORD: "synthetic-e2e-only", AUTH_E2E_STATE_DIR: dir };
  limits = createFlowLimits();
  jar.clear();
  setup = createMemorySetupStore();
  setAuthLogSink(() => {});
  auth = {
    provider: withSetupGate(createE2eAuthProvider(env), setup, parseAllowlist(OWNER)),
    allowlist: parseAllowlist(OWNER),
    setup,
    seals,
  };
});

describe("a password chosen by someone else before the owner verified", () => {
  it("can never sign in, before or after the owner verifies, and the owner's own password then works", async () => {
    // 1. The attacker signs up with the owner's address and their own password.
    expect((await signUpOwner(auth, limits, "6.6.6.6", OWNER, ATTACKER_PASSWORD)).status).toBe(
      "ok",
    );
    // 2. Unverified: nobody can sign in with it.
    expect(await signInOwner(auth, OWNER, ATTACKER_PASSWORD)).toBe("unverified");

    // 3. The real owner signs up too. The app shows success, but the owner's password is NOT applied (the address exists).
    expect((await signUpOwner(auth, limits, "1.1.1.1", OWNER, OWNER_PASSWORD)).status).toBe("ok");
    expect(await signInOwner(auth, OWNER, OWNER_PASSWORD)).toBe("invalid");

    // 4. The owner enters the mailed code. The address is now verified, with the attacker's password on the account.
    const verified = await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code(), redirectTo);
    expect(verified).toMatchObject({ status: "finish-setup", email: OWNER });

    // 5. THE POINT: that password still opens nothing. Not through sign-in, not through a session the attacker already holds.
    expect(await signInOwner(auth, OWNER, ATTACKER_PASSWORD)).toBe("unfinished");
    expect(await auth.provider.getSession()).toBeNull();
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("unauthenticated");
    // The owner's password does not work either: it was never applied.
    expect(await signInOwner(auth, OWNER, OWNER_PASSWORD)).toBe("invalid");

    // 6. The link went to the owner's inbox. Using it replaces the password and records the account as set up.
    const { token, sealed } = emailedLink();
    expect(await resetOwnerPassword(auth, token, OWNER_PASSWORD, sealed)).toEqual({ status: "ok" });
    expect((await setup.completedAt(OWNER)) !== null).toBe(true);

    // 7. The attacker's password is gone for good; the owner's works.
    await tick();
    expect(await signInOwner(auth, OWNER, ATTACKER_PASSWORD)).toBe("invalid");
    expect(await signInOwner(auth, OWNER, OWNER_PASSWORD)).toBe("ok");
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("ok");
  });

  it("is also locked out when the attacker already holds a verified session from the provider (a session minted outside the app)", async () => {
    await signUpOwner(auth, limits, "6.6.6.6", OWNER, ATTACKER_PASSWORD);
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code(), redirectTo);
    // The provider will happily sign the attacker in (it is verified, and the password matches)...
    const raw = createE2eAuthProvider(env);
    expect(await raw.signInWithPassword(OWNER, ATTACKER_PASSWORD)).toMatchObject({ ok: true });
    // ...but the app, reading that very session, refuses it.
    expect(await auth.provider.getSession()).toBeNull();
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("unauthenticated");
  });

  it("keeps a session the attacker minted BEFORE setup dead after the owner completes the link", async () => {
    // Memory time stands in for the setup record's clock; sessions carry the provider's own creation time.
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await signUpOwner(auth, limits, "6.6.6.6", OWNER, ATTACKER_PASSWORD);
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code(), redirectTo);

    // The attacker signs in at the provider with the pre-registered password and keeps the session cookie.
    const raw = createE2eAuthProvider(env);
    expect(await raw.signInWithPassword(OWNER, ATTACKER_PASSWORD)).toMatchObject({ ok: true });
    const attackerCookie = jar.get("e2e-auth-session");
    expect(await auth.provider.getSession()).toBeNull();

    // The owner, in another browser, completes the emailed link.
    await wait(10);
    jar.clear();
    const { token, sealed } = emailedLink();
    expect(await resetOwnerPassword(auth, token, OWNER_PASSWORD, sealed)).toEqual({ status: "ok" });
    expect(await setup.completedAt(OWNER)).not.toBeNull();

    // THE POINT: the attacker's old session must not come back to life now that the account counts as set up.
    jar.set("e2e-auth-session", attackerCookie ?? "");
    expect(await auth.provider.getSession()).toBeNull();
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("unauthenticated");

    // The owner signs in with their new password and gets a session that works.
    await wait(10);
    jar.clear();
    expect(await signInOwner(auth, OWNER, OWNER_PASSWORD)).toBe("ok");
    expect((await authorizeOwner(auth.provider, auth.allowlist)).status).toBe("ok");
    // ...and the attacker's cookie is still dead next to it.
    jar.set("e2e-auth-session", attackerCookie ?? "");
    expect(await auth.provider.getSession()).toBeNull();
  });

  it("gets no further by asking for a reset link: it goes to the owner's inbox, not to the attacker", async () => {
    await signUpOwner(auth, limits, "6.6.6.6", OWNER, ATTACKER_PASSWORD);
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code(), redirectTo);
    const answer = await requestPasswordReset(auth, limits, "6.6.6.6", OWNER, redirectTo);
    // The attacker is told exactly what anyone is told, and holds no token or seal.
    expect(answer.status === "ok" || answer.status === "cooldown").toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/token|for=/);
    expect(await signInOwner(auth, OWNER, ATTACKER_PASSWORD)).toBe("unfinished");
  });

  it("cannot use a link made for one address to set up another", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER, OWNER_PASSWORD);
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER, code(), redirectTo);
    const { token } = emailedLink();
    // A forged seal naming some other address records nothing, whoever's token it is paired with.
    const forged = createSetupSeals("x".repeat(40)).seal("someone-else@example.test");
    await resetOwnerPassword(auth, token, OWNER_PASSWORD, forged);
    expect(setup.digests.size).toBe(0);
    expect(await signInOwner(auth, OWNER, OWNER_PASSWORD)).toBe("unfinished");
  });
});
