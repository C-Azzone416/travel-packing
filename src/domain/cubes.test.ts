import { describe, expect, it } from "vitest";
import {
  CUBES,
  CUBE_LABELS,
  DEFAULT_MORNING_OF_CUBES,
  canCarryLaundryFlag,
  cubeForItem,
  isCube,
  itemCube,
  morningOfCubesFor,
  weatherCubeLabel,
  type Cube,
} from "./cubes";

describe("category -> cube mapping (#378)", () => {
  it.each<[string, string, string, Cube]>([
    ["tops", "Everyday tops", "Clothing", "clothing"],
    ["nice-top", "Nice-attire top", "Nice attire", "clothing"],
    ["return-top", "Fresh top", "Return outfit", "clothing"],
    ["razor", "Razor", "Bathroom", "toiletries"],
    ["razor", "Razor", "Toiletries", "toiletries"],
    ["laptop", "Laptop", "Tech", "tech"],
    ["travel-documents", "Travel documents", "Other essentials", "documents"],
    ["passport", "Passport", "Other essentials", "documents"],
    ["x", "Driving licence", "Other essentials", "documents"],
    ["x", "Driver license", "Other essentials", "documents"],
    ["id-card", "ID", "Other essentials", "documents"],
    ["sunglasses", "Sunglasses", "Other essentials", "misc"],
    ["last-glasses", "Everyday glasses", "Other essentials", "misc"],
    ["neck-pillow", "Neck pillow", "Other essentials", "misc"],
    ["scarf", "Scarf", "Accessories", "misc"],
    ["x", "Compact umbrella", "Weather suggestion", "weather"],
    ["chargers", "Chargers", "Pack last", "tech"],
    ["boarding-pass", "Boarding pass", "Pack last", "documents"],
    ["keys", "House keys", "Pack last", "misc"],
    ["mystery", "Mystery", "Something else", "misc"],
  ])("%s (%s, %s) -> %s", (id, name, category, cube) => {
    expect(cubeForItem({ id, name, category })).toBe(cube);
  });

  it("puts toiletry-bag contents in Toiletries whatever the category", () => {
    expect(cubeForItem({ id: "x", category: "Other essentials", groupId: "toiletry-bag" })).toBe(
      "toiletries",
    );
    expect(
      cubeForItem({ id: "weather-sunscreen", category: "Bathroom", groupId: "toiletry-bag" }),
    ).toBe("toiletries");
  });

  it("puts weather identities (and their legacy aliases) in the weather cube whatever the category", () => {
    for (const id of [
      "weather-rain-jacket",
      "rain-jacket",
      "umbrella",
      "sun-hat",
      "swimsuit",
      "snow-boots",
      "sunscreen",
    ]) {
      expect(cubeForItem({ id, category: "Clothing" }), id).toBe("weather");
    }
  });

  it("matches words, not substrings, for ID", () => {
    expect(cubeForItem({ id: "tidy-kit", category: "Other essentials" })).toBe("misc");
    expect(cubeForItem({ id: "x", name: "Photo ID", category: "Other essentials" })).toBe(
      "documents",
    );
  });

  it("lists exactly the six cubes, each with a label", () => {
    expect(CUBES).toEqual(["clothing", "toiletries", "tech", "documents", "misc", "weather"]);
    for (const cube of CUBES) expect(CUBE_LABELS[cube]).toBeTruthy();
  });

  it("uses the cube an item was given, else the one its category implies", () => {
    expect(itemCube({ id: "tops", category: "Clothing" })).toBe("clothing");
    expect(itemCube({ id: "tops", category: "Clothing", cube: "misc" })).toBe("misc");
  });

  it("validates cube names", () => {
    expect(isCube("tech")).toBe(true);
    expect(isCube("Tech")).toBe(false);
    expect(isCube(3)).toBe(false);
  });
});

describe("laundry flag eligibility", () => {
  it("underwear and socks can never carry it", () => {
    expect(canCarryLaundryFlag("underwear")).toBe(false);
    expect(canCarryLaundryFlag("socks")).toBe(false);
    expect(canCarryLaundryFlag("tops")).toBe(true);
    expect(canCarryLaundryFlag("medicine")).toBe(true);
  });
});

describe("weatherCubeLabel", () => {
  it.each([
    [["weather-umbrella"], "Rain gear"],
    [["rain-jacket"], "Rain gear"],
    [["weather-snow-boots"], "Snow gear"],
    [["weather-sunscreen", "weather-swimsuit"], "Sun gear"],
    [["weather-sun-hat"], "Sun gear"],
    [["tops"], "Weather gear"],
    [[], "Weather gear"],
  ])("%j -> %s", (ids, label) => {
    expect(weatherCubeLabel(ids)).toBe(label);
  });
});

describe("morningOfCubesFor", () => {
  const item = (id: string, category: string, section: string, cube?: Cube) => ({
    id,
    category,
    section,
    ...(cube ? { cube } : {}),
  });

  it("defaults to Toiletries", () => {
    expect(DEFAULT_MORNING_OF_CUBES).toEqual(["toiletries"]);
    expect(morningOfCubesFor([item("tops", "Clothing", "main")])).toEqual(["toiletries"]);
  });

  it("flags the cube of every Pack last item, in cube order", () => {
    expect(
      morningOfCubesFor([
        item("last-glasses", "Other essentials", "packlast"),
        item("last-laptop", "Tech", "packlast"),
        item("tops", "Clothing", "main"),
      ]),
    ).toEqual(["toiletries", "tech", "misc"]);
  });

  it("uses the cube a Pack last item was moved to", () => {
    expect(morningOfCubesFor([item("last-laptop", "Tech", "packlast", "documents")])).toEqual([
      "toiletries",
      "documents",
    ]);
  });

  it("honours saved flags, including Toiletries turned off", () => {
    expect(morningOfCubesFor([], ["tech"])).toEqual(["tech"]);
    expect(morningOfCubesFor([], [])).toEqual([]);
  });
});
