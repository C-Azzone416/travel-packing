import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, parseKeyRing, seal } from "./key-ring";

const key = () => randomBytes(32).toString("base64");
const ringJson = (current: string, keys: Record<string, string>) =>
  JSON.stringify({ current, keys });
const account = { ownerId: "owner-1", generation: "6b0a1c2e-0000-4000-8000-000000000001" };

describe("parseKeyRing", () => {
  it("reads a versioned ring, standard or URL-safe base64", () => {
    const ring = parseKeyRing(
      ringJson("k2", { k1: key(), k2: randomBytes(32).toString("base64url") }),
    );
    expect(ring?.current).toBe("k2");
    expect([...(ring?.keys.keys() ?? [])]).toEqual(["k1", "k2"]);
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["not JSON", "k1:abc"],
    ["an array", "[]"],
    ["no current", JSON.stringify({ keys: { k1: key() } })],
    ["a current that is not in the ring", ringJson("k9", { k1: key() })],
    ["an unknown extra property", JSON.stringify({ current: "k1", keys: { k1: key() }, extra: 1 })],
    ["no keys", ringJson("k1", {})],
    ["a 16-byte key", ringJson("k1", { k1: randomBytes(16).toString("base64") })],
    ["a 33-byte key", ringJson("k1", { k1: randomBytes(33).toString("base64") })],
    ["a key that is not base64", ringJson("k1", { k1: "not base64 at all!!" })],
    ["a version name with a space", ringJson("k 1", { "k 1": key() })],
    ["a version name that is too long", ringJson("v".repeat(17), { ["v".repeat(17)]: key() })],
    [
      "nine keys",
      ringJson("k0", Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, key()]))),
    ],
  ])("is unavailable for %s", (_name, value) => {
    expect(parseKeyRing(value)).toBeNull();
  });
});

describe("seal and open", () => {
  const ring = parseKeyRing(ringJson("k1", { k1: key() }))!;

  it("round-trips, with a fresh nonce every time", () => {
    const first = seal(ring, account, "refresh-credential");
    const second = seal(ring, account, "refresh-credential");
    expect(first.keyVersion).toBe("k1");
    expect(first.sealed).not.toBe(second.sealed);
    expect(first.sealed).not.toContain("refresh-credential");
    expect(open(ring, account, first.keyVersion, first.sealed)).toBe("refresh-credential");
  });

  it("does not open for another owner, another generation or another key version (the account is bound in)", () => {
    const sealed = seal(ring, account, "secret");
    expect(open(ring, { ...account, ownerId: "owner-2" }, "k1", sealed.sealed)).toBeNull();
    expect(
      open(
        ring,
        { ...account, generation: "6b0a1c2e-0000-4000-8000-000000000002" },
        "k1",
        sealed.sealed,
      ),
    ).toBeNull();
    const rotated = parseKeyRing(ringJson("k2", { k1: key(), k2: key() }))!;
    expect(open(rotated, account, "k2", sealed.sealed)).toBeNull();
  });

  it("does not open when it was tampered with, truncated, mislabelled or sealed under a different key", () => {
    const { sealed } = seal(ring, account, "secret");
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect(open(ring, account, "k1", flipped)).toBeNull();
    expect(open(ring, account, "k1", sealed.slice(0, 20))).toBeNull();
    expect(open(ring, account, "k1", `v2.${sealed.slice(3)}`)).toBeNull();
    expect(open(ring, account, "k1", "")).toBeNull();
    const other = parseKeyRing(ringJson("k1", { k1: key() }))!;
    expect(open(other, account, "k1", sealed)).toBeNull();
  });

  it("an old key version still opens after a rotation, while new seals use the current one", () => {
    const k1 = key();
    const before = parseKeyRing(ringJson("k1", { k1 }))!;
    const old = seal(before, account, "secret");
    const after = parseKeyRing(ringJson("k2", { k1, k2: key() }))!;
    expect(open(after, account, old.keyVersion, old.sealed)).toBe("secret");
    expect(seal(after, account, "secret").keyVersion).toBe("k2");
  });
});
