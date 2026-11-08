import { describe, expect, it } from "vitest";
import { SYNTHETIC_STAPLES } from "@/domain/calc";
import type { Staple } from "@/domain/trip";
import {
  categoryFor,
  findDuplicate,
  newStapleId,
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

  it("keeps category independent from toiletry-bag placement", () => {
    expect(sectionOf({ category: "Tech", groupId: "toiletry-bag" })).toBe("Tech");
  });
});

describe("small helpers", () => {
  it("labels units", () => {
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
