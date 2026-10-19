import { describe, expect, it } from "vitest";
import {
  CODE_GUESSES,
  RESEND_COOLDOWN_MS,
  SENDS_PER_CALLER_PER_HOUR,
  SENDS_PER_HOUR,
  SIGN_UPS_PER_CALLER_PER_HOUR,
  callerAllowancePerHour,
  createFlowLimits,
  flowLimits,
  resetFlowLimits,
} from "./flow-limits";

function clock() {
  let at = 1_000_000;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("sending codes and links", () => {
  it("allows one per address every 30 seconds and says how long to wait", () => {
    const time = clock();
    const limits = createFlowLimits(time.now);
    expect(limits.send("verify", "a@example.test", "1.1.1.1")).toEqual({ ok: true });
    time.advance(10_000);
    expect(limits.send("verify", "a@example.test", "1.1.1.1")).toEqual({
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: 20,
    });
    time.advance(RESEND_COOLDOWN_MS);
    expect(limits.send("verify", "a@example.test", "1.1.1.1")).toEqual({ ok: true });
  });

  it("reports the seconds left without counting anything", () => {
    const time = clock();
    const limits = createFlowLimits(time.now);
    expect(limits.cooldownRemaining("verify", "a@example.test")).toBe(0);
    limits.send("verify", "a@example.test", "1.1.1.1");
    time.advance(12_500);
    expect(limits.cooldownRemaining("verify", "A@Example.test")).toBe(18);
    expect(limits.cooldownRemaining("reset", "a@example.test")).toBe(0);
    time.advance(20_000);
    expect(limits.cooldownRemaining("verify", "a@example.test")).toBe(0);
  });

  it("treats the address case-insensitively and keeps verify and reset apart", () => {
    const limits = createFlowLimits(clock().now);
    limits.send("verify", "A@Example.test", "1.1.1.1");
    expect(limits.send("verify", "a@example.test", "2.2.2.2").ok).toBe(false);
    expect(limits.send("reset", "a@example.test", "2.2.2.2").ok).toBe(true);
  });

  it("gives every address the same gap, whether or not it is real", () => {
    const limits = createFlowLimits(clock().now);
    for (const email of ["real@example.test", "nobody@example.test"]) {
      expect(limits.send("reset", email, "1.1.1.1").ok).toBe(true);
      expect(limits.send("reset", email, "1.1.1.1")).toMatchObject({ reason: "cooldown" });
    }
  });

  it("caps an address at five an hour, and the cap says so rather than naming a gap", () => {
    const time = clock();
    const limits = createFlowLimits(time.now);
    for (let i = 0; i < SENDS_PER_HOUR; i += 1) {
      expect(limits.send("verify", "a@example.test", "1.1.1.1").ok).toBe(true);
      time.advance(RESEND_COOLDOWN_MS);
    }
    const sixth = limits.send("verify", "a@example.test", "1.1.1.1");
    expect(sixth).toMatchObject({ ok: false, reason: "limit" });
    if (!sixth.ok) expect(sixth.retryAfterSeconds).toBeGreaterThan(60);
  });

  it("caps one caller across many addresses", () => {
    const limits = createFlowLimits(clock().now);
    for (let i = 0; i < SENDS_PER_CALLER_PER_HOUR; i += 1) {
      expect(limits.send("reset", `user${i}@example.test`, "9.9.9.9").ok).toBe(true);
    }
    expect(limits.send("reset", "another@example.test", "9.9.9.9")).toMatchObject({
      reason: "limit",
    });
    expect(limits.send("reset", "another@example.test", "8.8.8.8").ok).toBe(true);
  });

  it("a refused request counts against nothing", () => {
    const time = clock();
    const limits = createFlowLimits(time.now);
    limits.send("verify", "a@example.test", "1.1.1.1");
    for (let i = 0; i < 30; i += 1) limits.send("verify", "a@example.test", "1.1.1.1");
    time.advance(RESEND_COOLDOWN_MS);
    expect(limits.send("verify", "a@example.test", "1.1.1.1").ok).toBe(true);
  });
});

describe("sign-up", () => {
  it("allows ten an hour per caller", () => {
    const limits = createFlowLimits(clock().now);
    for (let i = 0; i < SIGN_UPS_PER_CALLER_PER_HOUR; i += 1) {
      expect(limits.signUp("1.1.1.1").ok).toBe(true);
    }
    expect(limits.signUp("1.1.1.1").ok).toBe(false);
    expect(limits.signUp("2.2.2.2").ok).toBe(true);
  });
});

describe("guessing a verification code", () => {
  it("blocks after five wrong guesses, for that address only", () => {
    const limits = createFlowLimits(clock().now);
    for (let i = 0; i < CODE_GUESSES; i += 1) {
      expect(limits.guessBlocked("a@example.test").ok).toBe(true);
      limits.recordWrongGuess("a@example.test");
    }
    const blocked = limits.guessBlocked("A@example.test");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(15 * 60);
    expect(limits.guessBlocked("b@example.test").ok).toBe(true);
  });

  it("is cleared by a success or a new code, and ages out", () => {
    const time = clock();
    const limits = createFlowLimits(time.now);
    for (let i = 0; i < CODE_GUESSES; i += 1) limits.recordWrongGuess("a@example.test");
    limits.clearGuesses("a@example.test");
    expect(limits.guessBlocked("a@example.test").ok).toBe(true);
    for (let i = 0; i < CODE_GUESSES; i += 1) limits.recordWrongGuess("a@example.test");
    time.advance(15 * 60 * 1000);
    expect(limits.guessBlocked("a@example.test").ok).toBe(true);
  });
});

describe("the shared limits", () => {
  it("are created once and can be reset", () => {
    resetFlowLimits();
    const first = flowLimits();
    expect(flowLimits()).toBe(first);
    resetFlowLimits();
    expect(flowLimits()).not.toBe(first);
  });
});

describe("callerAllowancePerHour", () => {
  it("defaults to ten, accepts a whole number from 1 to 10000, and never switches the limit off", () => {
    expect(callerAllowancePerHour({})).toBe(SIGN_UPS_PER_CALLER_PER_HOUR);
    expect(callerAllowancePerHour({ AUTH_FLOW_CALLERS_PER_HOUR: " 500 " })).toBe(500);
    for (const bad of ["", "0", "-1", "1.5", "abc", "10001", "99999999"]) {
      expect(callerAllowancePerHour({ AUTH_FLOW_CALLERS_PER_HOUR: bad })).toBe(
        SIGN_UPS_PER_CALLER_PER_HOUR,
      );
    }
  });

  it("scales sign-ups and code emails together", () => {
    const limits = createFlowLimits(clock().now, 30);
    for (let i = 0; i < 30; i += 1) expect(limits.signUp("1.1.1.1").ok).toBe(true);
    expect(limits.signUp("1.1.1.1").ok).toBe(false);
    for (let i = 0; i < 60; i += 1) {
      expect(limits.send("reset", `u${i}@example.test`, "2.2.2.2").ok).toBe(true);
    }
    expect(limits.send("reset", "more@example.test", "2.2.2.2").ok).toBe(false);
  });
});
