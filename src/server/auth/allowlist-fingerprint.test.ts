import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./allowlist";
import { allowlistFingerprint, describeAllowlist } from "./allowlist-fingerprint";

const SECRET = "k".repeat(40);

describe("allowlistFingerprint", () => {
  it("is 12 hex characters", () => {
    expect(allowlistFingerprint(parseAllowlist("a@example.test"), SECRET)).toMatch(
      /^[0-9a-f]{12}$/,
    );
  });

  it("does not depend on order, case, spacing, separators or repeats", () => {
    const base = allowlistFingerprint(parseAllowlist("a@example.test,b@example.test"), SECRET);
    for (const same of [
      "b@example.test, a@example.test",
      "  B@EXAMPLE.TEST ; a@Example.test",
      "a@example.test b@example.test a@example.test",
      "a@example.test\nb@example.test",
    ]) {
      expect(allowlistFingerprint(parseAllowlist(same), SECRET)).toBe(base);
    }
  });

  it("changes when an address is added, removed or different", () => {
    const base = allowlistFingerprint(parseAllowlist("a@example.test"), SECRET);
    for (const other of ["a@example.test,b@example.test", "b@example.test", "a@example.tes", ""]) {
      expect(allowlistFingerprint(parseAllowlist(other), SECRET)).not.toBe(base);
    }
  });

  it("changes with the cookie secret, so it cannot be tested against guessed addresses without it", () => {
    const list = parseAllowlist("a@example.test");
    expect(allowlistFingerprint(list, SECRET)).not.toBe(allowlistFingerprint(list, `${SECRET}x`));
  });

  it("carries no address or secret", () => {
    const print = allowlistFingerprint(parseAllowlist("owner@example.test"), SECRET);
    expect(print).not.toMatch(/owner|example|kkkk/);
  });
});

describe("describeAllowlist", () => {
  it("counts the entries and fingerprints them the way the app parses the raw value", () => {
    const described = describeAllowlist("A@example.test, b@example.test;", SECRET);
    expect(described.entries).toBe(2);
    expect(described.fingerprint).toBe(
      allowlistFingerprint(parseAllowlist("a@example.test b@example.test"), SECRET),
    );
  });

  it("reports an empty or missing allowlist as zero entries", () => {
    expect(describeAllowlist(undefined, SECRET).entries).toBe(0);
    expect(describeAllowlist("  ,; ", SECRET).entries).toBe(0);
  });
});
