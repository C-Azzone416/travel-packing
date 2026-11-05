import { describe, expect, it } from "vitest";
import { saveStaplesSetupInput, stapleInput } from "./schemas";

const valid = {
  semanticId: "tops",
  name: "Tops",
  category: "Clothing",
  qty: 1,
  cadence: "per day",
  packLast: false,
};

describe("stapleInput (#378)", () => {
  it("accepts per night, the laundry flag and a cube", () => {
    const parsed = stapleInput.parse({
      ...valid,
      semanticId: "lens",
      category: "Bathroom",
      cadence: "per night",
      laundryHalves: true,
      cube: "toiletries",
    });
    expect(parsed).toMatchObject({ cadence: "per night", laundryHalves: true, cube: "toiletries" });
  });

  it("accepts the laundry flag on a per-day Staple that can carry it", () => {
    expect(stapleInput.safeParse({ ...valid, laundryHalves: true }).success).toBe(true);
  });

  it.each(["underwear", "socks"])("rejects the laundry flag on %s", (semanticId) => {
    const result = stapleInput.safeParse({ ...valid, semanticId, laundryHalves: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["laundryHalves"]);
  });

  it.each(["underwear", "socks"])("accepts %s without the flag", (semanticId) => {
    expect(stapleInput.safeParse({ ...valid, semanticId, laundryHalves: false }).success).toBe(
      true,
    );
    expect(stapleInput.safeParse({ ...valid, semanticId }).success).toBe(true);
  });

  it("rejects an unknown cube and still rejects Smart on a non-clothing item", () => {
    expect(stapleInput.safeParse({ ...valid, cube: "attic" }).success).toBe(false);
    expect(
      stapleInput.safeParse({ ...valid, semanticId: "chargers", cadence: "smart" }).success,
    ).toBe(false);
  });

  it("applies the same rules inside the setup save", () => {
    const socks = { ...valid, semanticId: "socks", laundryHalves: true };
    expect(saveStaplesSetupInput.safeParse({ staples: [socks] }).success).toBe(false);
    expect(
      saveStaplesSetupInput.safeParse({ staples: [{ ...valid, laundryHalves: true }] }).success,
    ).toBe(true);
  });
});
