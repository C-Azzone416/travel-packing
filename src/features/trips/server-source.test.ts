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
  "confirmBagPlacement",
  "undoBagPlacement",
  "markReady",
  "markNotReady",
  "acceptWeather",
  "skipWeather",
  "reviewWeatherAgain",
  "updatePreferences",
  "setTheme",
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
      confirmBagPlacement: () => source.confirmBagPlacement("t"),
      undoBagPlacement: () => source.undoBagPlacement("t"),
      markReady: () => source.markReady("t"),
      markNotReady: () => source.markNotReady("t"),
      acceptWeather: () => source.acceptWeather("t"),
      skipWeather: () => source.skipWeather("t"),
      reviewWeatherAgain: () => source.reviewWeatherAgain("t"),
      updatePreferences: () => source.updatePreferences("t", config),
      setTheme: () => source.setTheme("t", "beach"),
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
      ["confirmBagPlacement", "t"],
      ["undoBagPlacement", "t"],
      ["markReady", "t"],
      ["markNotReady", "t"],
      ["acceptWeather", "t"],
      ["skipWeather", "t"],
      ["reviewWeatherAgain", "t"],
      ["updatePreferences", "t", config],
      ["setTheme", "t", "beach"],
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
