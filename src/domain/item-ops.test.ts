import { describe, expect, it } from "vitest";
import {
  acceptWeather,
  editItem,
  findIdentityViolations,
  recalculateSuggestions,
  rememberPreview,
  removeTripItem,
  reviewWeatherAgain,
  skipWeather,
  WEATHER_UMBRELLA_ID,
  type ItemEdit,
  type ItemOpResult,
} from "./item-ops";
import { setPacked } from "./readiness";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";
import { calculateSuggestions as suggest } from "./calc";
import type { Staple, Trip, TripConfig, TripItem } from "./trip";

const CONFIG: TripConfig = {
  laundry: false,
  spare: false,
  niceAttire: true,
  occasionCount: 2,
  reuseNice: false,
  returnOutfit: true,
};

const item = (
  id: string,
  name: string,
  category: string,
  qty: number,
  section: TripItem["section"] = "main",
): TripItem => ({
  id,
  name,
  category,
  qty,
  packed: 0,
  section,
});

/** Synthetic trip (fictional dates) shaped like the prototype's makeTrip output. */
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const calculated = suggest({ ...CONFIG, start: "2030-03-01", end: "2030-03-08" });
  const suggested = calculated.items.map((entry): TripItem => {
    const base = item(entry.id, entry.name, entry.category, entry.qty);
    return {
      ...base,
      optional: Boolean(entry.optional),
      ...(entry.id === "nice-makeup" ? { groupId: TOILETRY_GROUP_ID } : {}),
    };
  });
  return {
    id: "trip-a",
    start: "2030-03-01",
    end: "2030-03-08",
    stops: [],
    config: { ...CONFIG },
    days: calculated.days,
    dailyDays: calculated.dailyDays,
    items: [
      ...suggested,
      item("sunglasses", "Sunglasses", "Accessories", 1),
      item("return-top", "Fresh top", "Return outfit", 1, "return"),
      item("return-underwear", "Underwear", "Return outfit", 1, "return"),
      item("last-laptop", "Laptop", "Pack last", 1, "packlast"),
      item("last-chargers", "Chargers", "Pack last", 1, "packlast"),
      {
        ...item("last-toothbrush", "Toothbrush", "Bathroom", 1, "packlast"),
        groupId: TOILETRY_GROUP_ID,
      },
    ],
    suggestionMemory: {},
    suppressedSuggestions: {},
    weather: { status: "pending", label: "Simulated", suggestion: "Compact umbrella" },
    toiletryBagPacked: false,
    ready: false,
    ...overrides,
  };
}

const STAPLES: Staple[] = [
  {
    id: "last-laptop",
    name: "Laptop",
    category: "Tech",
    qty: 1,
    cadence: "per trip",
    packLast: true,
  },
  {
    id: "last-toothbrush",
    name: "Toothbrush",
    category: "Bathroom",
    qty: 1,
    cadence: "per trip",
    packLast: true,
    groupId: TOILETRY_GROUP_ID,
  },
];

/** Reusable identity-invariant check; every operation result below goes through it. */
function checked<T extends Trip>(trip: T): T {
  expect(findIdentityViolations(trip)).toEqual([]);
  return trip;
}

function okTrip<T extends Trip>(result: ItemOpResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return checked(result.trip);
}

const byId = (trip: Trip, id: string) => trip.items.find((entry) => entry.id === id);
const EDIT: ItemEdit = { name: "Renamed", qty: 3, timing: "main", scope: "this-trip" };

/** A fully packed trip with the bag placed and Ready set. */
function readyTrip(): Trip {
  const base = makeTrip({ toiletryBagPacked: true, ready: true });
  return { ...base, items: base.items.map((entry) => ({ ...entry, packed: entry.qty })) };
}

describe("editItem", () => {
  it("this-trip edits change only that trip: staples, other trips, and history are untouched", () => {
    const history = makeTrip({ id: "trip-past" });
    const other = makeTrip({ id: "trip-b" });
    const snapshots = structuredClone([history, other, STAPLES]);
    const result = editItem(makeTrip(), STAPLES, "last-laptop", {
      name: "  Work laptop ",
      qty: 2,
      timing: "main",
      scope: "this-trip",
    });
    const trip = okTrip(result);
    expect(byId(trip, "last-laptop")).toMatchObject({
      name: "Work laptop",
      qty: 2,
      section: "main",
      userEdited: true,
      category: "Pack last",
    });
    expect(result.staples).toBe(STAPLES);
    expect([history, other, STAPLES]).toEqual(snapshots);
  });

  it("remember edits update the matching staple for future trips only", () => {
    const history = makeTrip({ id: "trip-past" });
    const snapshot = structuredClone(history);
    const result = editItem(makeTrip(), STAPLES, "last-laptop", {
      name: "Work laptop",
      qty: 2,
      timing: "main",
      scope: "remember",
    });
    okTrip(result);
    expect(result.staples.find((staple) => staple.id === "last-laptop")).toMatchObject({
      name: "Work laptop",
      qty: 2,
      packLast: false,
      category: "Tech",
      cadence: "per trip",
    });
    expect(result.staples).toHaveLength(STAPLES.length);
    expect(STAPLES[0].name).toBe("Laptop");
    expect(history).toEqual(snapshot);
  });

  describe("remember on a per-day staple stores a per-day amount, never the trip total", () => {
    const perDay: Staple[] = [
      {
        id: "underwear",
        name: "Underwear",
        category: "Clothing",
        qty: 1,
        cadence: "per day",
        packLast: false,
      },
    ];
    const remember = (tripQty: number, dailyDays: number) => {
      const trip = { ...makeTrip(), dailyDays };
      const result = editItem(trip, perDay, "underwear", {
        name: "Underwear",
        qty: tripQty,
        timing: "main",
        scope: "remember",
      });
      okTrip(result);
      return result.staples[0];
    };

    it.each([
      ["12 over 6 days", 12, 6, 2],
      ["exactly one per day", 6, 6, 1],
      ["rounds .5 up", 9, 6, 2],
      ["rounds down below .5", 8, 6, 1],
      ["never below 1", 1, 6, 1],
      ["a one-day trip", 3, 1, 3],
    ])("%s", (_name, tripQty, dailyDays, expected) => {
      expect(remember(tripQty, dailyDays)).toMatchObject({ qty: expected, cadence: "per day" });
    });

    it("leaves the staple quantity unchanged when the trip has no packing days", () => {
      expect(remember(5, 0)).toMatchObject({ qty: 1, cadence: "per day", name: "Underwear" });
    });

    it("still updates name and Pack last when the quantity is left alone", () => {
      const trip = { ...makeTrip(), dailyDays: 0 };
      const result = editItem(trip, perDay, "underwear", {
        name: "Briefs",
        qty: 5,
        timing: "packlast",
        scope: "remember",
      });
      expect(result.staples[0]).toMatchObject({ name: "Briefs", qty: 1, packLast: true });
    });

    it("per-trip staples store the trip quantity as is", () => {
      const result = editItem(makeTrip(), STAPLES, "last-laptop", {
        name: "Laptop",
        qty: 4,
        timing: "packlast",
        scope: "remember",
      });
      expect(result.staples.find((staple) => staple.id === "last-laptop")).toMatchObject({
        qty: 4,
        cadence: "per trip",
      });
    });
  });

  it("remember creates a staple when none exists, carrying category, Pack last, and Bathroom membership", () => {
    const created = editItem(makeTrip(), [], "sunglasses", {
      name: "Sunglasses",
      qty: 1,
      timing: "packlast",
      scope: "remember",
    });
    okTrip(created);
    expect(created.staples).toEqual([
      {
        id: "sunglasses",
        name: "Sunglasses",
        category: "Accessories",
        qty: 1,
        cadence: "per trip",
        packLast: true,
      },
    ]);
    const bathroom = editItem(makeTrip(), [], "last-toothbrush", {
      name: "Toothbrush",
      qty: 1,
      timing: "packlast",
      scope: "remember",
    });
    expect(bathroom.staples[0]).toMatchObject({ groupId: TOILETRY_GROUP_ID, packLast: true });
  });

  it("remember keeps the Bathroom group on an existing Bathroom staple", () => {
    const result = editItem(makeTrip(), STAPLES, "last-toothbrush", {
      name: "Toothbrush",
      qty: 2,
      timing: "packlast",
      scope: "remember",
    });
    expect(result.staples.find((staple) => staple.id === "last-toothbrush")).toMatchObject({
      qty: 2,
      groupId: TOILETRY_GROUP_ID,
    });
  });

  it("remember drops a stale Bathroom group from a staple whose item is no longer in the bag", () => {
    const staples: Staple[] = [
      {
        id: "sunglasses",
        name: "Sunglasses",
        category: "Accessories",
        qty: 1,
        cadence: "per trip",
        packLast: false,
        groupId: TOILETRY_GROUP_ID,
      },
    ];
    const result = editItem(makeTrip(), staples, "sunglasses", { ...EDIT, scope: "remember" });
    expect(result.staples[0]).not.toHaveProperty("groupId");
  });

  it("Pack last is a timing flag: category and identity are unchanged and nothing is duplicated", () => {
    const before = makeTrip();
    const trip = okTrip(
      editItem(before, STAPLES, "sunglasses", {
        ...EDIT,
        name: "Sunglasses",
        qty: 1,
        timing: "packlast",
      }),
    );
    expect(byId(trip, "sunglasses")).toMatchObject({
      section: "packlast",
      category: "Accessories",
    });
    expect(trip.items).toHaveLength(before.items.length);
    const back = okTrip(
      editItem(trip, STAPLES, "sunglasses", {
        ...EDIT,
        name: "Sunglasses",
        qty: 1,
        timing: "main",
      }),
    );
    expect(byId(back, "sunglasses")).toMatchObject({ section: "main", category: "Accessories" });
  });

  it("return-outfit items keep their return timing", () => {
    const trip = okTrip(
      editItem(makeTrip(), STAPLES, "return-top", { ...EDIT, timing: "packlast" }),
    );
    expect(byId(trip, "return-top")?.section).toBe("return");
    const same = okTrip(editItem(makeTrip(), STAPLES, "return-top", { ...EDIT, timing: "return" }));
    expect(byId(same, "return-top")?.section).toBe("return");
  });

  it("revokes Ready, clamps packed to the new quantity, and keeps other progress", () => {
    const trip = okTrip(editItem(readyTrip(), STAPLES, "tops", { ...EDIT, name: "Tops", qty: 2 }));
    expect(trip.ready).toBe(false);
    expect(byId(trip, "tops")).toMatchObject({ qty: 2, packed: 2 });
    expect(byId(trip, "socks")?.packed).toBe(byId(trip, "socks")?.qty);
  });

  it("invalidates toiletry-bag placement when a Bathroom quantity changes", () => {
    const trip = okTrip(
      editItem(readyTrip(), STAPLES, "last-toothbrush", {
        ...EDIT,
        name: "Toothbrush",
        qty: 2,
        timing: "packlast",
      }),
    );
    expect(trip.toiletryBagPacked).toBe(false);
    expect(trip.ready).toBe(false);
  });

  it.each([
    ["unknown item", "nope", EDIT, "ITEM_NOT_FOUND"],
    ["blank name", "tops", { ...EDIT, name: "   " }, "EMPTY_NAME"],
    ["unknown timing", "tops", { ...EDIT, timing: "later" as never }, "INVALID_TIMING"],
    [
      "return timing on a non-return item",
      "tops",
      { ...EDIT, timing: "return" as const },
      "INVALID_TIMING",
    ],
  ])("rejects %s without changing anything", (_name, itemId, edit, reason) => {
    const trip = makeTrip();
    expect(editItem(trip, STAPLES, itemId, edit)).toEqual({
      ok: false,
      reason,
      trip,
      staples: STAPLES,
    });
  });
});

describe("removeTripItem", () => {
  it("removing an optional Nice suggestion suppresses it and forgets its remembered copy", () => {
    const start = makeTrip({
      suggestionMemory: { "nice-shoes": item("nice-shoes", "Dress shoes", "Nice attire", 1) },
    });
    const trip = okTrip(removeTripItem(start, STAPLES, "nice-shoes", "this-trip"));
    expect(byId(trip, "nice-shoes")).toBeUndefined();
    expect(trip.suppressedSuggestions).toEqual({ "nice-shoes": true });
    expect(trip.suggestionMemory).toEqual({});
    expect(trip.ready).toBe(false);
  });

  it("removing an ordinary item does not suppress anything", () => {
    const trip = okTrip(removeTripItem(makeTrip(), STAPLES, "sunglasses", "this-trip"));
    expect(trip.suppressedSuggestions).toEqual({});
    expect(
      removeTripItem(makeTrip(), STAPLES, "tops", "this-trip").trip.suppressedSuggestions,
    ).toEqual({});
  });

  it("suppression needs both the optional flag and a Nice suggestion id", () => {
    const base = makeTrip();
    const memory = {
      custom: item("custom", "Custom", "Other essentials", 1),
      "nice-top": item("nice-top", "Nice-attire top", "Nice attire", 2),
    };
    const withCustom = {
      ...base,
      suggestionMemory: memory,
      items: [
        ...base.items,
        { ...item("custom", "Custom", "Other essentials", 1), optional: true },
      ],
    };
    const customRemoved = okTrip(removeTripItem(withCustom, STAPLES, "custom", "this-trip"));
    expect(customRemoved.suppressedSuggestions).toEqual({});
    expect(customRemoved.suggestionMemory).toEqual(memory);

    const notOptional = {
      ...base,
      suggestionMemory: memory,
      items: base.items.map((entry) =>
        entry.id === "nice-shoes" ? { ...entry, optional: false } : entry,
      ),
    };
    const shoesRemoved = okTrip(removeTripItem(notOptional, STAPLES, "nice-shoes", "this-trip"));
    expect(shoesRemoved.suppressedSuggestions).toEqual({});
    expect(shoesRemoved.suggestionMemory).toEqual(memory);

    const optionalShoes = okTrip(
      removeTripItem({ ...base, suggestionMemory: memory }, STAPLES, "nice-shoes", "this-trip"),
    );
    expect(optionalShoes.suppressedSuggestions).toEqual({ "nice-shoes": true });
    expect(optionalShoes.suggestionMemory).toEqual(memory);
  });

  it("this-trip leaves staples alone; remember also removes the staple", () => {
    const local = removeTripItem(makeTrip(), STAPLES, "last-laptop", "this-trip");
    expect(local.staples).toBe(STAPLES);
    const remembered = removeTripItem(makeTrip(), STAPLES, "last-laptop", "remember");
    expect(remembered.staples.map((staple) => staple.id)).toEqual(["last-toothbrush"]);
    expect(STAPLES).toHaveLength(2);
  });

  it("removing a Bathroom item invalidates bag placement and Ready", () => {
    const trip = okTrip(removeTripItem(readyTrip(), STAPLES, "last-toothbrush", "this-trip"));
    expect(trip.toiletryBagPacked).toBe(false);
    expect(trip.ready).toBe(false);
  });

  it("rejects an unknown item", () => {
    const trip = makeTrip();
    expect(removeTripItem(trip, STAPLES, "nope", "this-trip")).toEqual({
      ok: false,
      reason: "ITEM_NOT_FOUND",
      trip,
      staples: STAPLES,
    });
  });
});

describe("recalculateSuggestions", () => {
  const nicePicks = (trip: Trip) =>
    trip.items
      .filter((entry) => entry.id.startsWith("nice-"))
      .map(({ id, name, qty, packed, userEdited }) => ({
        id,
        name,
        qty,
        packed,
        userEdited: Boolean(userEdited),
      }));

  it("Nice outfits off → on → off → on preserves edits and progress exactly", () => {
    let trip = makeTrip();
    trip = okTrip(
      editItem(trip, STAPLES, "nice-shoes", {
        name: "Black dress shoes",
        qty: 1,
        timing: "packlast",
        scope: "this-trip",
      }),
    );
    trip = setPacked(trip, "nice-shoes", 1).trip;
    trip = setPacked(trip, "nice-top", 1).trip;
    const before = nicePicks(trip);
    expect(before).toHaveLength(5);

    const off = checked(recalculateSuggestions(trip, { ...CONFIG, niceAttire: false }, suggest));
    expect(nicePicks(off)).toEqual([]);
    expect(Object.keys(off.suggestionMemory)).toEqual(
      expect.arrayContaining(["nice-shoes", "nice-top"]),
    );

    const on = checked(recalculateSuggestions(off, CONFIG, suggest));
    expect(nicePicks(on)).toEqual(before);
    expect(byId(on, "nice-shoes")).toMatchObject({ section: "packlast", optional: true });

    const offAgain = checked(recalculateSuggestions(on, { ...CONFIG, niceAttire: false }, suggest));
    expect(nicePicks(offAgain)).toEqual([]);
    const onAgain = checked(recalculateSuggestions(offAgain, CONFIG, suggest));
    expect(nicePicks(onAgain)).toEqual(before);
  });

  it("turning Nice outfits on for the first time adds fresh calculated suggestions", () => {
    const plain = checked(
      recalculateSuggestions(makeTrip(), { ...CONFIG, niceAttire: false }, suggest),
    );
    const fresh = { ...plain, suggestionMemory: {} };
    const on = checked(recalculateSuggestions(fresh, CONFIG, suggest));
    expect(byId(on, "nice-top")).toMatchObject({ qty: 2, packed: 0, section: "main" });
    expect(byId(on, "nice-makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
  });

  it("a non-edited item restored from memory keeps its remembered qty and progress, not the new calculation", () => {
    const three = { ...CONFIG, occasionCount: 3 };
    let trip = checked(recalculateSuggestions(makeTrip(), three, suggest));
    trip = setPacked(trip, "nice-top", 2).trip;
    expect(byId(trip, "nice-top")).toMatchObject({ qty: 3, packed: 2 });
    expect(byId(trip, "nice-top")?.userEdited).toBeUndefined();

    const off = checked(recalculateSuggestions(trip, { ...three, niceAttire: false }, suggest));
    expect(byId(off, "nice-top")).toBeUndefined();

    const five = checked(recalculateSuggestions(off, { ...three, occasionCount: 5 }, suggest));
    expect(byId(five, "nice-top")).toMatchObject({ qty: 3, packed: 2, userEdited: false });
    // An item that stayed on the list takes the new calculation instead.
    expect(byId(five, "nice-bottom")?.qty).toBe(3);
    const stayed = checked(recalculateSuggestions(trip, { ...three, occasionCount: 5 }, suggest));
    expect(byId(stayed, "nice-top")).toMatchObject({ qty: 5, packed: 2 });
  });

  it("an explicitly removed optional suggestion stays suppressed across recalculation and toggling", () => {
    let trip = okTrip(removeTripItem(makeTrip(), STAPLES, "nice-shoes", "this-trip"));
    trip = checked(recalculateSuggestions(trip, CONFIG, suggest));
    expect(byId(trip, "nice-shoes")).toBeUndefined();
    trip = checked(recalculateSuggestions(trip, { ...CONFIG, niceAttire: false }, suggest));
    trip = checked(recalculateSuggestions(trip, CONFIG, suggest));
    expect(byId(trip, "nice-shoes")).toBeUndefined();
    expect(byId(trip, "nice-top")).toBeDefined();
    expect(trip.suggestionMemory).not.toHaveProperty("nice-shoes");
  });

  it.each([
    ["Makeup", "Make-up bag", "nice-makeup"],
    ["Dress shoes", "Dress shoes (black)", "nice-shoes"],
    ["Dress-specific undergarments", "Dress undergarments", "nice-undergarments"],
  ])(
    "an equivalent %s staple prevents a duplicate suggested row",
    (_label, stapleName, suggestionId) => {
      const base = makeTrip();
      const withoutSuggestion = {
        ...base,
        items: base.items.filter((entry) => entry.id !== suggestionId),
      };
      const staple = {
        ...item("staple-equivalent", stapleName, "Other", 1),
        ...(suggestionId === "nice-makeup" ? { groupId: TOILETRY_GROUP_ID } : {}),
      };
      const trip = checked(
        recalculateSuggestions(
          { ...withoutSuggestion, items: [...withoutSuggestion.items, staple] },
          CONFIG,
          suggest,
        ),
      );
      expect(byId(trip, suggestionId)).toBeUndefined();
      expect(byId(trip, "staple-equivalent")).toBeDefined();
    },
  );

  it("merges unedited items with the new calculation and edited items with the user's values", () => {
    let trip = okTrip(
      editItem(makeTrip(), STAPLES, "sleepwear", {
        name: "Pajamas",
        qty: 2,
        timing: "main",
        scope: "this-trip",
      }),
    );
    trip = setPacked(trip, "tops", 3).trip;
    const next = checked(recalculateSuggestions(trip, { ...CONFIG, laundry: true }, suggest));
    expect(byId(next, "tops")).toMatchObject({ qty: 2, packed: 2 });
    expect(byId(next, "sleepwear")).toMatchObject({ name: "Pajamas", qty: 2, userEdited: true });
    expect(next.config.laundry).toBe(true);
    expect(trip.config.laundry).toBe(false);
  });

  it("updates days and dailyDays and keeps non-calculated items", () => {
    const trip = makeTrip();
    const next = checked(recalculateSuggestions({ ...trip, end: "2030-03-04" }, CONFIG, suggest));
    expect(next).toMatchObject({ days: 4, dailyDays: 2 });
    for (const id of [
      "sunglasses",
      "return-top",
      "last-laptop",
      "last-chargers",
      "last-toothbrush",
    ]) {
      expect(byId(next, id)).toBeDefined();
    }
  });

  it("keeps the Makeup row in the Bathroom group and preserves a source group on other items", () => {
    const base = makeTrip();
    const grouped = {
      ...base,
      items: base.items.map((entry) =>
        entry.id === "tops"
          ? { ...entry, groupId: "custom-group" }
          : { ...entry, groupId: entry.id === "nice-makeup" ? "other" : entry.groupId },
      ),
    };
    const next = checked(recalculateSuggestions(grouped, CONFIG, suggest));
    expect(byId(next, "nice-makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(byId(next, "tops")?.groupId).toBe("custom-group");
    expect(byId(next, "socks")).not.toHaveProperty("groupId");
  });

  it("keeps optional when only the remembered copy marked it optional", () => {
    const base = makeTrip();
    const trip: Trip = {
      ...base,
      items: base.items.filter((entry) => entry.id !== "tops"),
      suggestionMemory: {
        tops: { ...item("tops", "Everyday tops", "Clothes", 4), optional: true },
      },
    };
    expect(byId(recalculateSuggestions(trip, CONFIG, suggest), "tops")?.optional).toBe(true);
  });

  it("revokes Ready and keeps the bag when the Bathroom contents are unchanged", () => {
    const next = checked(
      recalculateSuggestions(readyTrip(), { ...CONFIG, laundry: true }, suggest),
    );
    expect(next.ready).toBe(false);
    expect(next.toiletryBagPacked).toBe(true);
  });

  it("invalidates bag placement when recalculation changes the Bathroom contents", () => {
    const off = checked(
      recalculateSuggestions(readyTrip(), { ...CONFIG, niceAttire: false }, suggest),
    );
    expect(off.toiletryBagPacked).toBe(false);
    expect(off.ready).toBe(false);
    expect(byId(off, "nice-makeup")).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const trip = makeTrip();
    const snapshot = structuredClone(trip);
    recalculateSuggestions(trip, { ...CONFIG, niceAttire: false }, suggest);
    expect(trip).toEqual(snapshot);
  });
});

describe("weather suggestion (simulated)", () => {
  const umbrellas = (trip: Trip) => trip.items.filter((entry) => entry.id === WEATHER_UMBRELLA_ID);

  it("accept adds exactly one canonical umbrella and revokes Ready", () => {
    const accepted = checked(acceptWeather(readyTrip()));
    expect(umbrellas(accepted)).toHaveLength(1);
    expect(umbrellas(accepted)[0]).toMatchObject({
      name: "Compact umbrella",
      qty: 1,
      packed: 0,
      category: "Weather suggestion",
    });
    expect(accepted.weather.status).toBe("accepted");
    expect(accepted.ready).toBe(false);
    expect(accepted.toiletryBagPacked).toBe(true);
    expect(acceptWeather(accepted)).toBe(accepted);
  });

  it("skip adds nothing and leaves Ready alone; review again returns to pending", () => {
    const start = readyTrip();
    const skipped = skipWeather(start);
    expect(skipped.weather.status).toBe("skipped");
    expect(skipped.items).toBe(start.items);
    expect(skipped.ready).toBe(true);
    expect(skipWeather(skipped)).toBe(skipped);
    const pending = reviewWeatherAgain(skipped);
    expect(pending.weather.status).toBe("pending");
    expect(pending.items).toBe(start.items);
    expect(reviewWeatherAgain(pending)).toBe(pending);
  });

  it("accepting after a skip works, and re-accepting after reviewing again never adds a second umbrella", () => {
    const accepted = acceptWeather(skipWeather(makeTrip()));
    expect(umbrellas(accepted)).toHaveLength(1);
    const reviewed = reviewWeatherAgain(accepted);
    expect(umbrellas(reviewed)).toHaveLength(1);
    const reaccepted = checked(acceptWeather({ ...reviewed, ready: true }));
    expect(umbrellas(reaccepted)).toHaveLength(1);
    expect(reaccepted.weather.status).toBe("accepted");
    expect(reaccepted.ready).toBe(false);
  });
});

describe("findIdentityViolations", () => {
  const trip = (...items: TripItem[]) => ({ items });

  it("accepts a well-formed trip", () => {
    expect(findIdentityViolations(makeTrip())).toEqual([]);
  });

  it.each([
    ["duplicate id", trip(item("a", "One", "x", 1), item("a", "Two", "x", 1)), "duplicate id: a"],
    [
      "duplicate Bathroom item",
      trip(
        { ...item("b1", "Toothbrush", "Bathroom", 1), groupId: TOILETRY_GROUP_ID },
        { ...item("b2", " toothbrush", "Bathroom", 1), groupId: TOILETRY_GROUP_ID },
      ),
      "duplicate Bathroom item: toothbrush",
    ],
    [
      "duplicate Pack last item",
      trip(
        item("p1", "Laptop", "Pack last", 1, "packlast"),
        item("p2", "Laptop", "Pack last", 1, "packlast"),
      ),
      "duplicate Pack last item: laptop",
    ],
    [
      "duplicate Nice accessory",
      trip(item("m1", "Makeup", "Bathroom", 1), item("m2", "Make-up kit", "Bathroom", 1)),
      "duplicate Nice accessory: makeup",
    ],
    [
      "split Chargers",
      trip(item("c1", "Phone charger", "Tech", 1), item("c2", "Chargers", "Tech", 1)),
      "split Chargers",
    ],
  ])("flags %s", (_name, input, violation) => {
    expect(findIdentityViolations(input)).toEqual([violation]);
  });

  it("allows the same name in different roles (everyday vs return underwear, Bathroom vs Pack last)", () => {
    expect(
      findIdentityViolations(
        trip(
          item("underwear", "Underwear", "Clothes", 6),
          item("return-underwear", "Underwear", "Return outfit", 1, "return"),
        ),
      ),
    ).toEqual([]);
  });
});

describe("rememberPreview", () => {
  const perDay = (id: string, qty = 1): Staple => ({
    id,
    name: id,
    qty,
    cadence: "per day",
    category: "Clothing",
    packLast: false,
  });
  const perTrip = (id: string): Staple => ({
    id,
    name: id,
    qty: 1,
    cadence: "per trip",
    category: "Clothing",
    packLast: false,
  });

  it("previews the per-day amount a remembered edit would save (the same rounding the edit uses)", () => {
    expect(rememberPreview([perDay("socks")], "socks", 6, 3)).toEqual({
      kind: "per-day",
      perDay: 2,
    });
    expect(rememberPreview([perDay("socks")], "socks", 7, 3)).toEqual({
      kind: "per-day",
      perDay: 2,
    });
    expect(rememberPreview([perDay("socks")], "socks", 8, 3)).toEqual({
      kind: "per-day",
      perDay: 3,
    });
    expect(rememberPreview([perDay("socks")], "socks", 1, 5)).toEqual({
      kind: "per-day",
      perDay: 1,
    });
  });

  it("says the saved quantity stays the same when the trip has no packing days", () => {
    expect(rememberPreview([perDay("socks", 2)], "socks", 4, 0)).toEqual({
      kind: "no-packing-days",
    });
  });

  it("has nothing to preview for a per-trip staple, an item with no staple, or an unknown id", () => {
    expect(rememberPreview([perTrip("laptop")], "laptop", 2, 3)).toBeNull();
    expect(rememberPreview([perDay("socks")], "nothing", 2, 3)).toBeNull();
    expect(rememberPreview([], "socks", 2, 3)).toBeNull();
  });

  it("agrees with what editItem actually stores", () => {
    const trip = makeTrip();
    const staples = [perDay(trip.items[0].id, 1)];
    for (const qty of [1, 3, 4, 7, 10]) {
      const preview = rememberPreview(staples, trip.items[0].id, qty, trip.dailyDays);
      const edited = editItem(trip, staples, trip.items[0].id, {
        name: trip.items[0].name,
        qty,
        timing: trip.items[0].section,
        scope: "remember",
      });
      expect(edited.ok).toBe(true);
      if (edited.ok && preview?.kind === "per-day")
        expect(edited.staples.find((entry) => entry.id === trip.items[0].id)?.qty).toBe(
          preview.perDay,
        );
    }
  });
});
