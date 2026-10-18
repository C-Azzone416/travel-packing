import { describe, expect, it } from "vitest";
import {
  ADDRESS_ALLOWANCE_FACTOR,
  EMAIL_BACKSTOP_FACTOR,
  clientAddress,
  createSignInLimits,
  DEFAULT_SIGN_IN_ATTEMPTS,
  resetSignInLimits,
  SIGN_IN_WINDOW_MS,
  signInAttemptsPerWindow,
  signInLimits,
} from "./sign-in-limit";

describe("signInAttemptsPerWindow", () => {
  it("uses the default unless the setting is a whole number from 1 to 10000", () => {
    expect(signInAttemptsPerWindow({})).toBe(DEFAULT_SIGN_IN_ATTEMPTS);
    for (const bad of ["", " ", "0", "-5", "3.5", "abc", "10001", "999999", "1e3"]) {
      expect(signInAttemptsPerWindow({ SIGN_IN_ATTEMPTS_PER_15_MIN: bad })).toBe(
        DEFAULT_SIGN_IN_ATTEMPTS,
      );
    }
    expect(signInAttemptsPerWindow({ SIGN_IN_ATTEMPTS_PER_15_MIN: " 25 " })).toBe(25);
    expect(signInAttemptsPerWindow({ SIGN_IN_ATTEMPTS_PER_15_MIN: "10000" })).toBe(10_000);
    expect(signInAttemptsPerWindow({ SIGN_IN_ATTEMPTS_PER_15_MIN: "1" })).toBe(1);
  });
});

describe("createSignInLimits", () => {
  const fail = (
    limits: ReturnType<typeof createSignInLimits>,
    email: string,
    address: string,
    times = 1,
  ) => {
    for (let i = 0; i < times; i += 1) limits.recordFailure(email, address);
  };

  it("blocks a pair after the allowed failures and frees it when the window passes", () => {
    let now = 0;
    const limits = createSignInLimits(3, () => now);
    fail(limits, "a@b.test", "1.1.1.1", 2);
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(false);
    fail(limits, "a@b.test", "1.1.1.1");
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(true);
    now = SIGN_IN_WINDOW_MS - 1;
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(true);
    now = SIGN_IN_WINDOW_MS + 1;
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(false);
  });

  it("asking whether it is blocked counts nothing (only recorded failures count)", () => {
    const limits = createSignInLimits(1, () => 0);
    for (let i = 0; i < 20; i += 1) expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(false);
  });

  it("the owner cannot be locked out from elsewhere: failures from address A leave the same email free at address B", () => {
    const limits = createSignInLimits(3, () => 0);
    fail(limits, "owner@b.test", "6.6.6.6", 3);
    expect(limits.blocked("owner@b.test", "6.6.6.6")).toBe(true);
    expect(limits.blocked("owner@b.test", "2.2.2.2")).toBe(false);
  });

  it("a success clears the pair's failures", () => {
    const limits = createSignInLimits(3, () => 0);
    fail(limits, "a@b.test", "1.1.1.1", 2);
    limits.recordSuccess("a@b.test", "1.1.1.1");
    fail(limits, "a@b.test", "1.1.1.1", 2);
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(false);
    fail(limits, "a@b.test", "1.1.1.1");
    expect(limits.blocked("a@b.test", "1.1.1.1")).toBe(true);
  });

  it("the per-email backstop (5x) still caps guessing spread over many addresses", () => {
    const limits = createSignInLimits(2, () => 0);
    for (let i = 0; i < 2 * EMAIL_BACKSTOP_FACTOR - 1; i += 1)
      fail(limits, "owner@b.test", `10.0.0.${i}`);
    expect(limits.blocked("owner@b.test", "10.9.9.9")).toBe(false);
    fail(limits, "owner@b.test", "10.0.1.1");
    expect(limits.blocked("owner@b.test", "10.9.9.9")).toBe(true);
    expect(limits.blocked("other@b.test", "10.9.9.9")).toBe(false);
  });

  it("the per-address allowance (4x) caps one address trying many accounts", () => {
    const limits = createSignInLimits(2, () => 0);
    for (let i = 0; i < 2 * ADDRESS_ALLOWANCE_FACTOR - 1; i += 1)
      fail(limits, `u${i}@b.test`, "9.9.9.9");
    expect(limits.blocked("fresh@b.test", "9.9.9.9")).toBe(false);
    fail(limits, "u-last@b.test", "9.9.9.9");
    expect(limits.blocked("fresh@b.test", "9.9.9.9")).toBe(true);
    expect(limits.blocked("fresh@b.test", "8.8.8.8")).toBe(false);
  });

  it("ignores email case and surrounding space", () => {
    const limits = createSignInLimits(1, () => 0);
    fail(limits, " A@b.test ", "1.1.1.1");
    expect(limits.blocked("a@B.test", "1.1.1.1")).toBe(true);
  });
});

describe("clientAddress", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  it("takes the first forwarded address, else the real-ip header, else 'unknown'", () => {
    expect(clientAddress(headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientAddress(headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientAddress(headers({ "x-forwarded-for": "", "x-real-ip": " " }))).toBe("unknown");
    expect(clientAddress(headers({}))).toBe("unknown");
  });
});

describe("the shared limiter", () => {
  it("is created once, and can be reset", () => {
    resetSignInLimits();
    const first = signInLimits();
    expect(signInLimits()).toBe(first);
    resetSignInLimits();
    expect(signInLimits()).not.toBe(first);
  });
});
