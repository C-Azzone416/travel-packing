import { describe, expect, it } from "vitest";
import { LOCATIONS } from "@/domain/locations";
import { classifyTrip, startCopyDraft, startDraft } from "@/domain/trip-lifecycle";
import { DEFAULT_TRIP_CONFIG } from "./draft";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, TripsSourceError } from "./trips-source";

function setup(now = 1_000) {
  const initial = sampleLifecycleState();
  let counter = 0;
  const source = createMemoryTripsSource(initial, {
    now: () => now,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
  return { initial, source };
}

describe("memory trips source", () => {
  it("loads the initial state", async () => {
    const { initial, source } = setup();
    expect(await source.load()).toBe(initial);
    expect(source.snapshot()).toBe(initial);
  });

  it("archives and restores a trip, returning the new state each time", async () => {
    const { source } = setup();
    const archived = await source.archive("san-diego");
    expect(archived.trips.find((trip) => trip.id === "san-diego")?.archived).toBe(true);
    expect(classifyTrip(archived.trips[0], "2026-10-16")).toBe("archived");
    const restored = await source.restore("san-diego");
    expect(restored.trips.find((trip) => trip.id === "san-diego")?.archived).toBe(false);
    expect(source.snapshot()).toBe(restored);
  });

  it("removes with the injected timestamp and undoes to the exact same trip", async () => {
    const { initial, source } = setup(4242);
    const original = initial.trips.find((trip) => trip.id === "lisbon")!;
    const removed = await source.remove("lisbon");
    expect(removed.trips.map((trip) => trip.id)).toEqual(["san-diego"]);
    expect(removed.deletedTrips).toEqual([{ trip: original, deletedAt: 4242 }]);
    const undone = await source.undoRemove("lisbon");
    expect(undone.deletedTrips).toEqual([]);
    expect(undone.trips.find((trip) => trip.id === "lisbon")).toEqual(original);
  });

  it("treats undoing an unknown or already-undone trip as a no-op", async () => {
    const { source } = setup();
    const before = source.snapshot();
    expect(await source.undoRemove("nope")).toBe(before);
    await source.remove("lisbon");
    await source.undoRemove("lisbon");
    const after = source.snapshot();
    expect(await source.undoRemove("lisbon")).toBe(after);
  });

  it.each(["archive", "restore", "remove"] as const)(
    "%s rejects an unknown trip and keeps its state",
    async (command) => {
      const { source } = setup();
      const before = source.snapshot();
      await expect(source[command]("missing")).rejects.toThrow(TripsSourceError);
      await expect(source[command]("missing")).rejects.toThrow("TRIP_NOT_FOUND");
      expect(source.snapshot()).toBe(before);
    },
  );

  it("names its error type", () => {
    expect(new TripsSourceError("x").name).toBe("TripsSourceError");
  });

  describe("createTrip", () => {
    const london = LOCATIONS.find((entry) => entry.id === "gb-eng-london")!;
    const completeDraft = () => ({
      ...startDraft(DEFAULT_TRIP_CONFIG, "2026-10-20", "2026-10-24"),
      location: london,
    });

    it("saves a finished draft as a new trip at the front, with clear progress and a forecast from today", async () => {
      const { source } = setup();
      const trip = await source.createTrip(completeDraft());
      expect(trip).toMatchObject({
        id: "new-1",
        destination: "London",
        archived: false,
        ready: false,
        toiletryBagPacked: false,
        copiedFrom: null,
      });
      expect(trip.items.every((item) => item.packed === 0)).toBe(true);
      expect(trip.weather.label).toBe("Close forecast");
      expect(source.snapshot().trips.map((t) => t.id)).toEqual(["new-1", "san-diego", "lisbon"]);
      expect(source.snapshot().draft).toBeNull();
    });

    it("records where a copy came from and leaves the source untouched", async () => {
      const { initial, source } = setup();
      const original = structuredClone(initial.trips[0]);
      const draft = {
        ...startCopyDraft(initial.trips[0], "2026-12-04", "2026-12-08"),
        location: london,
      };
      const trip = await source.createTrip(draft);
      expect(trip.copiedFrom).toBe("san-diego");
      expect(trip.items.every((item) => item.packed === 0)).toBe(true);
      expect(source.snapshot().trips.find((t) => t.id === "san-diego")).toEqual(original);
    });

    it.each([
      ["no destination", { location: null }, "LOCATION_NOT_CONFIRMED"],
      ["no dates", { start: "", end: "" }, "INVALID_DATES"],
    ])("rejects a draft with %s and changes nothing", async (_label, patch, reason) => {
      const { source } = setup();
      const before = source.snapshot();
      await expect(source.createTrip({ ...completeDraft(), ...patch })).rejects.toThrow(reason);
      expect(source.snapshot()).toBe(before);
    });

    it("uses real defaults for ids, today and staples when none are injected", async () => {
      const source = createMemoryTripsSource(sampleLifecycleState(), { now: () => 1 });
      const trip = await source.createTrip(completeDraft());
      expect(trip.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(trip.items.some((item) => item.name === "Toothbrush")).toBe(true);
    });
  });
});

describe("per-trip commands", () => {
  const sanDiego = (source: ReturnType<typeof setup>["source"]) =>
    source.snapshot().trips.find((trip) => trip.id === "san-diego")!;
  const item = (trip: { items: { id: string; packed: number; qty: number }[] }, id: string) =>
    trip.items.find((entry) => entry.id === id)!;

  it("addItem adds an unpacked custom item, revokes Ready, and refuses an item that is already there", async () => {
    const { source } = setup();
    const { trip } = await source.addItem("san-diego", {
      name: "Camera",
      category: "Tech",
      neededQty: 2,
    });
    expect(trip.items.find((entry) => entry.name === "Camera")).toMatchObject({
      category: "Tech",
      qty: 2,
      packed: 0,
    });
    expect(trip.ready).toBe(false);
    await expect(
      source.addItem("san-diego", { name: " camera ", category: "Tech", neededQty: 1 }),
    ).rejects.toThrow("EXISTS");
    await expect(
      source.addItem("san-diego", { name: "Lens", category: "Bathroom", neededQty: 1 }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      source.addItem("nope", { name: "Lens", category: "Tech", neededQty: 1 }),
    ).rejects.toThrow("NOT_FOUND");
    expect(sanDiego(source).items.filter((entry) => entry.name === "Camera")).toHaveLength(1);
  });

  it("saveAsList saves the chosen items as a list, refuses a taken name and unknown items, and never changes the trip", async () => {
    const { source } = setup();
    const trip = sanDiego(source);
    const before = JSON.stringify(trip);
    const ids = trip.items.slice(0, 3).map((entry) => entry.id);
    expect(await source.saveAsList("san-diego", " Beach week ", ids)).toMatchObject({
      name: "Beach week",
      itemCount: 3,
    });
    await expect(source.saveAsList("san-diego", "beach WEEK", ids)).rejects.toThrow("NAME_TAKEN");
    await expect(source.saveAsList("san-diego", "Other", [])).rejects.toThrow("INVALID_INPUT");
    await expect(source.saveAsList("san-diego", "Other", [...ids, "nope"])).rejects.toThrow(
      "INVALID_INPUT",
    );
    await expect(source.saveAsList("nope", "Other", ids)).rejects.toThrow("NOT_FOUND");
    expect(JSON.stringify(sanDiego(source))).toBe(before);
  });

  it("listStaples returns the owner's current staples, including remembered changes", async () => {
    const { source } = setup();
    expect((await source.listStaples()).length).toBe(source.staplesSnapshot().length);
    await source.addToiletryItem("san-diego", {
      name: "Razor",
      qty: 1,
      packLast: false,
      scope: "remember",
    });
    expect((await source.listStaples()).some((entry) => entry.name === "Razor")).toBe(true);
  });

  it("upsertStaple adds a new staple and replaces an existing one by id, leaving existing trips alone", async () => {
    const { source } = setup();
    const tripsBefore = JSON.stringify(source.snapshot().trips);
    const before = (await source.listStaples()).length;
    const added = await source.upsertStaple({
      id: "razor",
      name: "Razor",
      qty: 1,
      cadence: "per trip",
      category: "Bathroom",
      packLast: false,
    });
    expect(added).toHaveLength(before + 1);
    const changed = await source.upsertStaple({ ...added.find((s) => s.id === "razor")!, qty: 2 });
    expect(changed).toHaveLength(before + 1);
    expect(changed.find((s) => s.id === "razor")!.qty).toBe(2);
    expect(source.staplesSnapshot()).toEqual(changed);
    expect(JSON.stringify(source.snapshot().trips)).toBe(tripsBefore);
  });

  it("getTrip returns the live trip, and NOT_FOUND for an unknown id", async () => {
    const { source } = setup();
    expect((await source.getTrip("san-diego")).destination).toBe("San Diego");
    await expect(source.getTrip("nope")).rejects.toThrow("NOT_FOUND");
  });

  it.each(["togglePacked", "incrementPacked", "decrementPacked"] as const)(
    "%s on an unknown trip is NOT_FOUND and changes nothing",
    async (command) => {
      const { source } = setup();
      const before = source.snapshot();
      await expect(source[command]("nope", "tops")).rejects.toThrow("NOT_FOUND");
      expect(source.snapshot()).toBe(before);
    },
  );

  it("setTheme changes only the theme, validated, and a ready trip stays ready", async () => {
    const { source } = setup();
    const before = (await source.getTrip("lisbon"))!;
    const change = await source.setTheme("lisbon", "home");
    expect(change.trip).toEqual({ ...before, theme: "home" });
    expect(change.trip.ready).toBe(true);
    expect(change.signals).toEqual({ promptBagPlacement: false, reviewPrompt: false });
    expect((await source.getTrip("lisbon")).theme).toBe("home");
    // Every other trip is untouched.
    expect((await source.getTrip("san-diego")).theme).toBe("beach");
  });

  it("setTheme refuses an unknown theme (INVALID_INPUT) or an unknown trip (NOT_FOUND) and changes nothing", async () => {
    const { source } = setup();
    const before = source.snapshot();
    for (const theme of ["volcano", "", "Beach", null, undefined, 3])
      await expect(source.setTheme("lisbon", theme as never)).rejects.toThrow("INVALID_INPUT");
    await expect(source.setTheme("nope", "city")).rejects.toThrow("NOT_FOUND");
    expect(source.snapshot()).toBe(before);
  });

  it("toggles, increments and decrements packed counts, storing the changed trip", async () => {
    const { source } = setup();
    const start = item(sanDiego(source), "tops").packed;
    expect(
      (await source.togglePacked("san-diego", "tops")).trip.items.find(
        (entry) => entry.id === "tops",
      )?.packed,
    ).toBe(item(sanDiego(source), "tops").qty);
    await source.togglePacked("san-diego", "tops");
    expect(item(sanDiego(source), "tops").packed).toBe(0);
    await source.incrementPacked("san-diego", "socks");
    expect(item(sanDiego(source), "socks").packed).toBe(2);
    await source.decrementPacked("san-diego", "socks");
    expect(item(sanDiego(source), "socks").packed).toBe(1);
    expect(start).toBe(1);
  });

  it("an unknown item is refused with its reason and changes nothing", async () => {
    const { source } = setup();
    const before = source.snapshot();
    await expect(source.togglePacked("san-diego", "nope")).rejects.toThrow("ITEM_NOT_FOUND");
    expect(source.snapshot()).toBe(before);
  });

  it("checking the last Bathroom item signals the bag prompt, without confirming placement", async () => {
    const { source } = setup();
    const toiletries = sanDiego(source).items.filter((entry) => entry.groupId === "toiletry-bag");
    let last = await source.togglePacked("san-diego", toiletries[0].id);
    for (const entry of toiletries.slice(1))
      last = await source.togglePacked("san-diego", entry.id);
    expect(last.signals.promptBagPlacement).toBe(true);
    expect(last.trip.toiletryBagPacked).toBe(false);
  });

  it("walks the bag gate: confirm, then undo; confirming before contents are complete is refused", async () => {
    const { source } = setup();
    await expect(source.confirmBagPlacement("san-diego")).rejects.toThrow("CONTENTS_INCOMPLETE");
    const toiletries = sanDiego(source).items.filter((entry) => entry.groupId === "toiletry-bag");
    for (const entry of toiletries) await source.togglePacked("san-diego", entry.id);
    expect((await source.confirmBagPlacement("san-diego")).trip.toiletryBagPacked).toBe(true);
    expect((await source.undoBagPlacement("san-diego")).trip.toiletryBagPacked).toBe(false);
  });

  it("Ready needs everything packed; marking not ready keeps all progress", async () => {
    const { source } = setup();
    await expect(source.markReady("san-diego")).rejects.toThrow("NOT_ALL_PACKED");
    const lisbon = (await source.markNotReady("lisbon")).trip;
    expect(lisbon.ready).toBe(false);
    expect(lisbon.items.every((entry) => entry.packed === entry.qty)).toBe(true);
    expect((await source.markReady("lisbon")).trip.ready).toBe(true);
  });

  it("a trip-only edit changes this trip and never the staples", async () => {
    const { source } = setup();
    const staplesBefore = source.staplesSnapshot();
    const lisbonBefore = source.snapshot().trips.find((trip) => trip.id === "lisbon");
    const edit = {
      name: "Underwear (travel)",
      qty: 5,
      timing: "main" as const,
      scope: "this-trip" as const,
    };
    const { trip } = await source.editItem("san-diego", "underwear", edit);
    expect(trip.items.find((entry) => entry.id === "underwear")).toMatchObject({
      name: "Underwear (travel)",
      qty: 5,
    });
    expect(source.staplesSnapshot()).toEqual(staplesBefore);
    expect(source.snapshot().trips.find((entry) => entry.id === "lisbon")).toBe(lisbonBefore);
  });

  it("a remembered edit changes the staples and future trips, but not this or any other existing trip's history", async () => {
    const { source } = setup();
    const lisbonBefore = structuredClone(
      source.snapshot().trips.find((trip) => trip.id === "lisbon"),
    );
    const stapleBefore = source.staplesSnapshot().find((entry) => entry.id === "sunglasses")!;
    await source.editItem("san-diego", "sunglasses", {
      name: "Polarized sunglasses",
      qty: 2,
      timing: "main",
      scope: "remember",
    });
    const staple = source.staplesSnapshot().find((entry) => entry.id === "sunglasses")!;
    expect(staple).toMatchObject({ name: "Polarized sunglasses", qty: 2 });
    expect(staple).not.toEqual(stapleBefore);
    expect(source.snapshot().trips.find((entry) => entry.id === "lisbon")).toEqual(lisbonBefore);
    const future = await source.createTrip({
      mode: "create",
      sourceId: null,
      location: {
        id: "x",
        city: "Paris",
        region: "Île-de-France",
        country: "France",
        countryCode: "FR",
        label: "Paris",
      },
      start: "2026-11-01",
      end: "2026-11-04",
      config: {
        laundry: false,
        spare: false,
        niceAttire: false,
        occasionCount: 1,
        reuseNice: false,
        returnOutfit: true,
      },
      theme: "travel",
    });
    expect(future.items.find((entry) => entry.id === "sunglasses")).toMatchObject({
      name: "Polarized sunglasses",
      qty: 2,
    });
  });

  it("an invalid edit is refused with its reason", async () => {
    const { source } = setup();
    await expect(
      source.editItem("san-diego", "tops", {
        name: "  ",
        qty: 1,
        timing: "main",
        scope: "this-trip",
      }),
    ).rejects.toThrow("EMPTY_NAME");
  });

  it("removes an item for this trip only, or also from the staples when remembered", async () => {
    const { source } = setup();
    const staplesBefore = source.staplesSnapshot();
    const removed = await source.removeItem("san-diego", "nice-shoes", "this-trip");
    expect(removed.trip.items.some((entry) => entry.id === "nice-shoes")).toBe(false);
    expect(source.staplesSnapshot()).toEqual(staplesBefore);
    await source.removeItem("san-diego", "last-glasses", "remember");
    expect(source.staplesSnapshot().some((entry) => entry.id === "last-glasses")).toBe(false);
    await expect(source.removeItem("san-diego", "nope", "this-trip")).rejects.toThrow(
      "ITEM_NOT_FOUND",
    );
  });

  it("adds a Bathroom item (one canonical checkbox in the bag group), also to the staples when remembered", async () => {
    const { source } = setup();
    const staplesBefore = source.staplesSnapshot().length;
    const { trip } = await source.addToiletryItem("san-diego", {
      name: "Face wash",
      qty: 1,
      packLast: false,
      scope: "this-trip",
    });
    const added = trip.items.find((entry) => entry.name === "Face wash")!;
    expect(added).toMatchObject({ groupId: "toiletry-bag", packed: 0, qty: 1 });
    expect(source.staplesSnapshot()).toHaveLength(staplesBefore);
    await source.addToiletryItem("san-diego", {
      name: "Razor",
      qty: 1,
      packLast: true,
      scope: "remember",
    });
    expect(source.staplesSnapshot()).toHaveLength(staplesBefore + 1);
    expect(source.staplesSnapshot().find((entry) => entry.name === "Razor")).toMatchObject({
      packLast: true,
    });
  });

  it("weather: accepting adds exactly one umbrella and revokes Ready; skipping and reviewing again change only the weather state", async () => {
    const { source } = setup();
    // Lisbon starts Ready with its weather already accepted; reopen the review (which changes only the weather state).
    const reopened = (await source.reviewWeatherAgain("lisbon")).trip;
    expect(reopened).toMatchObject({ ready: true });
    expect(reopened.weather.status).toBe("pending");
    const accepted = (await source.acceptWeather("lisbon")).trip;
    expect(accepted.ready).toBe(false);
    expect(accepted.weather.status).toBe("accepted");
    expect(accepted.items.filter((entry) => entry.id === "weather-umbrella")).toHaveLength(1);
    await source.acceptWeather("lisbon");
    expect(
      source
        .snapshot()
        .trips.find((trip) => trip.id === "lisbon")!
        .items.filter((entry) => entry.id === "weather-umbrella"),
    ).toHaveLength(1);

    const sd = (await source.skipWeather("san-diego")).trip;
    expect(sd.weather.status).toBe("skipped");
    expect(sd.items.some((entry) => entry.id === "weather-umbrella")).toBe(false);
    expect((await source.reviewWeatherAgain("san-diego")).trip.weather.status).toBe("pending");
  });

  it("updating preferences recalculates the list, keeps progress on unchanged items and revokes Ready", async () => {
    const { source } = setup();
    const trip = sanDiego(source);
    const underwear = item(trip, "underwear").packed;
    const next = { ...trip.config, laundry: true };
    const { trip: changed } = await source.updatePreferences("san-diego", next);
    expect(changed.config.laundry).toBe(true);
    expect(changed.items.find((entry) => entry.id === "underwear")?.packed).toBe(underwear);
    expect(changed.ready).toBe(false);
    await expect(source.updatePreferences("nope", next)).rejects.toThrow("NOT_FOUND");
  });
});
