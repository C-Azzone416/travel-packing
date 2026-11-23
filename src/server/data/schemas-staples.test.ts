import { describe, expect, it } from "vitest";
import {
  checkedStapleInput,
  checkedStapleOnly,
  saveStaplesSetupInput,
  stapleInput,
} from "./schemas";

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

describe("Staple command expectations", () => {
  const revision = { rowId: "00000000-0000-4000-8000-000000000001", version: 1 };
  it.each([null, revision])(
    "accepts explicit expectation %j for both checked commands",
    (expected) => {
      expect(checkedStapleInput.parse({ staple: valid, expected })).toEqual({
        staple: valid,
        expected,
      });
      expect(checkedStapleOnly.parse({ semanticId: valid.semanticId, expected })).toEqual({
        semanticId: valid.semanticId,
        expected,
      });
    },
  );
  it.each([
    undefined,
    {},
    { ...revision, version: -1 },
    { ...revision, version: 2_147_483_648 },
    { ...revision, rowId: "bad" },
  ])("rejects missing/malformed metadata %j", (expected) => {
    expect(checkedStapleInput.safeParse({ staple: valid, expected }).success).toBe(false);
    expect(checkedStapleOnly.safeParse({ semanticId: valid.semanticId, expected }).success).toBe(
      false,
    );
  });
  it("keeps content and setup schemas independent of command expectations", () => {
    expect(stapleInput.parse(valid)).toEqual(valid);
    expect(saveStaplesSetupInput.parse({ staples: [valid] })).toEqual({ staples: [valid] });
    expect(
      checkedStapleInput.safeParse({
        staple: { ...valid, laundryHalves: true, semanticId: "socks" },
        expected: null,
      }).success,
    ).toBe(false);
  });
});
