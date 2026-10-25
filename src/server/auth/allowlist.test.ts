import { describe, expect, it } from "vitest";
import { isAllowed, normalizeEmail, parseAllowlist, isPlainEmail } from "./allowlist";

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
  const allowlist = parseAllowlist("allowed@example.test");

  it("admits a listed email regardless of case or padding", () => {
    expect(isAllowed(allowlist, "allowed@example.test")).toBe(true);
    expect(isAllowed(allowlist, "  Allowed@Example.TEST ")).toBe(true);
  });

  it.each([
    ["an unlisted email", "other@example.test"],
    ["a superstring", "xallowed@example.test"],
    ["a substring", "allowe@example.test"],
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
    expect(normalizeEmail("  Owner@Example.TEST ")).toBe("owner@example.test");
  });
});

describe("isPlainEmail", () => {
  it.each([
    "owner@example.test",
    "  owner@example.test ",
    "o.w+tag@example.com",
    "o_w-n%er@example.org",
    "owner@sub.example.net",
  ])("accepts %s", (entry) => expect(isPlainEmail(entry)).toBe(true));

  it.each([
    ["wrapped in double quotes", '"owner@example.test"'],
    ["wrapped in single quotes", "'owner@example.test'"],
    ["wrapped in angle brackets", "<owner@example.test>"],
    ["with a display name", "Owner <owner@example.test>"],
    ["with a mailto: prefix", "mailto:owner@example.test"],
    ["without a domain dot", "owner@localhost"],
    ["with a numeric top-level domain", "owner@example.123"],
    ["with no @", "owner.example.test"],
    ["with two @", "a@owner@example.test"],
    ["with a trailing dot", "owner@example.test."],
    ["empty", ""],
  ])("rejects an entry %s, which could never equal a real sign-up address", (_name, entry) => {
    expect(isPlainEmail(entry)).toBe(false);
  });
});
