import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { createMemorySetupStore } from "@/server/auth/account-setup";
import { parseAllowlist } from "@/server/auth/allowlist";
import { createSetupSeals } from "@/server/auth/setup-seal";

const OWNER = "owner@example.test";
const STRANGER = "stranger@example.test";
const fake = createFakeAuth();
const setup = createMemorySetupStore();
const seals = createSetupSeals("s".repeat(40));
let available = true;
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist(OWNER),
    available,
    setup,
    seals,
  }),
}));
let headerValues: Record<string, string> = {};
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerValues),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { forgotAction, resendResetAction } from "@/app/forgot-password/actions";
import { resetAction } from "@/app/reset-password/actions";
import { signUpAction } from "@/app/sign-up/actions";
import { resendSetupAction } from "@/app/finish-setup/actions";
import { resendVerifyAction, verifyAction } from "@/app/verify/actions";
import { resetFlowLimits } from "@/server/auth/flow-limits";
const limitsReset = () => resetFlowLimits();
import { setAuthLogSink } from "@/server/auth/safe-log";
import { INITIAL_FORGOT, INITIAL_FORM, INITIAL_RESEND } from "./state";

const data = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};
const calls = () => fake.flows.calls.map((call) => call.method);

beforeEach(() => {
  setup.digests.clear();
  vi.stubEnv("AUTH_FLOW_MIN_MS", "0");
  jar.clear();
  resetFlowLimits();
  available = true;
  headerValues = { host: "app.example.test", "x-forwarded-for": "203.0.113.9" };
  fake.flows.calls.length = 0;
  fake.flows.answers = {};
  fake.flows.sessionAfterVerify = null;
  fake.current = null;
  setAuthLogSink(() => {});
});
afterEach(() => {
  setAuthLogSink();
  vi.unstubAllEnvs();
});

describe("signUpAction", () => {
  const submit = (fields: Record<string, string>) => signUpAction(INITIAL_FORM, data(fields));

  it("creates the account, remembers the address, and goes to the code screen", async () => {
    await expect(
      submit({ email: " Owner@Example.test ", password: "a-long-password" }),
    ).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(calls()).toEqual(["signUp"]);
    expect(jar.get("cw-pending-email")).toBe(OWNER);
  });

  it("does the same, visibly, for an address that is not allowed (and creates nothing)", async () => {
    await expect(submit({ email: STRANGER, password: "a-long-password" })).rejects.toThrow(
      "NEXT_REDIRECT:/verify",
    );
    expect(calls()).toEqual([]);
    expect(jar.get("cw-pending-email")).toBe(STRANGER);
  });

  it("keeps what was typed and names the field to fix", async () => {
    expect(await submit({ email: "nope", password: "a-long-password" })).toEqual({
      error: null,
      email: "nope",
      fieldErrors: { email: "Enter a valid email address." },
    });
    expect(await submit({ email: OWNER, password: "short" })).toMatchObject({
      email: OWNER,
      fieldErrors: { password: "Password must be at least 8 characters." },
    });
    expect(jar.size).toBe(0);
  });

  it("names every problem at once", async () => {
    expect(await submit({ email: "nope", password: "short" })).toMatchObject({
      fieldErrors: {
        email: "Enter a valid email address.",
        password: "Password must be at least 8 characters.",
      },
    });
    expect(calls()).toEqual([]);
  });

  it("shows the provider's refused password under the password field", async () => {
    fake.flows.answers.signUp = { ok: false, reason: "weak-password" };
    expect(await submit({ email: OWNER, password: "a-long-password" })).toMatchObject({
      fieldErrors: { password: expect.stringContaining("at least 8") },
    });
  });

  it("says what went wrong when sign-up is limited, down, or switched off", async () => {
    fake.flows.answers.signUp = { ok: false, reason: "unavailable" };
    expect(await submit({ email: OWNER, password: "a-long-password" })).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
    available = false;
    expect(await submit({ email: OWNER, password: "a-long-password" })).toMatchObject({
      error: "Sign-up isn't available right now.",
    });
    available = true;
    for (let i = 0; i < 10; i += 1) {
      await submit({ email: `u${i}@example.test`, password: "a-long-password" }).catch(() => {});
    }
    expect(await submit({ email: OWNER, password: "a-long-password" })).toMatchObject({
      error: "Too many requests. Try again in a few minutes.",
    });
  });

  it("waits out the minimum so allowed and unlisted addresses take the same time", async () => {
    vi.stubEnv("AUTH_FLOW_MIN_MS", "60");
    const started = Date.now();
    await submit({ email: STRANGER, password: "a-long-password" }).catch(() => {});
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});

describe("verifyAction", () => {
  const submit = (fields: Record<string, string>) => verifyAction(INITIAL_FORM, data(fields));

  it("never signs in: a right code goes to 'check your email' and asks for the link that sets the password", async () => {
    jar.set("cw-pending-email", OWNER);
    // Even if the provider signs the person in on its own, no session comes out of this step.
    fake.flows.sessionAfterVerify = { userId: "u1", email: OWNER };
    await expect(submit({ code: "123 456" })).rejects.toThrow("NEXT_REDIRECT:/finish-setup");
    expect(calls()).toEqual(["verifyEmail", "requestPasswordReset"]);
    const [, link] = fake.flows.calls[1].args as string[];
    expect(link.startsWith("https://app.example.test/reset-password?for=")).toBe(true);
    expect(seals.open(new URL(link).searchParams.get("for"))).toBe(OWNER);
    expect(fake.current).toBeNull();
    expect(jar.get("cw-pending-email")).toBe(OWNER);
    expect(setup.digests.size).toBe(0);
  });

  it("refuses up front, before using the code, when the link could not be made", async () => {
    jar.set("cw-pending-email", OWNER);
    headerValues = {};
    expect(await submit({ code: "123456" })).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
    expect(calls()).toEqual([]);
  });

  it("uses the typed address when none is remembered", async () => {
    await expect(submit({ email: OWNER, code: "123456" })).rejects.toThrow(
      "NEXT_REDIRECT:/finish-setup",
    );
    expect(fake.flows.calls[0]).toEqual({ method: "verifyEmail", args: [OWNER, "123456"] });
    expect(jar.get("cw-pending-email")).toBe(OWNER);
    jar.clear();
    expect(await submit({ email: "nope", code: "123456" })).toMatchObject({
      fieldErrors: { email: "Enter a valid email address." },
    });
  });

  it("names a missing address and a missing code together", async () => {
    expect(await submit({ email: "", code: "" })).toMatchObject({
      fieldErrors: { email: "Enter a valid email address.", code: "Enter the 6-digit code." },
    });
  });

  it("asks for the code before anything is counted", async () => {
    jar.set("cw-pending-email", OWNER);
    expect(await submit({ code: "  " })).toMatchObject({
      fieldErrors: { code: "Enter the 6-digit code." },
    });
    expect(calls()).toEqual([]);
  });

  it("gives one message for a wrong or expired code, and another once locked", async () => {
    jar.set("cw-pending-email", OWNER);
    fake.flows.answers.verifyEmail = { ok: false, reason: "invalid" };
    const wrong = {
      fieldErrors: { code: "That code isn't right or has expired. Check it, or send a new code." },
    };
    for (let i = 0; i < 5; i += 1) {
      // The refused code stays in the box so it can be corrected.
      expect(await submit({ code: "111111" })).toMatchObject({ ...wrong, code: "111111" });
    }
    expect(await submit({ code: "111111" })).toMatchObject({
      fieldErrors: { code: "Too many attempts. Send a new code to try again." },
    });
  });

  it("never lets a stranger's code succeed, with the same message as a wrong one", async () => {
    jar.set("cw-pending-email", STRANGER);
    expect(await submit({ code: "123456" })).toMatchObject({
      fieldErrors: { code: expect.stringContaining("isn't right or has expired") },
    });
    expect(calls()).toEqual([]);
  });

  it("reports a limit and an outage as form-level problems", async () => {
    jar.set("cw-pending-email", OWNER);
    fake.flows.answers.verifyEmail = { ok: false, reason: "too-many" };
    expect(await submit({ code: "123456" })).toMatchObject({
      error: "Too many requests. Try again in a few minutes.",
    });
    fake.flows.answers.verifyEmail = { ok: false, reason: "unavailable" };
    expect(await submit({ code: "123456" })).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
  });
});

describe("resendVerifyAction", () => {
  const resend = (fields: Record<string, string> = {}, previous = INITIAL_RESEND) =>
    resendVerifyAction(previous, data(fields));

  it("sends a code, starts the 30-second gap, and counts the answer", async () => {
    jar.set("cw-pending-email", OWNER);
    const first = await resend();
    expect(first).toEqual({ nonce: 1, status: "sent", cooldownSeconds: 30 });
    expect(calls()).toEqual(["resendVerificationCode"]);
    const second = await resend({}, first);
    expect(second).toMatchObject({ nonce: 2, status: "cooldown" });
    expect(second.cooldownSeconds).toBeGreaterThan(0);
    expect(calls()).toHaveLength(1);
  });

  it("answers an address that is not allowed exactly the same, and sends nothing", async () => {
    jar.set("cw-pending-email", STRANGER);
    expect(await resend()).toEqual({ nonce: 1, status: "sent", cooldownSeconds: 30 });
    expect(calls()).toEqual([]);
  });

  it("reports an outage, and a missing address, as an error", async () => {
    expect(await resend()).toMatchObject({ status: "error" });
    jar.set("cw-pending-email", OWNER);
    fake.flows.answers.resendVerificationCode = { ok: false, reason: "unavailable" };
    expect(await resend()).toMatchObject({ status: "error" });
    available = false;
    expect(await resend()).toMatchObject({ status: "error" });
  });

  it("reports the provider's limit as 'a few minutes'", async () => {
    jar.set("cw-pending-email", OWNER);
    fake.flows.answers.resendVerificationCode = { ok: false, reason: "too-many" };
    expect(await resend()).toMatchObject({ status: "limited" });
  });
});

describe("forgotAction", () => {
  const submit = (email: string) => forgotAction(INITIAL_FORGOT, data({ email }));

  it("gives the same 'Check your email' answer for an allowed and an unlisted address", async () => {
    const real = await submit(OWNER);
    const other = await submit(STRANGER);
    expect(real.sent).toEqual({ email: OWNER, cooldownSeconds: 30 });
    expect(other.sent).toEqual({ email: STRANGER, cooldownSeconds: 30 });
    expect(calls()).toEqual(["requestPasswordReset"]);
  });

  it("asks the provider to return the link to this app's reset page", async () => {
    await submit(OWNER);
    const [email, link] = fake.flows.calls[0].args as string[];
    expect(fake.flows.calls[0].method).toBe("requestPasswordReset");
    expect(email).toBe(OWNER);
    // The link names the address it is for, with a seal only the app can make.
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe("https://app.example.test/reset-password");
    expect(seals.open(url.searchParams.get("for"))).toBe(OWNER);
  });

  it("answers a repeat inside the gap the same way, with the time left", async () => {
    await submit(OWNER);
    const again = await submit("  OWNER@example.test ");
    expect(again.sent?.email).toBe(OWNER);
    expect(again.sent?.cooldownSeconds).toBeGreaterThan(0);
    expect(calls()).toHaveLength(1);
  });

  it("only names a bad address, a cap, or an outage", async () => {
    expect(await submit("nope")).toMatchObject({
      sent: null,
      fieldErrors: { email: "Enter a valid email address." },
    });
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "too-many" };
    expect(await submit(OWNER)).toMatchObject({
      error: "Too many requests. Try again in a few minutes.",
    });
    headerValues = {};
    expect(await submit(OWNER)).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
  });
});

describe("resendResetAction", () => {
  it("sends the link again after the gap and reports the next gap", async () => {
    const first = await resendResetAction(INITIAL_RESEND, data({ email: OWNER }));
    expect(first).toEqual({ nonce: 1, status: "sent", cooldownSeconds: 30 });
    const second = await resendResetAction(first, data({ email: OWNER }));
    expect(second).toMatchObject({ nonce: 2, status: "cooldown" });
    expect(calls()).toHaveLength(1);
  });

  it("reports an outage or a missing return address as an error", async () => {
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "unavailable" };
    expect(await resendResetAction(INITIAL_RESEND, data({ email: OWNER }))).toMatchObject({
      status: "error",
    });
    headerValues = {};
    expect(await resendResetAction(INITIAL_RESEND, data({ email: OWNER }))).toMatchObject({
      status: "error",
    });
  });
});

describe("resetAction", () => {
  const submit = (fields: Record<string, string>) => resetAction(INITIAL_FORM, data(fields));

  it("changes the password and goes to sign-in with a notice, signing nobody in", async () => {
    fake.current = { userId: "u1", email: OWNER };
    await expect(
      submit({ token: "fake-token-one", password: "new-password-1", for: seals.seal(OWNER) }),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?notice=password-updated");
    expect(fake.flows.calls).toEqual([
      { method: "resetPassword", args: ["fake-token-one", "new-password-1"] },
    ]);
    expect(fake.current).toBeNull();
    // Using the link is what counts the account as set up.
    expect((await setup.completedAt(OWNER)) !== null).toBe(true);
  });

  it("changes the password but records nothing when the link has no valid seal", async () => {
    await expect(
      submit({ token: "fake-token-one", password: "new-password-1", for: "forged" }),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?notice=password-updated");
    await expect(submit({ token: "fake-token-one", password: "new-password-1" })).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?notice=password-updated",
    );
    expect(setup.digests.size).toBe(0);
  });

  it("sends a link that no longer works to the 'not valid' screen, without the token in the address", async () => {
    fake.flows.answers.resetPassword = { ok: false, reason: "invalid" };
    await expect(submit({ token: "fake-token-one", password: "new-password-1" })).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?error=invalid",
    );
    await expect(submit({ token: "", password: "new-password-1" })).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?error=invalid",
    );
  });

  it("names a weak password under the field and keeps the form", async () => {
    expect(await submit({ token: "fake-token-one", password: "short" })).toMatchObject({
      fieldErrors: { password: "Password must be at least 8 characters." },
    });
    expect(calls()).toEqual([]);
  });

  it("reports a limit and an outage", async () => {
    fake.flows.answers.resetPassword = { ok: false, reason: "too-many" };
    expect(await submit({ token: "fake-token-one", password: "new-password-1" })).toMatchObject({
      error: "Too many requests. Try again in a few minutes.",
    });
    fake.flows.answers.resetPassword = { ok: false, reason: "unavailable" };
    expect(await submit({ token: "fake-token-one", password: "new-password-1" })).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
    available = false;
    expect(await submit({ token: "fake-token-one", password: "new-password-1" })).toMatchObject({
      error: "Something went wrong on our side. Try again in a moment.",
    });
  });
});

describe("resendSetupAction", () => {
  const resend = (previous = INITIAL_RESEND) => resendSetupAction(previous);

  it("sends the setup link again to the remembered address, with the same 30-second gap", async () => {
    jar.set("cw-pending-email", OWNER);
    const first = await resend();
    expect(first).toEqual({ nonce: 1, status: "sent", cooldownSeconds: 30 });
    expect(calls()).toEqual(["requestPasswordReset"]);
    const second = await resend(first);
    expect(second).toMatchObject({ nonce: 2, status: "cooldown" });
    expect(calls()).toHaveLength(1);
  });

  it("answers an address that is not allowed exactly the same, and sends nothing", async () => {
    jar.set("cw-pending-email", STRANGER);
    expect(await resend()).toEqual({ nonce: 1, status: "sent", cooldownSeconds: 30 });
    expect(calls()).toEqual([]);
  });

  it("reports a missing address, an outage, a missing return address and a cap as an error or limit", async () => {
    expect(await resend()).toMatchObject({ status: "error" });
    jar.set("cw-pending-email", OWNER);
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "too-many" };
    expect(await resend()).toMatchObject({ status: "limited" });
    fake.flows.answers.requestPasswordReset = { ok: false, reason: "unavailable" };
    limitsReset();
    expect(await resend()).toMatchObject({ status: "error" });
    headerValues = {};
    expect(await resend()).toMatchObject({ status: "error" });
    available = false;
    expect(await resend()).toMatchObject({ status: "error" });
  });
});
