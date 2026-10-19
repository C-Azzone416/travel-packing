import { describe, expect, it } from "vitest";
import { readLinkParams } from "./link-params";

describe("readLinkParams", () => {
  it("reads the seal and the token from a normal link", () => {
    expect(readLinkParams({ for: "seal.value.mac", token: "fake-token-one", setup: "1" })).toEqual({
      sealed: "seal.value.mac",
      token: "fake-token-one",
    });
  });

  it("splits a token the provider glued on with a second '?', rather than failing a good link", () => {
    expect(readLinkParams({ for: "seal.value.mac?token=fake-token-one" })).toEqual({
      sealed: "seal.value.mac",
      token: "fake-token-one",
    });
  });

  it("prefers a real token over a glued one", () => {
    expect(readLinkParams({ for: "seal.value.mac?token=glued", token: "real" })).toEqual({
      sealed: "seal.value.mac",
      token: "real",
    });
  });

  it("treats anything that is not a single string as missing", () => {
    expect(readLinkParams({ for: ["a", "b"], token: ["c"] })).toEqual({ sealed: "", token: "" });
    expect(readLinkParams({})).toEqual({ sealed: "", token: "" });
  });
});
