import { describe, expect, it, vi } from "vitest";
import { emptyLifecycleState } from "@/domain/trip-lifecycle";
import type { LifecycleTrip, TripDraft } from "@/domain/trip-lifecycle";
import type { CreateTripActionResult, TripsActionResult } from "./actions";
import { createServerTripsSource, type TripActions, type TripsActions } from "./server-source";
import type { TripCommandResult } from "./trip-actions";
import { TripsSourceError } from "./trips-source";

const state = emptyLifecycleState();
const ok: TripsActionResult = { ok: true, state };
const trip = { id: "new-trip" } as LifecycleTrip;
const draft = { mode: "create" } as TripDraft;

function actions(result: TripsActionResult = ok) {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn(async (id?: string) => {
      calls.push(id === undefined ? name : `${name}:${id}`);
      return result;
    });
  const fakes = {
    load: record("load"),
    archive: record("archive"),
    restore: record("restore"),
    remove: record("remove"),
    undoRemove: record("undoRemove"),
    create: vi.fn(async (): Promise<CreateTripActionResult> => {
      calls.push("create");
      return result.ok ? { ok: true, trip } : result;
    }),
  };
  return { fakes: fakes as unknown as TripsActions, calls };
}

const signals = { promptBagPlacement: true, reviewPrompt: false };
const TRIP_COMMANDS = [
  "setPacked",
  "togglePacked",
  "incrementPacked",
  "decrementPacked",
  "editItem",
  "removeItem",
  "addToiletryItem",
  "addItem",
  "confirmBagPlacement",
  "undoBagPlacement",
  "markReady",
  "markNotReady",
  "acceptWeather",
  "skipWeather",
  "reviewWeatherAgain",
  "updatePreferences",
  "setTheme",
  "setStampLabels",
  "setStops",
] as const;

function tripActions(result: TripCommandResult = { ok: true, trip, signals }) {
  const calls: unknown[][] = [];
  const record = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    });
  const fakes = {
    getTrip: vi.fn(async (id: string) => {
      calls.push(["getTrip", id]);
      return result.ok ? ({ ok: true, trip } as const) : result;
    }),
    listStaples: vi.fn(async () => {
      calls.push(["listStaples"]);
      return result.ok ? ({ ok: true, staples: [] } as const) : result;
    }),
    upsertStaple: vi.fn(async (staple: { id: string }) => {
      calls.push(["upsertStaple", staple.id]);
      return result.ok ? ({ ok: true, staples: [] } as const) : result;
    }),
    ...Object.fromEntries(TRIP_COMMANDS.map((name) => [name, record(name)])),
  };
  return { fakes: fakes as unknown as TripActions, calls };
}

const edit = { name: "Shades", qty: 2, timing: "main", scope: "this-trip" } as const;
const toiletry = { name: "Face wash", qty: 1, packLast: false, scope: "this-trip" } as const;
const camera = { name: "Camera", category: "Tech", neededQty: 2 };
const config = {
  laundry: true,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

describe("createServerTripsSource: per-trip commands", () => {
  const invocations = (source: ReturnType<typeof createServerTripsSource>) =>
    ({
      setPacked: () => source.setPacked("t", "i", 3),
      togglePacked: () => source.togglePacked("t", "i"),
      incrementPacked: () => source.incrementPacked("t", "i"),
      decrementPacked: () => source.decrementPacked("t", "i"),
      editItem: () => source.editItem("t", "i", edit),
      removeItem: () => source.removeItem("t", "i", "remember"),
      addToiletryItem: () => source.addToiletryItem("t", toiletry),
      addItem: () => source.addItem("t", camera),
      confirmBagPlacement: () => source.confirmBagPlacement("t"),
      undoBagPlacement: () => source.undoBagPlacement("t"),
      markReady: () => source.markReady("t"),
      markNotReady: () => source.markNotReady("t"),
      acceptWeather: () => source.acceptWeather("t"),
      skipWeather: () => source.skipWeather("t"),
      reviewWeatherAgain: () => source.reviewWeatherAgain("t"),
      updatePreferences: () => source.updatePreferences("t", config, "stamp"),
      setTheme: () => source.setTheme("t", "beach"),
      setStampLabels: () => source.setStampLabels("t", "ABC", null),
      setStops: () => source.setStops("t", []),
    }) satisfies Record<(typeof TRIP_COMMANDS)[number], () => Promise<unknown>>;

  it("passes every command's arguments to the matching action and returns the trip and signals", async () => {
    const { fakes, calls } = tripActions();
    const source = createServerTripsSource(actions().fakes, fakes);
    const run = invocations(source);
    for (const name of TRIP_COMMANDS) expect(await run[name](), name).toEqual({ trip, signals });
    expect(calls).toEqual([
      ["setPacked", "t", "i", 3],
      ["togglePacked", "t", "i"],
      ["incrementPacked", "t", "i"],
      ["decrementPacked", "t", "i"],
      ["editItem", "t", "i", edit],
      ["removeItem", "t", "i", "remember"],
      ["addToiletryItem", "t", toiletry],
      ["addItem", "t", camera],
      ["confirmBagPlacement", "t"],
      ["undoBagPlacement", "t"],
      ["markReady", "t"],
      ["markNotReady", "t"],
      ["acceptWeather", "t"],
      ["skipWeather", "t"],
      ["reviewWeatherAgain", "t"],
      ["updatePreferences", "t", config, "stamp"],
      ["setTheme", "t", "beach"],
      ["setStampLabels", "t", "ABC", null],
      ["setStops", "t", []],
    ]);
  });

  it("reads one trip and the owner's staples", async () => {
    const { fakes, calls } = tripActions();
    const source = createServerTripsSource(actions().fakes, fakes);
    expect(await source.getTrip("t")).toBe(trip);
    expect(await source.listStaples()).toEqual([]);
    expect(calls).toEqual([["getTrip", "t"], ["listStaples"]]);
  });

  it("upserts a staple through its own action and returns the list it gives back", async () => {
    const { fakes, calls } = tripActions();
    const source = createServerTripsSource(actions().fakes, fakes);
    const staple = {
      id: "razor",
      name: "Razor",
      qty: 1,
      cadence: "per trip",
      category: "Bathroom",
      packLast: false,
    } as const;
    expect(await source.upsertStaple(staple)).toEqual([]);
    expect(fakes.upsertStaple).toHaveBeenCalledWith(staple);
    expect(calls).toEqual([["upsertStaple", "razor"]]);
  });

  it.each(["NOT_FOUND", "REJECTED", "INVALID_INPUT", "INTERNAL"] as const)(
    "turns a failed action (%s) into a TripsSourceError carrying only the code",
    async (code) => {
      const { fakes } = tripActions({ ok: false, code });
      const source = createServerTripsSource(actions().fakes, fakes);
      const run = invocations(source);
      for (const call of [
        ...TRIP_COMMANDS.map((name) => run[name]),
        () => source.getTrip("t"),
        () => source.listStaples(),
        () =>
          source.upsertStaple({
            id: "x",
            name: "X",
            qty: 1,
            cadence: "per trip",
            category: "Other essentials",
            packLast: false,
          }),
      ]) {
        const error = await call().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TripsSourceError);
        expect((error as Error).message).toBe(code);
      }
    },
  );
});

describe("createServerTripsSource: saveAsList (#169)", () => {
  const list = { id: "l1", name: "Beach week", itemCount: 2 };

  it("passes the name and item ids to its action and returns the created list", async () => {
    const { fakes } = tripActions();
    fakes.saveAsList = vi.fn(async () => ({ ok: true, list }) as const);
    const source = createServerTripsSource(actions().fakes, fakes);
    expect(await source.saveAsList("t", "Beach week", ["a", "b"])).toEqual(list);
    expect(fakes.saveAsList).toHaveBeenCalledWith("t", "Beach week", ["a", "b"]);
  });

  it("says NAME_TAKEN, not a code, when the owner already has that list name; other refusals carry the code", async () => {
    const { fakes } = tripActions();
    const source = createServerTripsSource(actions().fakes, fakes);
    fakes.saveAsList = vi.fn(
      async () => ({ ok: false, code: "REJECTED", reason: "NAME_TAKEN" }) as const,
    );
    const taken = await source.saveAsList("t", "x", ["a"]).catch((caught: unknown) => caught);
    expect((taken as Error).message).toBe("NAME_TAKEN");
    fakes.saveAsList = vi.fn(async () => ({ ok: false, code: "NOT_FOUND" }) as const);
    const missing = await source.saveAsList("t", "x", ["a"]).catch((caught: unknown) => caught);
    expect(missing).toBeInstanceOf(TripsSourceError);
    expect((missing as Error).message).toBe("NOT_FOUND");
  });
});

describe("createServerTripsSource: addItem (#147)", () => {
  it("says EXISTS, not a code, when the trip already has the item", async () => {
    const { fakes } = tripActions();
    fakes.addItem = vi.fn(async () => ({ ok: false, code: "REJECTED", reason: "EXISTS" }) as const);
    const source = createServerTripsSource(actions().fakes, fakes);
    const error = await source.addItem("t", camera).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TripsSourceError);
    expect((error as Error).message).toBe("EXISTS");
  });

  it("carries only the code for any other refusal", async () => {
    const { fakes } = tripActions();
    fakes.addItem = vi.fn(async () => ({
      ok: false as const,
      code: "INVALID_INPUT" as const,
      fields: ["neededQty"],
    }));
    const source = createServerTripsSource(actions().fakes, fakes);
    const error = await source.addItem("t", camera).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("INVALID_INPUT");
  });
});

describe("createServerTripsSource", () => {
  it("passes each call to the matching action and returns the state it gives back", async () => {
    const { fakes, calls } = actions();
    const source = createServerTripsSource(fakes, tripActions().fakes);
    expect(await source.load()).toBe(state);
    expect(await source.archive("a")).toBe(state);
    expect(await source.restore("b")).toBe(state);
    expect(await source.remove("c")).toBe(state);
    expect(await source.undoRemove("d")).toBe(state);
    expect(await source.createTrip(draft)).toBe(trip);
    expect(fakes.create).toHaveBeenCalledWith(draft);
    expect(calls).toEqual(["load", "archive:a", "restore:b", "remove:c", "undoRemove:d", "create"]);
  });

  it.each(["NOT_FOUND", "INTERNAL", "INVALID_INPUT", "REJECTED"] as const)(
    "turns a failed action (%s) into a TripsSourceError carrying only the code",
    async (code) => {
      const { fakes } = actions({ ok: false, code });
      const source = createServerTripsSource(fakes, tripActions().fakes);
      for (const call of [
        () => source.load(),
        () => source.archive("a"),
        () => source.restore("a"),
        () => source.remove("a"),
        () => source.undoRemove("a"),
        () => source.createTrip(draft),
      ]) {
        const error = await call().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TripsSourceError);
        expect((error as Error).message).toBe(code);
      }
    },
  );

  it("propagates a thrown action (for example a network failure) as a rejection", async () => {
    const source = createServerTripsSource(
      {
        ...actions().fakes,
        load: async () => {
          throw new Error("network down");
        },
      },
      tripActions().fakes,
    );
    await expect(source.load()).rejects.toThrow("network down");
  });
});
