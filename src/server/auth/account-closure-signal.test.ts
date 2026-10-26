import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS,
  NO_ACCOUNT_CLOSURE_SIGNALS,
  accountClosureSignalKey,
  createAccountClosureSignals,
} from "./account-closure-signal";

const SECRET = "s".repeat(40);
const NONCE = "A".repeat(32);

describe("account closure completion signals", () => {
  it("issues a short-lived signed value containing no identity", () => {
    const now = 1_800_000_000_000;
    const signals = createAccountClosureSignals(
      SECRET,
      () => now,
      () => NONCE,
    );
    const value = signals.issue();
    expect(value).toMatch(/^v1\.\d{13}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain("@");
    expect(value).not.toContain("owner");
    expect(value).not.toContain(SECRET);
    expect(signals.open(value)).toBe(true);
    expect(value.split(".")[1]).toBe(String(now + ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS));
  });

  it("rejects altered, expired, malformed, and differently signed values without throwing", () => {
    let now = 1_800_000_000_000;
    const signals = createAccountClosureSignals(
      SECRET,
      () => now,
      () => NONCE,
    );
    const value = signals.issue();
    const parts = value.split(".");
    expect(createAccountClosureSignals("t".repeat(40), () => now).open(value)).toBe(false);
    expect(signals.open(`${parts[0]}.${parts[1]}.${"B".repeat(32)}.${parts[3]}`)).toBe(false);
    expect(signals.open(`${value}x`)).toBe(false);
    for (const malformed of [
      undefined,
      null,
      5,
      "",
      "v1.x.y.z",
      `${value}.extra`,
      "x".repeat(161),
    ]) {
      expect(() => signals.open(malformed)).not.toThrow();
      expect(signals.open(malformed)).toBe(false);
    }
    now += ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS + 1;
    expect(signals.open(value)).toBe(false);
  });

  it("uses a purpose-derived key and fails closed with no secret", () => {
    const key = accountClosureSignalKey(SECRET);
    expect(key).toBe(
      createHmac("sha256", SECRET).update("packed-smart:account-closure-signal:v1").digest("hex"),
    );
    expect(key).not.toBe(SECRET);
    expect(NO_ACCOUNT_CLOSURE_SIGNALS.issue()).toBe("");
    expect(NO_ACCOUNT_CLOSURE_SIGNALS.open("anything")).toBe(false);
  });
});
