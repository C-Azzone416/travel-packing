import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAL_LIFETIME_MS, NO_SEALS, createSetupSeals, sealKey } from "./setup-seal";

const SECRET = "s".repeat(40);
const OWNER = "owner@example.test";
const SECOND = "second@example.test";
const ALLOWED = [OWNER, SECOND];

/** Every way a segment of a URL value could be read back: as text, base64url, base64, hex and with the digits reversed. */
function decodings(segment: string): string[] {
  const out = [segment, decodeURIComponent(segment)];
  for (const encoding of ["base64url", "base64", "hex"] as const) {
    try {
      out.push(Buffer.from(segment, encoding).toString("utf8"));
      out.push(Buffer.from(segment, encoding).toString("latin1"));
    } catch {
      // Not decodable that way.
    }
  }
  return out.map((text) => text.toLowerCase());
}

describe("setup seals", () => {
  it("names the address it was made for, in normalized form, chosen from the allowed ones", () => {
    const seals = createSetupSeals(SECRET);
    expect(seals.open(seals.seal("  Owner@Example.TEST "), ALLOWED)).toBe(OWNER);
    expect(seals.open(seals.seal(SECOND), ALLOWED)).toBe(SECOND);
  });

  it("has two URL-safe segments, an expiry and a digest, and no address in any of them under any decoding (#210)", () => {
    const NOW = 1_800_000_000_000;
    const seals = createSetupSeals(SECRET, () => NOW);
    for (const address of [OWNER, SECOND, "someone.with+tag@sub.example.test"]) {
      const sealed = seals.seal(address);
      expect(sealed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const segments = sealed.split(".");
      expect(segments).toHaveLength(2);
      // Anything a reader could recover: the whole address, its two halves, and the words in them.
      const [local, domain] = address.split("@");
      const pieces = [address, local, domain, ...address.split(/[^a-z]+/)].filter(
        (piece) => piece.length >= 4,
      );
      for (const segment of segments) {
        for (const text of decodings(segment)) {
          for (const piece of pieces) {
            expect(text, `${segment} read back as ${JSON.stringify(text)}`).not.toContain(piece);
          }
        }
      }
      // The first segment is only the expiry: a timestamp.
      expect(Number(segments[0])).toBe(NOW + SEAL_LIFETIME_MS);
    }
  });

  it("the digest depends on the address, on the expiry and on the secret", () => {
    let now = 1_000_000;
    const seals = createSetupSeals(SECRET, () => now);
    const a = seals.seal(OWNER);
    expect(seals.seal(OWNER)).toBe(a);
    expect(seals.seal(SECOND)).not.toBe(a);
    now += 1;
    expect(seals.seal(OWNER)).not.toBe(a);
    expect(createSetupSeals("t".repeat(40), () => now).seal(OWNER)).not.toBe(seals.seal(OWNER));
  });

  it("is refused when anything in it is changed", () => {
    const seals = createSetupSeals(SECRET);
    const [expires, digest] = seals.seal(OWNER).split(".");
    const flipped = `${digest.slice(0, -1)}${digest.endsWith("A") ? "B" : "A"}`;
    for (const tampered of [
      `${Number(expires) + 1}.${digest}`,
      `${expires}.${flipped}`,
      `${expires}.${digest.slice(0, -1)}`,
      `${expires}.${digest}A`,
      `${expires}.`,
      `.${digest}`,
      expires,
      `${expires}.${digest}.extra`,
      `x${expires}.${digest}`,
    ]) {
      expect(seals.open(tampered, ALLOWED), tampered).toBeNull();
    }
  });

  it("is refused under a different secret, so only the app can make one", () => {
    const sealed = createSetupSeals(SECRET).seal(OWNER);
    expect(createSetupSeals("t".repeat(40)).open(sealed, ALLOWED)).toBeNull();
  });

  it("expires with the link", () => {
    let now = 1_000_000;
    const seals = createSetupSeals(SECRET, () => now);
    const sealed = seals.seal(OWNER);
    now += SEAL_LIFETIME_MS - 1;
    expect(seals.open(sealed, ALLOWED)).toBe(OWNER);
    now += 2;
    expect(seals.open(sealed, ALLOWED)).toBeNull();
  });

  it("names nobody when the address is not among the allowed ones, and never a different allowed one", () => {
    const seals = createSetupSeals(SECRET);
    expect(seals.open(seals.seal("stranger@example.test"), ALLOWED)).toBeNull();
    expect(seals.open(seals.seal(OWNER), [SECOND])).toBeNull();
    expect(seals.open(seals.seal(OWNER), [])).toBeNull();
    // An allowed list that holds the address among others finds exactly it.
    expect(seals.open(seals.seal(SECOND), [OWNER, "x@y.test", SECOND])).toBe(SECOND);
  });

  it("refuses a link in the shape used before #210 (<address>.<expiry>.<mac>), even one correctly signed", () => {
    const seals = createSetupSeals(SECRET);
    const payload = `${Buffer.from(OWNER).toString("base64url")}.${Date.now() + 10_000}`;
    const old = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    expect(old.split(".")).toHaveLength(3);
    expect(seals.open(old, ALLOWED)).toBeNull();
  });

  it("refuses anything that is not a seal", () => {
    const seals = createSetupSeals(SECRET);
    for (const value of [undefined, null, 5, "", "a.b", "a.b.c", "1.x", "x".repeat(101), {}, []]) {
      expect(seals.open(value, ALLOWED)).toBeNull();
    }
    expect(seals.open(`soon.${"A".repeat(43)}`, ALLOWED)).toBeNull();
  });

  it("the key is derived from the app secret and differs from it", () => {
    expect(sealKey(SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(sealKey(SECRET)).not.toBe(SECRET);
    expect(sealKey(SECRET)).toBe(sealKey(SECRET));
    expect(sealKey(SECRET)).not.toBe(sealKey("t".repeat(40)));
  });

  it("the key label is unchanged (carrywell:setup-seal:v1): no key rotation came with the new format", () => {
    expect(sealKey(SECRET)).toBe(
      createHmac("sha256", SECRET).update("carrywell:setup-seal:v1").digest("hex"),
    );
  });

  it("the no-secret runtime seals nothing and opens nothing", () => {
    expect(NO_SEALS.seal(OWNER)).toBe("");
    expect(NO_SEALS.open("anything", ALLOWED)).toBeNull();
  });
});
