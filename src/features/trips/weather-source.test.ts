import { describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { createServerTripsSource } from "./server-source";
import { TripsSourceError } from "./trips-source";

const trip = { id: "t" } as LifecycleTrip;
const settings = { weatherOptIn: true, temperatureUnit: "F" as const };
const noop = new Proxy({}, { get: () => vi.fn() }) as never;

function weatherActions(fail = false) {
  const code = { ok: false as const, code: "INTERNAL" as const, settings };
  return {
    getSettings: vi.fn(async () => (fail ? code : { ok: true as const, settings })),
    updateSettings: vi.fn(async () => (fail ? code : { ok: true as const, settings })),
    getTripWeather: vi.fn(async () => ({ kind: "unavailable" as const })),
    previewDraft: vi.fn(async () => ({ kind: "ready" as const, stops: [] })),
    createTripWithReview: vi.fn(async () => (fail ? code : { ok: true as const, trip })),
    listSuggestions: vi.fn(async () => (fail ? code : { ok: true as const, suggestions: [] })),
    applyReview: vi.fn(async () =>
      fail
        ? code
        : { ok: true as const, trip, signals: { promptBagPlacement: false, reviewPrompt: false } },
    ),
  };
}

describe("the weather port of the server source", () => {
  it("is absent unless weather actions are given", () => {
    expect(createServerTripsSource(noop, noop).weather).toBeUndefined();
  });

  it("forwards every call to its action and unwraps the result", async () => {
    const actions = weatherActions();
    const source = createServerTripsSource(noop, noop, actions).weather!;
    expect(await source.getSettings()).toEqual(settings);
    expect(await source.updateSettings({ weatherOptIn: false })).toEqual(settings);
    expect(actions.updateSettings).toHaveBeenCalledWith({ weatherOptIn: false });
    expect(await source.getTripWeather("t")).toEqual({ kind: "unavailable" });
    expect(await source.previewDraft([])).toEqual({ kind: "ready", stops: [] });
    expect(await source.createTripWithReview({} as never, [])).toBe(trip);
    expect(await source.listSuggestions("t")).toEqual([]);
    const change = await source.applyReview("t", [], []);
    expect(change.trip).toBe(trip);
    expect(actions.applyReview).toHaveBeenCalledWith("t", [], []);
  });

  it("turns a failed action into a TripsSourceError carrying only the code", async () => {
    const source = createServerTripsSource(noop, noop, weatherActions(true)).weather!;
    const error = new TripsSourceError("INTERNAL");
    await expect(source.getSettings()).rejects.toThrow(error);
    await expect(source.updateSettings({})).rejects.toThrow(error);
    await expect(source.createTripWithReview({} as never, [])).rejects.toThrow(error);
    await expect(source.listSuggestions("t")).rejects.toThrow(error);
    await expect(source.applyReview("t", [], [])).rejects.toThrow(error);
  });
});
