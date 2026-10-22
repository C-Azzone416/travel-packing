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
    expect(await signUpOwner(auth, limits, "1.1.1.1", " Owner@Example.test")).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 30,
    });
    expect(fake.flows.calls).toEqual([
      { method: "signUp", args: [OWNER_EMAIL, expect.any(String)] },
    ]);
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["sign-up-provider-ok", "sign-up-requested"]);
  });

  it("answers an address that is not on the allowlist the same way, and creates and sends nothing", async () => {
    const allowed = await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    const other = await signUpOwner(auth, limits, "2.2.2.2", STRANGER);
    expect(other).toEqual({ ...allowed, email: STRANGER });
    expect(methods()).toEqual(["signUp"]);
    expect(events()).toEqual([
      "sign-up-provider-ok",
      "sign-up-requested",
      "sign-up-skipped-allowlist",
      "sign-up-requested",
    ]);
  });

  it("never grants a session, whoever signs up", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    await signUpOwner(auth, limits, "1.1.1.1", STRANGER);
    expect(await fake.getSession()).toBeNull();
  });

  it("moves on without sending again when a code just went out", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    wait(10_000);
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "ok",
      email: OWNER_EMAIL,
      cooldownSeconds: 20,
    });
    expect(methods()).toEqual(["signUp"]);
  });

  it("asks the form to be fixed without calling the provider", async () => {
    expect(await signUpOwner(auth, limits, "1.1.1.1", "nope")).toEqual({
      status: "invalid-email",
    });
    expect(methods()).toEqual([]);
  });

  it("sends the provider a different random password every time, long enough for any policy (#102)", async () => {
    for (let i = 0; i < 4; i += 1) {
      await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
      wait(31_000);
    }
    const sent = fake.flows.calls.map((call) => call.args[1] as string);
    expect(sent).toHaveLength(4);
    expect(new Set(sent).size).toBe(sent.length);
    for (const password of sent) {
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    }
  });

  it("never lets the throwaway password into a log line or the answer", async () => {
    const answer = await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    const password = fake.flows.calls[0].args[1] as string;
    expect(logged.join("\n")).not.toContain(password);
    expect(JSON.stringify(answer)).not.toContain(password);
  });

  it("reports a provider outage, and a refused password is also only a server problem (nobody typed one)", async () => {
    fake.flows.answers.signUp = { ok: false, reason: "weak-password" };
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "unavailable",
    });
    wait(31_000);
    fake.flows.answers.signUp = { ok: false, reason: "unavailable" };
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "unavailable",
    });
    expect(events()).toEqual(["sign-up-failed", "sign-up-failed"]);
  });

  it("is rate limited per caller", async () => {
    for (let i = 0; i < 10; i += 1) {
      await signUpOwner(auth, limits, "1.1.1.1", `user${i}@example.test`);
    }
    expect(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL)).toEqual({
      status: "rate-limited",
    });
    expect(events().at(-1)).toBe("flow-rate-limited");
  });

  it("a new code clears an earlier lock on guessing", async () => {
    for (let i = 0; i < CODE_GUESSES; i += 1) limits.recordWrongGuess(OWNER_EMAIL);
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(false);
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(limits.guessBlocked(OWNER_EMAIL).ok).toBe(true);
  });

  it("logs codes only: no address, password, code or token ever appears in a log line", async () => {
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
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
    expect(events()).toEqual(["code-send-provider-ok", "code-sent"]);
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
    expect(events()).toEqual(["reset-send-provider-ok", "password-reset-requested"]);
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
    expect(events()).toEqual([
      "verification-succeeded",
      "reset-send-provider-ok",
      "password-reset-requested",
    ]);
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

describe("why a sign-up, code or link did or did not reach the provider (server-only, #93)", () => {
  const eventsWithDetail = () => logged.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("tells a provider success from an allowlist skip, a cooldown skip and an hourly-limit skip, with one answer for the browser", async () => {
    const answers: unknown[] = [];
    // 1. allowlisted, first request: the provider is called
    answers.push(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL));
    // 2. the same address again inside the 30-second gap: skipped for the cooldown
    answers.push(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL));
    // 3. a stranger: skipped for the allowlist
    answers.push(await signUpOwner(auth, limits, "1.1.1.1", STRANGER));
    expect(
      events().filter((event) => event.startsWith("sign-up-") && event !== "sign-up-requested"),
    ).toEqual(["sign-up-provider-ok", "sign-up-skipped-cooldown", "sign-up-skipped-allowlist"]);
    // 4. five more spaced-out sends exhaust the hourly cap for that address; the next is skipped for the limit
    for (let i = 0; i < 4; i += 1) {
      wait(31_000);
      await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    }
    wait(31_000);
    logged = [];
    answers.push(await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL));
    expect(events()).toEqual(["sign-up-skipped-limit", "sign-up-requested"]);
    // In every case the person is sent on to the code screen with the same shape of answer.
    for (const answer of answers)
      expect(answer).toMatchObject({ status: "ok", cooldownSeconds: expect.any(Number) });
  });

  it("logs a provider that refused the call (a 4xx the screen treats as success) apart from a real success, with status and code only", async () => {
    fake.flows.answers.signUp = { ok: true, rejected: { status: 403, code: "invalid_origin" } };
    const answer = await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(answer).toEqual({ status: "ok", email: OWNER_EMAIL, cooldownSeconds: 30 });
    expect(eventsWithDetail()).toEqual([
      { scope: "auth", event: "sign-up-provider-rejected", status: 403, code: "INVALID_ORIGIN" },
      { scope: "auth", event: "sign-up-requested" },
    ]);
  });

  it("turns a provider code that is not a plain machine code into OTHER and drops an impossible status", async () => {
    fake.flows.answers.signUp = {
      ok: true,
      rejected: { status: 7, code: "Email owner@example.test taken!" },
    };
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(eventsWithDetail()[0]).toEqual({
      scope: "auth",
      event: "sign-up-provider-rejected",
      code: "OTHER",
    });
  });

  it("logs a failed provider call as before", async () => {
    fake.flows.answers.signUp = { ok: false, reason: "unavailable" };
    await signUpOwner(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(events()).toEqual(["sign-up-failed"]);
  });

  it("tells the same apart for a resent code and for a reset link", async () => {
    await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
    await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
    await resendVerificationCode(auth, limits, "1.1.1.1", STRANGER);
    fake.flows.answers.requestPasswordReset = {
      ok: true,
      rejected: { status: 403, code: "INVALID_REDIRECT_URL" },
    };
    await requestPasswordReset(auth, limits, "1.1.1.1", OWNER_EMAIL, REDIRECT);
    fake.flows.answers.resendVerificationCode = { ok: false, reason: "unavailable" };
    wait(31_000);
    await resendVerificationCode(auth, limits, "1.1.1.1", OWNER_EMAIL);
    expect(events().filter((event) => /^(code|reset)-send/.test(event))).toEqual([
      "code-send-provider-ok",
      "code-send-skipped-cooldown",
      "code-send-skipped-allowlist",
      "reset-send-provider-rejected",
      "code-send-provider-failed",
    ]);
  });

  it("never writes an address, a password, a code or the allowlist into any of these lines", async () => {
    fake.flows.answers.signUp = { ok: true, rejected: { status: 403, code: "INVALID_ORIGIN" } };
    await signUpOwner(auth, limits, "9.9.9.9", OWNER_EMAIL);
    await signUpOwner(auth, limits, "9.9.9.9", STRANGER);
    await resendVerificationCode(auth, limits, "9.9.9.9", OWNER_EMAIL);
    await requestPasswordReset(auth, limits, "9.9.9.9", STRANGER, REDIRECT);
    const text = logged.join("\n");
    expect(text).not.toMatch(/example\.test|a-long-password|9\.9\.9\.9|owner|stranger/i);
  });
});
