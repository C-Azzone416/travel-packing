import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import {
  MAX_PASSWORD_LENGTH,
  cleanCode,
  cleanEmail,
  cleanToken,
  passwordProblem,
  requestPasswordReset,
  resendVerificationCode,
  resetOwnerPassword,
  signUpOwner,
  verifyOwnerEmail,
} from "./account-flows";
import { createMemorySetupStore, type AccountSetupStore } from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { CODE_GUESSES, createFlowLimits, type FlowLimits } from "./flow-limits";
import { setAuthLogSink } from "./safe-log";
import { createSetupSeals } from "./setup-seal";

const OWNER_EMAIL = "owner@example.test";
const STRANGER = "stranger@example.test";
const allowlist = parseAllowlist(OWNER_EMAIL);
const PASSWORD = "a-long-password";
const REDIRECT = "https://app.example.test/reset-password";

let fake: FakeAuth;
let limits: FlowLimits;
let logged: string[];
let setup: ReturnType<typeof createMemorySetupStore>;
const seals = createSetupSeals("s".repeat(40));
let auth: {
  provider: FakeAuth;
  allowlist: ReturnType<typeof parseAllowlist>;
  setup: AccountSetupStore;
  seals: typeof seals;
};
let time: number;

beforeEach(() => {
  time = 1_000_000;
  fake = createFakeAuth();
  limits = createFlowLimits(() => time);
  logged = [];
  setAuthLogSink((line) => logged.push(line));
  setup = createMemorySetupStore();
  auth = { provider: fake, allowlist, setup, seals };
});
afterEach(() => setAuthLogSink());

const events = () => logged.map((line) => (JSON.parse(line) as { event: string }).event);
const methods = () => fake.flows.calls.map((call) => call.method);
const wait = (ms: number) => (time += ms);

describe("input cleaning", () => {
  it("accepts a plausible address and normalizes it", () => {
    expect(cleanEmail("  Owner@Example.TEST ")).toBe("owner@example.test");
    for (const bad of ["", "no-at", "a@b", "a b@c.d", 5, null, `${"a".repeat(250)}@b.cd`]) {
      expect(cleanEmail(bad)).toBeNull();
    }
  });

  it("accepts exactly six digits, typed with spaces or dashes", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    for (const bad of ["abc123", "12345", "1234567", "", 123456, null]) {
      expect(cleanCode(bad)).toBeNull();
    }
  });

  it("accepts an opaque token and rejects empty, short, oversized or odd ones", () => {
    expect(cleanToken("Fake_token-1.~xx")).toBe("Fake_token-1.~xx");
    for (const bad of ["", "short", "has space in it", "x".repeat(513), null, 7]) {
      expect(cleanToken(bad)).toBeNull();
    }
  });

  it("names the password problem", () => {
    expect(passwordProblem("")).toBe("missing");
    expect(passwordProblem(undefined)).toBe("missing");
    expect(passwordProblem("short")).toBe("too-short");
    expect(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1))).toBe("too-long");
    expect(passwordProblem(PASSWORD)).toBeNull();
  });
});

describe("signUpOwner", () => {
  it("creates the account for an allowlisted address and moves on to verification with the gap running", async () => {
    expect(await signUpOwner(auth, limits, "1.1.1.1", " Owner@Example.test", PASSWORD)).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 30,
    });
    expect(fake.flows.calls).toEqual([{ method: "signUp", args: [OWNER_EMAIL, PASSWORD] }]);
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["sign-up-requested"]);
  });

  it("answers an address that is not on the allowlist the same way, and creates and sends nothing", async () => {
    const allowed = await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD);
    const other = await signUpOwner(auth, limits, "2.2.2.2", STRANGER, PASSWORD);
    expect(other).toEqual({ ...allowed, email: STRANGER });
    expect(methods()).toEqual(["signUp"]);
    expect(events()).toEqual(["sign-up-requested", "sign-up-requested"]);
  });

  it("never grants a session, whoever signs up", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD);
    await signUpOwner(auth, limits, "1.1.1.1", STRANGER, PASSWORD);
    expect(await fake.getSession()).toBeNull();
  });

  it("moves on without sending again when a code just went out", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD);
    wait(10_000);
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD)).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 20,
    });
    expect(methods()).toEqual(["signUp"]);
  });

  it("asks the form to be fixed without calling the provider", async () => {
    expect(await signUpOwner(auth, limits, "1.1.1.1", "nope", PASSWORD)).toEqual({
      status: "invalid-email",
    });
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, "short")).toEqual({
      status: "weak-password",
      problem: "too-short",
    });
    expect(methods()).toEqual([]);
  });

  it("reports the provider's refused password and its outage", async () => {
    fake.flows.answers.signUp = { ok: false, reason: "weak-password" };
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD)).toEqual({
      status: "weak-password",
      problem: "provider",
    });
    wait(31_000);
    fake.flows.answers.signUp = { ok: false, reason: "unavailable" };
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD)).toEqual({
      status: "unavailable",
    });
    expect(events()).toEqual(["sign-up-failed", "sign-up-failed"]);
  });

  it("is rate limited per caller", async () => {
    for (let i = 0; i < 10; i += 1) {
      await signUpOwner(auth, limits, "1.1.1.1", `user${i}@example.test`, PASSWORD);
    }
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD)).toEqual({
      status: "rate-limited",
    });
    expect(events().at(-1)).toBe("flow-rate-limited");
  });

  it("a new code clears an earlier lock on guessing", async () => {
    for (let i = 0; i < CODE_GUESSES; i += 1) limits.recordWrongGuess(OWNER_EMAIL);
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(false);
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD);
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(true);
  });

  it("logs codes only: no address, password, code or token ever appears in a log line", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL, PASSWORD);
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER_EMAIL, "123456", REDIRECT);
    await requestPasswordReset(auth, limits, "1.1.1.1", OWNER_EMAIL, REDIRECT);
    await resetOwnerPassword(auth, "fake-token-one", "new-password-1");
    const text = logged.join("\n");
    for (const secret of [OWNER_EMAIL, PASSWORD, "123456", "fake-token-one", "new-password-1"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("sending codes and links", () => {
  it("resends a verification code to an allowlisted address and starts the 30-second gap", async () => {
    expect(await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 30,
    });
    expect(fake.flows.calls).toEqual([{ method: "resendVerificationCode", args: [OWNER_EMAIL] }]);
    expect(events()).toEqual(["code-sent"]);
  });

  it("asks for a reset link that returns to the app's reset page", async () => {
    expect(await requestPasswordReset(auth, limits, "1.1.1.1", OWNER_EMAIL, REDIRECT)).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 30,
    });
    expect(fake.flows.calls).toEqual([
      { method: "requestPasswordReset", args: [OWNER_EMAIL, REDIRECT] },
    ]);
    expect(events()).toEqual(["password-reset-requested"]);
  });

  it.each([
    ["resend", (a: string) => resendVerificationCode(auth, limits, a, STRANGER)],
    ["reset", (a: string) => requestPasswordReset(auth, limits, a, STRANGER, REDIRECT)],
  ])(
    "answers an unlisted address exactly like a real one and sends nothing (%s)",
    async (_n, send) => {
      expect(await send("1.1.1.1")).toEqual({ status: "ok", email: STRANGER, cooldownSeconds: 30 });
      expect(methods()).toEqual([]);
      // ...and it gets the same 30-second gap.
      expect(await send("1.1.1.1")).toEqual({ status: "cooldown", retryAfterSeconds: 30 });
    },
  );

  it("holds a second request inside the gap, with the seconds left, and sends nothing more", async () => {
    await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
    wait(12_000);
    expect(await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "cooldown",
      retryAfterSeconds: 18,
    });
    expect(methods()).toHaveLength(1);
    wait(18_000);
    expect((await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL)).status).toBe("ok");
    expect(events()).toContain("flow-rate-limited");
  });

  it("an hourly cap reads 'try again in a few minutes', not a countdown", async () => {
    for (let i = 0; i < 5; i += 1) {
      await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
      wait(31_000);
    }
    expect(await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "rate-limited",
    });
  });

  it("a new code clears the wrong-guess lock", async () => {
    for (let i = 0; i < CODE_GUESSES; i += 1) limits.recordWrongGuess(OWNER_EMAIL);
    await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(true);
  });

  it("rejects a malformed address without calling the provider", async () => {
    expect(await resendVerificationCode(auth, limits, "1.1.1.1", "nope")).toEqual({
      status: "invalid-email",
    });
    expect(await requestPasswordReset(auth, limits, "1.1.1.1", "nope", REDIRECT)).toEqual({
      status: "invalid-email",
    });
    expect(methods()).toEqual([]);
  });

  it("shows the provider's limit as 'a few minutes' and its outage as unavailable", async () => {
    fake.flows.answers.resendVerificationCode = { ok: false, reason: "too-many" };
    expect(await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "rate-limited",
    });
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "unavailable" };
    expect(await requestPasswordReset(auth, limits, "1.1.1.1", OWNER_EMAIL, REDIRECT)).toEqual({
      status: "unavailable",
    });
  });
});

describe("verifyOwnerEmail", () => {
  const verify = (email: string = OWNER_EMAIL, code: unknown = "123456", address = "1.1.1.1") =>
    verifyOwnerEmail(auth, limits, address, email, code, REDIRECT);

  it("never signs anyone in: a right code ends whatever session the provider made and asks for the link", async () => {
    // Even if the provider signs the person in on its own after verifying, the sign-up password is not trusted.
    fake.flows.sessionAfterVerify = { userId: "u1", email: OWNER_EMAIL };
    expect(await verify(" Owner@Example.test", "123 456")).toEqual({
      status: "finish-setup",
      email: OWNER_EMAIL,
      cooldownSeconds: 30,
    });
    expect(fake.flows.calls).toEqual([
      { method: "verifyEmail", args: [OWNER_EMAIL, "123456"] },
      { method: "requestPasswordReset", args: [OWNER_EMAIL, REDIRECT] },
    ]);
    expect(fake.signOutCalls).toBe(1);
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["verification-succeeded", "password-reset-requested"]);
  });

  it("asks the provider for the link with a return address made for this address", async () => {
    const redirectTo = (email: string) => `${REDIRECT}?for=${seals.seal(email)}`;
    await verifyOwnerEmail(auth, limits, "1.1.1.1", OWNER_EMAIL, "123456", redirectTo);
    const args = fake.flows.calls[1].args as string[];
    expect(seals.open(new URL(args[1]).searchParams.get("for"))).toBe(OWNER_EMAIL);
  });

  it("does not record the account as set up: only using the link does that", async () => {
    await verify();
    expect((await setup.completedAt(OWNER_EMAIL)) !== null).toBe(false);
  });

  it("still ends in 'check your email' when the link cannot be sent right now, with the time left on the gap", async () => {
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "unavailable" };
    expect(await verify()).toMatchObject({ status: "finish-setup", email: OWNER_EMAIL });
    fake.flows.answers.verifyEmail = { ok: true };
  });

  it("does not send a second link when one was asked for a moment ago", async () => {
    await requestPasswordReset(auth, limits, "1.1.1.1", OWNER_EMAIL, REDIRECT);
    wait(10_000);
    fake.flows.calls.length = 0;
    const outcome = await verify();
    expect(outcome).toEqual({ status: "finish-setup", email: OWNER_EMAIL, cooldownSeconds: 20 });
    expect(methods()).toEqual(["verifyEmail"]);
  });

  it("when ending the provider's session fails it still goes on to the link, logging only a code", async () => {
    fake.failNextSignOut = true;
    expect((await verify()).status).toBe("finish-setup");
    expect(events()).toContain("provider-error");
    expect(methods()).toEqual(["verifyEmail", "requestPasswordReset"]);
  });

  it("never succeeds for an address that is not on the allowlist, and asks the provider nothing", async () => {
    expect(await verify(STRANGER)).toEqual({ status: "invalid" });
    expect(methods()).toEqual([]);
    for (let i = 0; i < CODE_GUESSES - 1; i += 1) await verify(STRANGER);
    // The lock arrives on the same schedule as for a real address.
    expect(await verify(STRANGER)).toEqual({ status: "locked" });
  });

  it("gives one answer for a wrong, expired, used or malformed code", async () => {
    fake.flows.answers.verifyEmail = { ok: false, reason: "invalid" };
    expect(await verify(OWNER_EMAIL, "123456")).toEqual({ status: "invalid" });
    expect(await verify(OWNER_EMAIL, "abc")).toEqual({ status: "invalid" });
    expect(await verify("not-an-email", "123456")).toEqual({ status: "invalid" });
    expect(await verify(OWNER_EMAIL, null)).toEqual({ status: "invalid" });
    expect(methods()).toEqual(["verifyEmail"]);
  });

  it("locks after five wrong codes, before the provider is asked again", async () => {
    fake.flows.answers.verifyEmail = { ok: false, reason: "invalid" };
    for (let i = 0; i < CODE_GUESSES; i += 1) {
      expect((await verify(OWNER_EMAIL, "111111")).status).toBe("invalid");
    }
    fake.flows.answers.verifyEmail = { ok: true };
    expect(await verify()).toEqual({ status: "locked" });
    expect(methods()).toHaveLength(CODE_GUESSES);
  });

  it("clears the guess count on success", async () => {
    fake.flows.answers.verifyEmail = { ok: false, reason: "invalid" };
    for (let i = 0; i < CODE_GUESSES - 1; i += 1) await verify(OWNER_EMAIL, "111111");
    fake.flows.answers.verifyEmail = { ok: true };
    await verify();
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(true);
  });

  it("reports the provider's own lock, its limit, and its outage", async () => {
    fake.flows.answers.verifyEmail = { ok: false, reason: "locked" };
    expect(await verify()).toEqual({ status: "locked" });
    fake.flows.answers.verifyEmail = { ok: false, reason: "too-many" };
    expect(await verify()).toEqual({ status: "rate-limited" });
    fake.flows.answers.verifyEmail = { ok: false, reason: "unavailable" };
    for (let i = 0; i < CODE_GUESSES + 2; i += 1) {
      expect(await verify()).toEqual({ status: "unavailable" });
    }
  });
});

describe("resetOwnerPassword", () => {
  const seal = () => seals.seal(OWNER_EMAIL);
  const reset = (
    token: unknown = "fake-token-one",
    password: unknown = "new-password-1",
    sealed: unknown = seal(),
  ) => resetOwnerPassword(auth, token, password, sealed);

  it("sets the new password, ends this browser's session, and does not sign anyone in", async () => {
    fake.current = { userId: "u1", email: OWNER_EMAIL };
    expect(await reset()).toEqual({ status: "ok" });
    expect(fake.flows.calls).toEqual([
      { method: "resetPassword", args: ["fake-token-one", "new-password-1"] },
    ]);
    expect(fake.signOutCalls).toBe(1);
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["account-setup-completed", "password-reset-succeeded"]);
  });

  it("records the account named by the link as set up, and only then", async () => {
    expect((await setup.completedAt(OWNER_EMAIL)) !== null).toBe(false);
    await reset();
    expect((await setup.completedAt(OWNER_EMAIL)) !== null).toBe(true);
  });

  it.each([
    ["no seal", null],
    ["an empty seal", ""],
    ["a seal made with another secret", createSetupSeals("t".repeat(40)).seal(OWNER_EMAIL)],
    ["a tampered seal", `${seals.seal(OWNER_EMAIL)}x`],
    ["a seal that is not text", { not: "text" }],
  ])("changes the password but records nothing for %s", async (_name, sealed) => {
    expect(await reset("fake-token-one", "new-password-1", sealed)).toEqual({ status: "ok" });
    expect(setup.digests.size).toBe(0);
  });

  it("never records an address that is not on the allowlist", async () => {
    expect(await reset("fake-token-one", "new-password-1", seals.seal(STRANGER))).toEqual({
      status: "ok",
    });
    expect(setup.digests.size).toBe(0);
  });

  it("does not record anything when the password was not changed", async () => {
    fake.flows.answers.resetPassword = { ok: false, reason: "invalid" };
    await reset();
    expect(setup.digests.size).toBe(0);
  });

  it("still succeeds when recording fails, logging only a code (a new link will fix it)", async () => {
    auth.setup = {
      completedAt: async () => null,
      markComplete: async () => {
        throw new Error("db down for owner@example.test");
      },
    };
    expect(await reset()).toEqual({ status: "ok" });
    expect(events()).toEqual(["provider-error", "password-reset-succeeded"]);
    expect(logged.join()).not.toContain("owner@example.test");
  });

  it("still succeeds when ending the session fails", async () => {
    fake.failNextSignOut = true;
    expect(await reset()).toEqual({ status: "ok" });
    expect(events()).toEqual([
      "provider-error",
      "account-setup-completed",
      "password-reset-succeeded",
    ]);
  });

  it("checks the password before the token is used", async () => {
    expect(await reset("fake-token-one", "short")).toEqual({
      status: "weak-password",
      problem: "too-short",
    });
    expect(methods()).toEqual([]);
  });

  it("gives one answer for a missing, malformed, wrong, expired or used link", async () => {
    expect(await reset(null)).toEqual({ status: "invalid-link" });
    expect(await reset("x")).toEqual({ status: "invalid-link" });
    fake.flows.answers.resetPassword = { ok: false, reason: "invalid" };
    expect(await reset()).toEqual({ status: "invalid-link" });
    expect(events().filter((event) => event === "password-reset-failed")).toHaveLength(3);
    expect(methods()).toEqual(["resetPassword"]);
  });

  it("reports the provider's refused password, limit, and outage", async () => {
    fake.flows.answers.resetPassword = { ok: false, reason: "weak-password" };
    expect(await reset()).toEqual({ status: "weak-password", problem: "provider" });
    fake.flows.answers.resetPassword = { ok: false, reason: "too-many" };
    expect(await reset()).toEqual({ status: "rate-limited" });
    fake.flows.answers.resetPassword = { ok: false, reason: "unavailable" };
    expect(await reset()).toEqual({ status: "unavailable" });
  });

  it("does not weaken the sign-in gates: a reset never creates a session or touches the allowlist", async () => {
    await reset();
    expect(await fake.getSession()).toBeNull();
    expect(methods()).toEqual(["resetPassword"]);
  });
});
