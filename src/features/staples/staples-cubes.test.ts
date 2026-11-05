import { describe, expect, it } from "vitest";
import { SYNTHETIC_STAPLES, stapleContext, stapleQuantity } from "@/domain/calc";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import {
  STAPLE_CUBES,
  canHaveLaundry,
  groupByCube,
  itemsLabel,
  moveToCube,
  nightsLabel,
  previewStaples,
  scalesWithTrip,
  stapleCount,
  stapleCube,
  withCadence,
  withLaundry,
} from "./staples-cubes";

const staple = (patch: Partial<Staple>): Staple => ({
  id: "x",
  name: "X",
  qty: 1,
  cadence: "per trip",
  category: "Other essentials",
  packLast: false,
  ...patch,
});

describe("cubes of a staple", () => {
  it("never lists the weather cube", () => {
    expect(STAPLE_CUBES).toEqual(["clothing", "toiletries", "tech", "documents", "misc"]);
  });

  it("derives the cube from the category, honours a stored cube, and files weather in Misc", () => {
    expect(stapleCube(staple({ category: "Clothing" }))).toBe("clothing");
    expect(stapleCube(staple({ id: "passport", name: "Passport" }))).toBe("documents");
    expect(stapleCube(staple({ category: "Clothing", cube: "tech" }))).toBe("tech");
    expect(stapleCube(staple({ cube: "weather" }))).toBe("misc");
  });

  it("groups every staple into one cube section, in order", () => {
    const sections = groupByCube(SYNTHETIC_STAPLES);
    expect(sections.map((s) => s.label)).toEqual([
      "Clothing",
      "Toiletries",
      "Tech",
      "Documents",
      "Misc",
    ]);
    expect(sections.reduce((sum, s) => sum + s.staples.length, 0)).toBe(SYNTHETIC_STAPLES.length);
    expect(sections[1].staples.map((s) => s.name)).toContain("Toothbrush");
  });
});

describe("moveToCube", () => {
  it("keeps the category when it already puts the staple there", () => {
    const moved = moveToCube(staple({ category: "Nice attire" }), "clothing");
    expect(moved.category).toBe("Nice attire");
    expect(moved.cube).toBeUndefined();
  });

  it("changes the category with the cube and stores a cube only when the category cannot say it", () => {
    expect(moveToCube(staple({ category: "Clothing" }), "tech")).toMatchObject({
      category: "Tech",
    });
    const documents = moveToCube(staple({ category: "Clothing" }), "documents");
    expect(documents).toMatchObject({ category: "Other essentials", cube: "documents" });
    const misc = moveToCube(staple({ category: "Clothing" }), "misc");
    expect(misc).toMatchObject({ category: "Other essentials" });
    expect(stapleCube(misc)).toBe("misc");
  });

  it("puts Toiletries in the toiletry bag, and takes a staple out of it again", () => {
    const toiletry = moveToCube(staple({ category: "Clothing" }), "toiletries");
    expect(toiletry).toMatchObject({ category: "Bathroom", groupId: TOILETRY_GROUP_ID });
    const back = moveToCube(toiletry, "tech");
    expect(back.groupId).toBeUndefined();
    expect(back.cube).toBeUndefined();
    expect(stapleCube(back)).toBe("tech");
  });

  it("drops an old explicit cube when the move agrees with the category", () => {
    const moved = moveToCube(staple({ category: "Tech", cube: "misc" }), "tech");
    expect(moved.cube).toBeUndefined();
  });
});

describe("laundry and cadence edits", () => {
  it("sets and clears the flag", () => {
    const tees = staple({ id: "tops", cadence: "per day" });
    expect(withLaundry(tees, true).laundryHalves).toBe(true);
    expect(withLaundry(withLaundry(tees, true), false)).not.toHaveProperty("laundryHalves");
  });

  it("never sets the flag on underwear, socks or a Smart staple", () => {
    expect(withLaundry(staple({ id: "underwear", cadence: "per day" }), true)).not.toHaveProperty(
      "laundryHalves",
    );
    expect(withLaundry(staple({ id: "socks", cadence: "per day" }), true)).not.toHaveProperty(
      "laundryHalves",
    );
    expect(withLaundry(staple({ id: "nice-top", cadence: "smart" }), true)).not.toHaveProperty(
      "laundryHalves",
    );
    expect(canHaveLaundry(staple({ id: "tops", cadence: "per day" }))).toBe(true);
    expect(canHaveLaundry(staple({ id: "underwear" }))).toBe(false);
  });

  it("changes the cadence and keeps the flag", () => {
    const tees = staple({ id: "tops", cadence: "per day", laundryHalves: true });
    expect(withCadence(tees, "per night")).toMatchObject({
      cadence: "per night",
      laundryHalves: true,
    });
  });

  it("knows what scales with the trip", () => {
    expect(scalesWithTrip({ cadence: "per trip" })).toBe(false);
    expect(scalesWithTrip({ cadence: "per day" })).toBe(true);
    expect(scalesWithTrip({ cadence: "per night" })).toBe(true);
    expect(scalesWithTrip({ cadence: "smart" })).toBe(true);
  });
});

describe("previewStaples", () => {
  const tees = staple({ id: "tops", name: "Tees", cadence: "per day", laundryHalves: true });
  const underwear = staple({ id: "underwear", cadence: "per day", category: "Clothing" });
  const socks = staple({ id: "socks", cadence: "per day" });
  const laptop = staple({ id: "laptop", category: "Tech" });
  const nightly = staple({ id: "meds", name: "Meds", cadence: "per night", qty: 2 });
  const all = [tees, underwear, socks, laptop, nightly];

  it("uses the domain's own quantity for every row", () => {
    const summary = previewStaples(all, 4, true);
    for (const row of summary.rows) {
      const days = { days: 5, nights: 4, dailyDays: 5 };
      const context = stapleContext({ laundry: true, spare: false }, days);
      expect(row.qty).toBe(stapleQuantity(row.staple, context));
    }
    // 5 days: tees 5 halved to 3, underwear 5, socks 5, laptop 1, meds 4 nights x 2.
    expect(summary.rows.map((r) => r.qty)).toEqual([3, 5, 5, 1, 8]);
    expect(summary.rows.map((r) => r.plain)).toEqual([5, 5, 5, 1, 8]);
    expect(summary.total).toBe(22);
    expect(summary.saves).toBe(2);
  });

  it("with laundry off the counts are plain, and 'saves' is what laundry would save", () => {
    const summary = previewStaples(all, 4, false);
    expect(summary.total).toBe(24);
    expect(summary.saves).toBe(2);
    expect(summary.rows.every((r) => r.qty === r.plain)).toBe(true);
  });

  it("counts by cube, and nothing saves when nothing is marked", () => {
    const summary = previewStaples([underwear, laptop], 10, true);
    expect(summary.saves).toBe(0);
    expect(Object.fromEntries(summary.perCube.map((c) => [c.cube, c.items]))).toEqual({
      clothing: 11,
      toiletries: 0,
      tech: 1,
      documents: 0,
      misc: 0,
    });
  });

  it("rounds halving up (11 -> 6) and handles a one-night trip", () => {
    expect(previewStaples([tees], 10, true).rows[0].qty).toBe(6);
    expect(previewStaples([tees], 1, true).rows[0]).toMatchObject({ plain: 2, qty: 1 });
  });

  it("takes a legacy Smart staple's count from the calculator", () => {
    const smart = staple({ id: "nice-top", name: "Nice top", cadence: "smart" });
    expect(previewStaples([smart], 4, false).rows[0].qty).toBeGreaterThan(0);
    const unknown = staple({ id: "not-a-smart-id", cadence: "smart" });
    expect(previewStaples([unknown], 4, false).rows[0].qty).toBe(0);
  });
});

describe("labels", () => {
  it("pluralises", () => {
    expect(nightsLabel(1)).toBe("1 night");
    expect(nightsLabel(4)).toBe("4 nights");
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(0)).toBe("0 items");
    expect(stapleCount(1)).toBe("1 staple");
    expect(stapleCount(24)).toBe("24 staples");
  });
});
