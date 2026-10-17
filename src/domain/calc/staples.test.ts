import { describe, expect, it } from "vitest";
import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import {
  buildTripItems,
  DEFAULT_PACK_LAST,
  DEFAULT_STAPLES,
  niceAccessoryKey,
  type Staple,
  type TripItem,
} from "./staples";
import type { CalcConfig } from "./suggestions";

const config: CalcConfig = {
  start: "2026-11-12",
  end: "2026-11-16",
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

const byId = (items: TripItem[], id: string) => items.find((item) => item.id === id);
const staple = (overrides: Partial<Staple> & Pick<Staple, "id" | "name">): Staple => ({
  qty: 1,
  cadence: "per trip",
  category: "Other",
  packLast: false,
  ...overrides,
});

describe("niceAccessoryKey", () => {
  it.each([
    ["Makeup", "makeup"],
    ["Travel make-up kit", "makeup"],
    ["Dress shoes", "dress-shoes"],
    ["Dress-specific undergarments", "dress-undergarments"],
    ["Dress shirt", ""],
    ["Sneakers", ""],
    ["", ""],
  ])("%j → %j", (name, expected) => {
    expect(niceAccessoryKey({ name })).toBe(expected);
  });

  it("treats a missing name as no key", () => {
    expect(niceAccessoryKey({})).toBe("");
    expect(niceAccessoryKey({ name: null })).toBe("");
  });
});

describe("buildTripItems with no staples", () => {
  it("lists calculated items, Sunglasses, the return outfit and Pack last", () => {
    const { days, dailyDays, items } = buildTripItems(config, []);
    expect(days).toBe(5);
    expect(dailyDays).toBe(3);
    expect(items.map((item) => item.id)).toEqual([
      "tops",
      "bottoms",
      "underwear",
      "socks",
      "sleepwear",
      "sunglasses",
      "return-top",
      "return-bottoms",
      "return-underwear",
      "return-socks",
      "last-laptop",
      "last-chargers",
      "last-glasses",
    ]);
    expect(items.every((item) => item.packed === 0)).toBe(true);
  });

  it("seeds Pack last with Laptop, one collective Chargers and Everyday glasses", () => {
    expect(DEFAULT_PACK_LAST.map((entry) => entry.name)).toEqual([
      "Laptop",
      "Chargers",
      "Everyday glasses",
    ]);
    const { items } = buildTripItems(config, []);
    const packLast = items.filter((item) => item.section === "packlast");
    expect(packLast.map((item) => [item.name, item.qty, item.category])).toEqual([
      ["Laptop", 1, "Pack last"],
      ["Chargers", 1, "Pack last"],
      ["Everyday glasses", 1, "Pack last"],
    ]);
    expect(byId(items, "sunglasses")?.name).toBe("Sunglasses");
  });

  it("adds exactly four distinct return items, qty 1, never merged with everyday items", () => {
    const { items } = buildTripItems({ ...config, spare: true }, []);
    const returns = items.filter((item) => item.section === "return");
    expect(returns.map((item) => [item.id, item.name, item.qty])).toEqual([
      ["return-top", "Fresh top", 1],
      ["return-bottoms", "Bottoms", 1],
      ["return-underwear", "Underwear", 1],
      ["return-socks", "Socks", 1],
    ]);
    expect(byId(items, "underwear")?.qty).toBe(4);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("omits the return outfit only when returnOutfit is false, with everyday quantities unchanged", () => {
    const withReturn = buildTripItems(config, []);
    const without = buildTripItems({ ...config, returnOutfit: false }, []);
    expect(without.items.some((item) => item.section === "return")).toBe(false);
    expect(
      buildTripItems({ ...config, returnOutfit: undefined }, []).items.filter(
        (item) => item.section === "return",
      ),
    ).toHaveLength(4);
    expect(without.dailyDays).toBe(withReturn.dailyDays);
    expect(byId(without.items, "tops")?.qty).toBe(byId(withReturn.items, "tops")?.qty);
  });

  it("puts calculated Makeup in the toiletry bag and flags nice companions optional", () => {
    const { items } = buildTripItems({ ...config, niceAttire: true }, []);
    expect(byId(items, "nice-makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(byId(items, "nice-makeup")?.optional).toBe(true);
    expect(byId(items, "nice-shoes")?.groupId).toBeUndefined();
    expect(byId(items, "tops")?.optional).toBe(false);
  });
});

describe("staple merge", () => {
  it("scales per-day staples by the packing days and keeps per-trip staples flat", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "vitamins", name: "Vitamins", qty: 2, cadence: "per day" }),
      staple({ id: "book", name: "Book", qty: 2 }),
    ]);
    expect(byId(items, "vitamins")?.qty).toBe(6);
    expect(byId(items, "book")?.qty).toBe(2);
  });

  it("skips a staple with zero quantity when nothing matches it", () => {
    const { items } = buildTripItems({ ...config, end: "2026-11-13" }, [
      staple({ id: "vitamins", name: "Vitamins", cadence: "per day" }),
    ]);
    expect(byId(items, "vitamins")).toBeUndefined();
  });

  it("replaces the calculated quantity instead of summing", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "underwear", name: "Briefs", qty: 2, cadence: "per day", category: "Clothing" }),
    ]);
    const underwear = items.filter((item) => item.id === "underwear");
    expect(underwear).toHaveLength(1);
    expect(underwear[0]).toMatchObject({
      name: "Briefs",
      category: "Clothing",
      qty: 6,
      section: "main",
    });
  });

  it("adds the spare +1 on top of the staple-derived quantity for underwear and socks only", () => {
    const stapleSet = [
      staple({ id: "underwear", name: "Underwear", qty: 2, cadence: "per day" }),
      staple({ id: "socks", name: "Socks", cadence: "per day" }),
      staple({ id: "sleepwear", name: "Sleepwear" }),
    ];
    const spare = buildTripItems({ ...config, spare: true }, stapleSet).items;
    expect(byId(spare, "underwear")?.qty).toBe(7);
    expect(byId(spare, "socks")?.qty).toBe(4);
    expect(byId(spare, "sleepwear")?.qty).toBe(1);
    const noSpare = buildTripItems(config, stapleSet).items;
    expect(byId(noSpare, "underwear")?.qty).toBe(6);
    expect(byId(noSpare, "socks")?.qty).toBe(3);
  });

  // Prototype quirk kept on purpose: only an UNMATCHED staple with qty <= 0 is
  // skipped. A matched one still overwrites the existing item, down to qty 0.
  it("zeroes an existing item matched by id when the staple quantity is 0", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "sleepwear", name: "Sleepwear", qty: 0 }),
    ]);
    expect(items.filter((item) => item.id === "sleepwear")).toHaveLength(1);
    expect(byId(items, "sleepwear")?.qty).toBe(0);
  });

  it("zeroes an existing item matched by nice-accessory key when the staple quantity is 0", () => {
    const { items } = buildTripItems({ ...config, niceAttire: true }, [
      staple({ id: "my-shoes", name: "Dress shoes", qty: 0 }),
    ]);
    expect(byId(items, "nice-shoes")).toBeUndefined();
    expect(byId(items, "my-shoes")?.qty).toBe(0);
  });

  it("replaces a matched item's quantity with 0 for a per-day staple on a trip with no packing days", () => {
    const twoDays = { ...config, end: "2026-11-13" };
    expect(byId(buildTripItems(twoDays, []).items, "sleepwear")?.qty).toBe(1);
    const { dailyDays, items } = buildTripItems(twoDays, [
      staple({ id: "sleepwear", name: "Sleepwear", cadence: "per day" }),
    ]);
    expect(dailyDays).toBe(0);
    expect(byId(items, "sleepwear")?.qty).toBe(0);
  });

  it("moves a matched item to Pack last or main by the staple's packLast flag", () => {
    const toPackLast = buildTripItems(config, [
      staple({ id: "sleepwear", name: "Sleepwear", packLast: true }),
    ]).items;
    expect(byId(toPackLast, "sleepwear")?.section).toBe("packlast");
    const toMain = buildTripItems(config, [
      staple({ id: "last-laptop", name: "Laptop", packLast: false }),
    ]).items;
    expect(byId(toMain, "last-laptop")?.section).toBe("main");
  });

  it("keeps return items in the return section when a staple matches their id", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "return-top", name: "Spare top", qty: 2, packLast: true }),
    ]);
    expect(byId(items, "return-top")).toMatchObject({
      name: "Spare top",
      qty: 2,
      section: "return",
    });
  });

  it("takes the group from the staple and clears it when the staple has none", () => {
    const { items } = buildTripItems({ ...config, niceAttire: true }, [
      staple({
        id: "last-toothbrush",
        name: "Toothbrush",
        category: "Bathroom",
        packLast: true,
        groupId: TOILETRY_GROUP_ID,
      }),
      staple({ id: "nice-shoes", name: "Dress shoes", category: "Nice attire" }),
    ]);
    expect(byId(items, "last-toothbrush")).toMatchObject({
      section: "packlast",
      groupId: TOILETRY_GROUP_ID,
    });
    expect(byId(items, "nice-shoes")?.groupId).toBeNull();
  });
});

describe("staple dedupe against nice suggestions", () => {
  const nice = { ...config, niceAttire: true };

  it("replaces the calculated suggestion and adopts the staple id when the nice key matches", () => {
    const { items } = buildTripItems(nice, [
      staple({ id: "my-shoes", name: "Dress shoes", qty: 2, category: "Shoes" }),
    ]);
    expect(byId(items, "nice-shoes")).toBeUndefined();
    expect(items.filter((item) => niceAccessoryKey(item) === "dress-shoes")).toHaveLength(1);
    expect(byId(items, "my-shoes")).toMatchObject({ qty: 2, category: "Shoes", optional: true });
  });

  it("does not rename the id when the staple id already matches", () => {
    const { items } = buildTripItems(nice, [
      staple({ id: "nice-undergarments", name: "Dress-specific undergarments" }),
    ]);
    expect(items.filter((item) => niceAccessoryKey(item) === "dress-undergarments")).toHaveLength(
      1,
    );
    expect(byId(items, "nice-undergarments")).toBeDefined();
  });

  it("forces Makeup into the toiletry bag whether it comes from a staple or a suggestion", () => {
    const fromStaple = buildTripItems(nice, [
      staple({ id: "makeup", name: "Makeup", groupId: "other-bag" }),
    ]).items;
    expect(byId(fromStaple, "makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(byId(fromStaple, "nice-makeup")).toBeUndefined();
    const added = buildTripItems(config, [staple({ id: "makeup", name: "Makeup" })]).items;
    expect(byId(added, "makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
    const fromSuggestion = buildTripItems(nice, []).items;
    expect(byId(fromSuggestion, "nice-makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
  });

  it("keeps the suggestion when no staple has matching semantics", () => {
    const { items } = buildTripItems(nice, [staple({ id: "scarf", name: "Scarf" })]);
    expect(byId(items, "nice-shoes")).toBeDefined();
    expect(byId(items, "scarf")).toBeDefined();
  });
});

describe("default staples", () => {
  it("merges into a trip with the 4 Bathroom staples in the toiletry bag", () => {
    const { items } = buildTripItems({ ...config, spare: true }, DEFAULT_STAPLES);
    const bathroom = items.filter((item) => item.category === "Bathroom");
    expect(bathroom.map((item) => item.name)).toEqual([
      "Toothbrush",
      "Toothpaste",
      "Deodorant",
      "Contacts",
    ]);
    expect(
      bathroom.every((item) => item.groupId === TOILETRY_GROUP_ID && item.section === "packlast"),
    ).toBe(true);
    expect(byId(items, "underwear")).toMatchObject({ qty: 4, category: "Clothing" });
    expect(byId(items, "sunglasses")).toMatchObject({
      section: "main",
      category: "Other essentials",
    });
    expect(items.filter((item) => item.name === "Everyday glasses")).toHaveLength(1);
    expect(items.filter((item) => item.name === "Chargers")).toHaveLength(1);
  });
});
