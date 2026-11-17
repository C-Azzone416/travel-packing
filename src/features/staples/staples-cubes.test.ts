import { describe, expect, it } from "vitest";
import { SYNTHETIC_STAPLES, buildTripItems } from "@/domain/calc";
import { DEFAULT_TRIP_CONFIG } from "@/features/trips/draft";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import {
  STAPLE_CUBES,
  canChooseSmart,
  canHaveLaundry,
  cadenceChoices,
  groupByCube,
  itemsLabel,
  moveToCube,
  nightsLabel,
  previewStaples,
  ruleText,
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
  const clothing = { category: "Clothing" };
  const tees = staple({
    id: "tops",
    name: "Tees",
    cadence: "per day",
    laundryHalves: true,
    ...clothing,
  });
  const bottoms = staple({ id: "bottoms", name: "Bottoms", cadence: "per day", ...clothing });
  const underwear = staple({ id: "underwear", cadence: "per day", ...clothing });
  const socks = staple({ id: "socks", cadence: "per day", ...clothing });
  const laptop = staple({ id: "kindle", name: "Kindle", category: "Tech" });
  const nightly = staple({ id: "meds", name: "Meds", cadence: "per night", qty: 2 });
  const smart = staple({ id: "nice-top", name: "Nice top", cadence: "smart", ...clothing });
  const all = [tees, bottoms, underwear, socks, laptop, nightly, smart];
  const extras = [tees, bottoms, laptop, nightly, smart];

  // The preview must show what a real new trip STARTS with: the same builder, the same default preferences.
  it.each([1, 4, 10, 21])(
    "matches a real new trip for every staple at %i nights, laundry on and off",
    (nights) => {
      for (const laundry of [false, true]) {
        const start = "2026-01-01";
        const end = new Date(Date.UTC(2026, 0, 1 + nights)).toISOString().slice(0, 10);
        const real = buildTripItems({ ...DEFAULT_TRIP_CONFIG, start, end, laundry }, [
          ...SYNTHETIC_STAPLES,
          ...all,
        ]);
        const summary = previewStaples([...SYNTHETIC_STAPLES, ...all], nights, laundry);
        let total = 0;
        for (const row of summary.rows) {
          const item = real.items.find((entry) => entry.id === row.staple.id);
          expect(row.qty, `${row.staple.id} at ${nights} nights, laundry ${laundry}`).toBe(
            item?.qty ?? 0,
          );
          total += item?.qty ?? 0;
        }
        expect(summary.total).toBe(total);
      }
    },
  );

  it("matches a real trip's 'laundry saves' too", () => {
    for (const nights of [1, 4, 10, 21]) {
      const on = previewStaples(all, nights, true);
      const off = previewStaples(all, nights, false);
      expect(on.saves).toBe(off.saves);
      expect(off.total - on.total).toBe(off.saves);
    }
  });

  it("pins the numbers a default trip starts with (return outfit and a spare on)", () => {
    const table = [1, 4, 10, 21].map((nights) => {
      const off = previewStaples([tees, bottoms, underwear, socks], nights, false);
      const on = previewStaples([tees, bottoms, underwear, socks], nights, true);
      return [nights, off.total, on.total, on.saves];
    });
    expect(table).toEqual([
      [1, 6, 6, 0],
      [4, 18, 16, 2],
      [10, 42, 37, 5],
      [21, 86, 76, 10],
    ]);
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

  it("rounds halving up and handles a one-night trip", () => {
    expect(previewStaples([tees], 10, true).rows[0]).toMatchObject({ plain: 10, qty: 5 });
    expect(previewStaples([tees], 1, true).rows[0]).toMatchObject({ plain: 1, qty: 1 });
  });

  it("takes a legacy Smart staple's count from the calculator, and 0 for an unknown one", () => {
    const unknown = staple({ id: "not-a-smart-id", cadence: "smart" });
    expect(previewStaples([unknown], 4, false).rows[0].qty).toBe(0);
  });
});

describe("Smart cadence", () => {
  it("is offered only to clothing staples that have a Smart quantity (or already are Smart)", () => {
    expect(canChooseSmart(staple({ id: "bottoms", category: "Clothing" }))).toBe(true);
    expect(canChooseSmart(staple({ id: "nice-top", category: "Nice attire" }))).toBe(true);
    expect(canChooseSmart(staple({ id: "laptop", category: "Tech" }))).toBe(false);
    expect(canChooseSmart(staple({ id: "tops", category: "Tech" }))).toBe(false);
    expect(cadenceChoices(staple({ id: "laptop", category: "Tech" }))).toEqual([
      "per trip",
      "per day",
      "per night",
    ]);
    expect(cadenceChoices(staple({ id: "bottoms", category: "Clothing" }))).toContain("smart");
    expect(cadenceChoices(staple({ id: "x", cadence: "smart" }))).toContain("smart");
  });

  it("choosing Smart drops the laundry flag, and leaving Clothing makes a Smart staple per trip", () => {
    const tops = staple({
      id: "tops",
      category: "Clothing",
      cadence: "per day",
      laundryHalves: true,
    });
    expect(withCadence(tops, "smart")).not.toHaveProperty("laundryHalves");
    const smart = staple({ id: "tops", category: "Clothing", cadence: "smart" });
    expect(moveToCube(smart, "tech").cadence).toBe("per trip");
    expect(moveToCube(smart, "clothing").cadence).toBe("smart");
  });
});

describe("labels", () => {
  it("pluralises", () => {
    expect(nightsLabel(0)).toBe("day trip");
    expect(nightsLabel(1)).toBe("1 night");
    expect(nightsLabel(4)).toBe("4 nights");
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(0)).toBe("0 items");
    expect(stapleCount(1)).toBe("1 staple");
    expect(stapleCount(24)).toBe("24 staples");
  });
});

describe("ruleText", () => {
  it("is the saved rule, never a trip total", () => {
    expect(ruleText({ cadence: "per day", qty: 1 })).toBe("1 per day");
    expect(ruleText({ cadence: "per trip", qty: 2 })).toBe("2 per trip");
    expect(ruleText({ cadence: "per night", qty: 3 })).toBe("3 per night");
    expect(ruleText({ cadence: "smart", qty: 4 })).toBe("Smart");
  });
});
