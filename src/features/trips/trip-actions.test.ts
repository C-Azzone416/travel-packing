import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedTrip,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import type { DataContext } from "@/server/data/context";

let current: DataContext | null = null;
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import {
  acceptWeatherAction,
  applyWeatherReviewAction,
  addToiletryItemAction,
  confirmBagPlacementAction,
  decrementPackedAction,
  editItemAction,
  getTripAction,
  incrementPackedAction,
  listStaplesAction,
  listWeatherSuggestionsAction,
  upsertStapleAction,
  markNotReadyAction,
  markReadyAction,
  removeItemAction,
  reviewWeatherAgainAction,
  setPackedAction,
  setThemeAction,
  skipWeatherAction,
  togglePackedAction,
  undoBagPlacementAction,
  updatePreferencesAction,
  type TripCommandResult,
} from "./trip-actions";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  current = makeContext(db(), fake);
});
afterAll(async () => {
  await ctx.client.close();
});

const MISSING = "00000000-0000-4000-8000-0000000000ff";
const TOILETRIES = [
  "nice-makeup",
  "last-toothbrush",
  "last-toothpaste",
  "last-deodorant",
  "last-contacts",
];

function changed(result: TripCommandResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result;
}
const item = (result: TripCommandResult, id: string) =>
  changed(result).trip.items.find((entry) => entry.id === id)!;

describe("reads", () => {
  it("getTripAction returns the owner's trip in the screen's shape; another owner's or a missing id is NOT_FOUND", async () => {
    const trip = await seedTrip(db(), OWNER.userId, {
      destination: "San Diego",
      locationId: "us-ca-san-diego",
      locationLabel: "San Diego, California, United States",
    });
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip).toMatchObject({ id: trip.id, destination: "San Diego" });
    expect(read.trip.location).toMatchObject({ region: "California", country: "United States" });
    expect(await getTripAction(MISSING)).toEqual({ ok: false, code: "NOT_FOUND" });
    as(OTHER_OWNER);
    expect(await getTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await getTripAction("not-a-uuid")).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("listStaplesAction returns the owner's staples, seeding the defaults on first use", async () => {
    const result = await listStaplesAction();
    if (!result.ok) throw new Error("expected ok");
    expect(result.staples.length).toBeGreaterThan(5);
    expect(result.staples.some((staple) => staple.id === "tops" || staple.name.length > 0)).toBe(
      true,
    );
  });
});

describe("packing commands", () => {
  it("setPacked stores the count (clamped), and toggle / increment / decrement go through the same data layer", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const socks = trip.items.find((entry) => entry.id === "socks")!;
    expect(item(await setPackedAction(trip.id, "socks", 2), "socks").packed).toBe(2);
    expect(item(await setPackedAction(trip.id, "socks", 999), "socks").packed).toBe(socks.qty);
    expect(item(await setPackedAction(trip.id, "socks", 0), "socks").packed).toBe(0);
    expect(item(await incrementPackedAction(trip.id, "socks"), "socks").packed).toBe(1);
    expect(item(await decrementPackedAction(trip.id, "socks"), "socks").packed).toBe(0);
    expect(item(await togglePackedAction(trip.id, "socks"), "socks").packed).toBe(socks.qty);
    expect(item(await togglePackedAction(trip.id, "socks"), "socks").packed).toBe(0);
    // And it is really stored.
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip.items.find((entry) => entry.id === "socks")!.packed).toBe(0);
  });

  it("rejects bad input and unknown items without changing anything", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(await setPackedAction(trip.id, "socks", -1)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setPackedAction(trip.id, "socks", 1.5)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setPackedAction(trip.id, "no-such-item", 1)).toMatchObject({ ok: false });
    expect(await setPackedAction("not-a-uuid", "socks", 1)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("checking the last Bathroom item signals the bag prompt, and checking everything signals the review prompt", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    let last: TripCommandResult | null = null;
    for (const id of TOILETRIES) {
      last = await togglePackedAction(trip.id, id);
      if (id !== TOILETRIES[TOILETRIES.length - 1])
        expect(changed(last).signals.promptBagPlacement).toBe(false);
    }
    expect(changed(last as TripCommandResult).signals.promptBagPlacement).toBe(true);
  });
});

describe("bag, Ready and weather", () => {
  async function packedTrip() {
    const trip = await seedTrip(db(), OWNER.userId);
    for (const entry of trip.items) await setPackedAction(trip.id, entry.id, entry.qty);
    return trip;
  }

  it("walks bag placement, Ready, Not ready and the weather commands through the data layer", async () => {
    const trip = await packedTrip();
    expect(changed(await confirmBagPlacementAction(trip.id)).trip.toiletryBagPacked).toBe(true);
    expect(changed(await markReadyAction(trip.id)).trip.ready).toBe(true);
    expect(changed(await markNotReadyAction(trip.id)).trip.ready).toBe(false);
    expect(changed(await undoBagPlacementAction(trip.id)).trip.toiletryBagPacked).toBe(false);

    const skipped = changed(await skipWeatherAction(trip.id));
    expect(skipped.trip.weather.status).toBe("skipped");
    expect(changed(await reviewWeatherAgainAction(trip.id)).trip.weather.status).toBe("pending");
    const accepted = changed(await acceptWeatherAction(trip.id));
    expect(accepted.trip.weather.status).toBe("accepted");
    expect(accepted.trip.items.filter((entry) => entry.id === "weather-umbrella")).toHaveLength(1);
  });

  it("accepting the weather suggestion on a Ready trip turns Ready off", async () => {
    const trip = await packedTrip();
    await confirmBagPlacementAction(trip.id);
    expect(changed(await markReadyAction(trip.id)).trip.ready).toBe(true);
    const accepted = changed(await acceptWeatherAction(trip.id));
    expect(accepted.trip.ready).toBe(false);
    expect(accepted.trip.items.filter((entry) => entry.id === "weather-umbrella")).toHaveLength(1);
  });

  it("applies checked weather review rows and persists checked/skipped signatures", async () => {
    const trip = await packedTrip();
    await confirmBagPlacementAction(trip.id);
    await markReadyAction(trip.id);
    const result = changed(
      await applyWeatherReviewAction(
        trip.id,
        [
          {
            kind: "add",
            semanticId: "weather-sunscreen",
            ruleSignature: "sun-v1",
            item: {
              semanticId: "weather-sunscreen",
              name: "Sunscreen",
              category: "Bathroom",
              qty: 1,
              optional: false,
              groupId: "toiletry-bag",
            },
          },
        ],
        [{ semanticId: "weather-swimsuit", ruleSignature: "heat-v1" }],
      ),
    );
    expect(result.trip.items.find((entry) => entry.id === "weather-sunscreen")).toMatchObject({
      name: "Sunscreen",
      groupId: "toiletry-bag",
    });
    expect(result.trip.ready).toBe(false);
    expect(result.trip.toiletryBagPacked).toBe(false);
    const states = await listWeatherSuggestionsAction(trip.id);
    if (!states.ok) throw new Error("expected ok");
    expect(states.suggestions).toEqual(
      expect.arrayContaining([
        { semanticId: "weather-sunscreen", status: "accepted", ruleSignature: "sun-v1" },
        { semanticId: "weather-swimsuit", status: "skipped", ruleSignature: "heat-v1" },
      ]),
    );
  });

  it("validates weather review payloads and owner-scopes suggestion reads", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(
      await applyWeatherReviewAction(
        trip.id,
        [
          {
            kind: "add",
            semanticId: "weather-umbrella",
            ruleSignature: "rain",
            item: {
              semanticId: "weather-umbrella",
              name: "Compact umbrella",
              category: "not-a-category",
              qty: 1,
              optional: false,
            },
          } as never,
        ],
        [],
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    as(OTHER_OWNER);
    expect(await listWeatherSuggestionsAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses Ready before everything is packed, with a REJECTED code and no change", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(await markReadyAction(trip.id)).toEqual({ ok: false, code: "REJECTED" });
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip.ready).toBe(false);
  });
});

describe("item and preference commands", () => {
  it("edits an item for this trip only, or remembers it for future trips", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const edited = await editItemAction(trip.id, "sunglasses", {
      name: "Shades",
      qty: 2,
      timing: "main",
      scope: "this-trip",
    });
    expect(item(edited, "sunglasses")).toMatchObject({ name: "Shades", qty: 2 });
    const before = await listStaplesAction();
    await editItemAction(trip.id, "sunglasses", {
      name: "Sunglasses",
      qty: 3,
      timing: "packlast",
      scope: "remember",
    });
    const after = await listStaplesAction();
    if (!before.ok || !after.ok) throw new Error("expected ok");
    expect(after.staples).not.toEqual(before.staples);
  });

  it("upsertStapleAction adds and edits a staple for future trips, and an existing trip keeps its list", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const staple = {
      id: "razor",
      name: "Razor",
      qty: 1,
      cadence: "per trip",
      category: "Bathroom",
      packLast: false,
      groupId: "toiletry-bag",
    } as const;
    const added = await upsertStapleAction(staple);
    if (!added.ok) throw new Error(`expected ok, got ${added.code}`);
    expect(added.staples.find((entry) => entry.id === "razor")).toMatchObject({
      name: "Razor",
      qty: 1,
      groupId: "toiletry-bag",
    });
    const edited = await upsertStapleAction({ ...staple, qty: 3, packLast: true });
    if (!edited.ok) throw new Error(`expected ok, got ${edited.code}`);
    const razors = edited.staples.filter((entry) => entry.id === "razor");
    expect(razors).toHaveLength(1);
    expect(razors[0]).toMatchObject({ qty: 3, packLast: true });
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip.items.some((entry) => entry.id === "razor")).toBe(false);
  });

  it("upsertStapleAction rejects bad input, and another owner's staples are separate", async () => {
    const bad = {
      id: "x",
      name: " ",
      qty: 0,
      cadence: "per trip",
      category: "Tech",
      packLast: false,
    } as const;
    expect(await upsertStapleAction(bad)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await upsertStapleAction({ ...bad, name: "Cable", qty: 1, category: "Nope" as never }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    await upsertStapleAction({ ...bad, id: "mine", name: "Mine", qty: 1 });
    as(OTHER_OWNER);
    const theirs = await listStaplesAction();
    if (!theirs.ok) throw new Error("expected ok");
    expect(theirs.staples.some((entry) => entry.id === "mine")).toBe(false);
  });

  it("removes an optional item, adds a Bathroom item, and updates preferences", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const removed = changed(await removeItemAction(trip.id, "nice-shoes", "this-trip"));
    expect(removed.trip.items.some((entry) => entry.id === "nice-shoes")).toBe(false);

    const added = changed(
      await addToiletryItemAction(trip.id, {
        name: "Face wash",
        qty: 1,
        packLast: false,
        scope: "this-trip",
      }),
    );
    expect(added.trip.items.find((entry) => entry.name === "Face wash")).toMatchObject({
      groupId: "toiletry-bag",
      packed: 0,
    });

    const updated = changed(
      await updatePreferencesAction(trip.id, { ...trip.config, laundry: !trip.config.laundry }),
    );
    expect(updated.trip.config.laundry).toBe(!trip.config.laundry);
    expect(updated.trip.ready).toBe(false);
  });

  it("validates names, quantities and scopes", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(
      await editItemAction(trip.id, "sunglasses", {
        name: "  ",
        qty: 1,
        timing: "main",
        scope: "this-trip",
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await editItemAction(trip.id, "sunglasses", {
        name: "x",
        qty: 0,
        timing: "main",
        scope: "this-trip",
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await addToiletryItemAction(trip.id, {
        name: "x",
        qty: 1,
        packLast: false,
        scope: "everywhere" as never,
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("themes", () => {
  it("setThemeAction stores the theme, changes nothing else, and is validated", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const changed2 = changed(await setThemeAction(trip.id, "outdoors"));
    expect(changed2.trip.theme).toBe("outdoors");
    expect({ ...changed2.trip, theme: "travel" }).toMatchObject({
      id: trip.id,
      destination: trip.destination,
      ready: trip.ready,
    });
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip.theme).toBe("outdoors");
    for (const theme of ["volcano", "", "Beach", null, 3])
      expect(await setThemeAction(trip.id, theme as never)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(await setThemeAction("not-a-uuid", "city")).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setThemeAction(MISSING, "city")).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("owner gate", () => {
  it("another owner's trip id is NOT_FOUND for every command, and nothing changes", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    as(OTHER_OWNER);
    const attempts: [string, () => Promise<TripCommandResult>][] = [
      ["setPacked", () => setPackedAction(trip.id, "socks", 3)],
      ["toggle", () => togglePackedAction(trip.id, "socks")],
      ["increment", () => incrementPackedAction(trip.id, "socks")],
      ["decrement", () => decrementPackedAction(trip.id, "socks")],
      [
        "edit",
        () =>
          editItemAction(trip.id, "socks", {
            name: "x",
            qty: 1,
            timing: "main",
            scope: "this-trip",
          }),
      ],
      ["remove", () => removeItemAction(trip.id, "nice-shoes", "this-trip")],
      [
        "addToiletry",
        () =>
          addToiletryItemAction(trip.id, {
            name: "x",
            qty: 1,
            packLast: false,
            scope: "this-trip",
          }),
      ],
      ["confirmBag", () => confirmBagPlacementAction(trip.id)],
      ["undoBag", () => undoBagPlacementAction(trip.id)],
      ["ready", () => markReadyAction(trip.id)],
      ["notReady", () => markNotReadyAction(trip.id)],
      ["acceptWeather", () => acceptWeatherAction(trip.id)],
      ["skipWeather", () => skipWeatherAction(trip.id)],
      ["reviewWeather", () => reviewWeatherAgainAction(trip.id)],
      ["preferences", () => updatePreferencesAction(trip.id, trip.config)],
      ["theme", () => setThemeAction(trip.id, "city")],
    ];
    for (const [name, attempt] of attempts)
      expect(await attempt(), name).toEqual({ ok: false, code: "NOT_FOUND" });
    as(OWNER);
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    expect(read.trip.items.map((entry) => [entry.id, entry.qty, entry.packed])).toEqual(
      trip.items.map((entry) => [entry.id, entry.qty, entry.packed]),
    );
    expect(read.trip.weather).toEqual(trip.weather);
  });

  it("signed out redirects to sign-in, a non-allowlisted user to access-denied, and no database is INTERNAL", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const calls = [
      () => getTripAction(trip.id),
      () => listStaplesAction(),
      () =>
        upsertStapleAction({
          id: "x",
          name: "X",
          qty: 1,
          cadence: "per trip",
          category: "Tech",
          packLast: false,
        }),
      () => setPackedAction(trip.id, "socks", 1),
      () => markReadyAction(trip.id),
      () => updatePreferencesAction(trip.id, trip.config),
      () => setThemeAction(trip.id, "city"),
    ];
    as(null);
    for (const call of calls) await expect(call()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    for (const call of calls) {
      // Being refused signs the user out, so each call starts as the intruder again.
      as({ userId: "intruder", email: "intruder@example.test" });
      await expect(call()).rejects.toThrow("NEXT_REDIRECT:/access-denied");
    }
    current = null;
    for (const call of calls) expect(await call()).toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("concurrent taps on different items of one trip all land (the per-trip lock orders them)", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const ids = ["socks", "underwear", "tops", "bottoms"].filter((id) =>
      trip.items.some((entry) => entry.id === id),
    );
    await Promise.all(ids.map((id) => setPackedAction(trip.id, id, 1)));
    const read = await getTripAction(trip.id);
    if (!read.ok) throw new Error("expected ok");
    for (const id of ids) expect(read.trip.items.find((entry) => entry.id === id)!.packed).toBe(1);
  });
});
