import { describe, expect, it } from "vitest";
import { isAllowed, normalizeEmail, parseAllowlist } from "./allowlist";

describe("parseAllowlist", () => {
  it.each([
    ["a single email", "owner@example.test", ["owner@example.test"]],
    ["commas", "a@example.test,b@example.test", ["a@example.test", "b@example.test"]],
    [
      "semicolons and spaces",
      "a@example.test; b@example.test  c@example.test",
      ["a@example.test", "b@example.test", "c@example.test"],
    ],
    ["newlines", "a@example.test\nb@example.test", ["a@example.test", "b@example.test"]],
    ["case and padding", "  Owner@Example.TEST ", ["owner@example.test"]],
    ["blank entries", " , ;; ,", []],
    ["empty string", "", []],
    ["undefined", undefined, []],
  ])("parses %s", (_name, raw, expected) => {
    expect([...parseAllowlist(raw)].sort()).toEqual([...expected].sort());
  });
});

describe("isAllowed", () => {
  const allowlist = parseAllowlist("owner@example.test");

  it("admits a listed email regardless of case or padding", () => {
    expect(isAllowed(allowlist, "owner@example.test")).toBe(true);
    expect(isAllowed(allowlist, "  OWNER@Example.Test ")).toBe(true);
  });

  it.each([
    ["an unlisted email", "someone@example.test"],
    ["a superstring", "owner@example.test.evil.test"],
    ["a substring", "wner@example.test"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_name, email) => {
    expect(isAllowed(allowlist, email)).toBe(false);
  });

  it("fails closed: an empty allowlist admits nobody", () => {
    expect(isAllowed(parseAllowlist(""), "owner@example.test")).toBe(false);
    expect(isAllowed(new Set(), "")).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@B.Test ")).toBe("a@b.test");
  });
});
