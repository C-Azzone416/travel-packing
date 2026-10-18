import { describe, expect, it } from "vitest";
import { DEFAULT_STAPLES } from "@/domain/calc";
import type { Staple } from "@/domain/trip";
import {
  categoryFor,
  countLabel,
  findDuplicate,
  groupStaples,
  newStapleId,
  sectionDescription,
  sectionOf,
  SECTIONS,
  unitLabel,
} from "./staples-view";

const staple = (patch: Partial<Staple>): Staple => ({
  id: "x",
  name: "X",
  qty: 1,
  cadence: "per trip",
  category: "Other essentials",
  packLast: false,
  ...patch,
});

describe("sectionOf", () => {
  it.each([
    ["Clothing", "Clothing"],
    ["clothes", "Clothing"],
    ["Nice attire", "Clothing"],
    ["Bathroom", "Bathroom"],
    ["Toiletries", "Bathroom"],
    ["Tech", "Tech"],
    ["technology", "Tech"],
    ["Other essentials", "Other essentials"],
    ["Accessories", "Other essentials"],
    ["", "Other essentials"],
  ])("puts category %j in %s", (category, section) => {
    expect(sectionOf({ category })).toBe(section);
  });

  it("puts a staple in the toiletry group in Bathroom whatever its category says", () => {
    expect(sectionOf({ category: "Tech", groupId: "toiletry-bag" })).toBe("Bathroom");
  });
});

describe("groupStaples", () => {
  it("shows the four sections in their fixed order under All, empty ones included", () => {
    const views = groupStaples([staple({ category: "Tech" })], "all");
    expect(views.map((view) => view.section)).toEqual([...SECTIONS]);
    expect(views.map((view) => view.staples.length)).toEqual([0, 0, 1, 0]);
  });

  it("under Pack last keeps only Pack last staples and hides sections left empty", () => {
    const views = groupStaples(DEFAULT_STAPLES, "packlast");
    expect(views.map((view) => view.section)).toEqual(["Bathroom", "Tech", "Other essentials"]);
    expect(views.flatMap((view) => view.staples).every((entry) => entry.packLast)).toBe(true);
    expect(
      views.find((view) => view.section === "Other essentials")!.staples.map((s) => s.id),
    ).toEqual(["last-glasses"]);
  });

  it("shows nothing under Pack last when no staple has the flag", () => {
    expect(groupStaples([staple({})], "packlast")).toEqual([]);
  });

  it("keeps the default set's counts per section", () => {
    const counts = Object.fromEntries(
      groupStaples(DEFAULT_STAPLES, "all").map((view) => [view.section, view.staples.length]),
    );
    expect(counts).toEqual({ Clothing: 3, Bathroom: 4, Tech: 2, "Other essentials": 2 });
  });
});

describe("small helpers", () => {
  it("describes each section, and the Bathroom one keeps bag placement separate", () => {
    for (const section of SECTIONS) expect(sectionDescription(section).length).toBeGreaterThan(10);
    expect(sectionDescription("Bathroom")).toContain("bag placement stays a separate confirmation");
  });

  it("counts with the right plural and labels units", () => {
    expect(countLabel(1)).toBe("1 staple");
    expect(countLabel(0)).toBe("0 staples");
    expect(countLabel(3)).toBe("3 staples");
    expect(unitLabel({ qty: 2, cadence: "per day" })).toBe("2 per day");
  });

  it("finds a duplicate name ignoring case and space, but not the staple being edited", () => {
    const list = [staple({ id: "a", name: "Razor" }), staple({ id: "b", name: "Comb" })];
    expect(findDuplicate(list, "  razor ", null)?.id).toBe("a");
    expect(findDuplicate(list, "RAZOR", "a")).toBeUndefined();
    expect(findDuplicate(list, "Brush", null)).toBeUndefined();
    expect(findDuplicate(list, "   ", null)).toBeUndefined();
  });

  it("keeps a staple's stored category when its section is unchanged, else stores the section", () => {
    expect(categoryFor("Nice attire", "Clothing")).toBe("Nice attire");
    expect(categoryFor("Nice attire", "Tech")).toBe("Tech");
    expect(categoryFor(null, "Bathroom")).toBe("Bathroom");
  });

  it("makes unique staple ids that do not depend on the name", () => {
    expect(newStapleId(() => "abc")).toBe("staple-abc");
    expect(newStapleId()).not.toBe(newStapleId());
  });
});
