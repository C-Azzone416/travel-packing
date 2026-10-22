import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAL_LIFETIME_MS, NO_SEALS, createSetupSeals, sealKey } from "./setup-seal";

const SECRET = "s".repeat(40);

describe("setup seals", () => {
  it("names the address it was made for, in normalized form", () => {
    const seals = createSetupSeals(SECRET);
    expect(seals.open(seals.seal("  Owner@Example.TEST "))).toBe("owner@example.test");
  });

  it("is URL-safe and carries no readable address", () => {
    const sealed = createSetupSeals(SECRET).seal("owner@example.test");
    expect(sealed).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(sealed).not.toContain("owner@example.test");
    expect(sealed).not.toContain("@");
  });

  it("is refused when anything in it is changed", () => {
    const seals = createSetupSeals(SECRET);
    const [name, expires, mac] = seals.seal("owner@example.test").split(".");
    const other = Buffer.from("stranger@example.test").toString("base64url");
    for (const tampered of [
      `${other}.${expires}.${mac}`,
      `${name}.${Number(expires) + 1}.${mac}`,
      `${name}.${expires}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
      `${name}.${expires}.`,
      `${name}.${expires}`,
      `${name}.${expires}.${mac}.extra`,
    ]) {
      expect(seals.open(tampered)).toBeNull();
    }
  });

  it("is refused under a different secret, so only the app can make one", () => {
    const sealed = createSetupSeals(SECRET).seal("owner@example.test");
    expect(createSetupSeals("t".repeat(40)).open(sealed)).toBeNull();
  });

  it("expires with the link", () => {
    let now = 1_000_000;
    const seals = createSetupSeals(SECRET, () => now);
    const sealed = seals.seal("owner@example.test");
    now += SEAL_LIFETIME_MS - 1;
    expect(seals.open(sealed)).toBe("owner@example.test");
    now += 2;
    expect(seals.open(sealed)).toBeNull();
  });

  it("refuses anything that is not a seal", () => {
    const seals = createSetupSeals(SECRET);
    for (const value of [undefined, null, 5, "", "a.b.c", "x".repeat(601), {}]) {
      expect(seals.open(value)).toBeNull();
    }
    // A correctly signed value whose name is not an address, and whose expiry is not a number.
    const sign = (payload: string) =>
      `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    const notAnAddress = Buffer.from("nobody").toString("base64url");
    expect(seals.open(sign(`${notAnAddress}.${Date.now() + 10_000}`))).toBeNull();
    expect(seals.open(sign(`${Buffer.from("a@b.c").toString("base64url")}.soon`))).toBeNull();
  });

  it("the key is derived from the app secret and differs from it", () => {
    expect(sealKey(SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(sealKey(SECRET)).not.toBe(SECRET);
    expect(sealKey(SECRET)).toBe(sealKey(SECRET));
    expect(sealKey(SECRET)).not.toBe(sealKey("t".repeat(40)));
  });

  it("the no-secret runtime seals nothing and opens nothing", () => {
    expect(NO_SEALS.seal("owner@example.test")).toBe("");
    expect(NO_SEALS.open("anything")).toBeNull();
  });
});
