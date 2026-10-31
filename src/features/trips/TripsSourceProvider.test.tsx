// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import { TripsSourceProvider, useTripsSource } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const actions = vi.hoisted(() => {
  const state = { trips: [], deletedTrips: [], draft: null };
  const trip = { id: "t" };
  const change = { ok: true, trip, signals: { promptBagPlacement: false, reviewPrompt: false } };
  const dashboard = (name: string) =>
    [name, vi.fn().mockResolvedValue({ ok: true, state })] as const;
  const command = (name: string) => [name, vi.fn().mockResolvedValue(change)] as const;
  return {
    loadTripsAction: vi.fn(),
    dashboard: Object.fromEntries(
      ["archiveTripAction", "restoreTripAction", "removeTripAction", "undoRemoveTripAction"].map(
        dashboard,
      ),
    ),
    createTripAction: vi.fn().mockResolvedValue({ ok: true, trip }),
    createTripWithWeatherAction: vi.fn().mockResolvedValue({ ok: true, trip }),
    getTripAction: vi.fn().mockResolvedValue({ ok: true, trip }),
    listStaplesAction: vi.fn().mockResolvedValue({ ok: true, staples: [] }),
    upsertStapleAction: vi.fn().mockResolvedValue({ ok: true, staples: [] }),
    listWeatherSuggestionsAction: vi.fn().mockResolvedValue({ ok: true, suggestions: [] }),
    applyWeatherReviewAction: vi.fn().mockResolvedValue(change),
    getWeatherSettingsAction: vi.fn().mockResolvedValue({
      ok: true,
      settings: { optedIn: false, temperatureUnit: "F" },
    }),
    updateWeatherSettingsAction: vi.fn().mockResolvedValue({
      ok: true,
      settings: { optedIn: true, temperatureUnit: "F" },
    }),
    fetchTripWeather: vi.fn().mockResolvedValue({ kind: "ready", stops: [] }),
    previewWeatherAction: vi.fn().mockResolvedValue({ kind: "ready", stops: [] }),
    listSavedListsAction: vi.fn().mockResolvedValue({ ok: true, lists: [{ id: "l1" }] }),
    getSavedListAction: vi.fn().mockResolvedValue({ ok: true, list: { id: "l1", items: [] } }),
    commands: Object.fromEntries(
      [
        "setPackedAction",
        "togglePackedAction",
        "incrementPackedAction",
        "decrementPackedAction",
        "editItemAction",
        "removeItemAction",
        "addToiletryItemAction",
        "addItemAction",
        "saveAsListAction",
        "confirmBagPlacementAction",
        "undoBagPlacementAction",
        "markReadyAction",
        "markNotReadyAction",
        "acceptWeatherAction",
        "skipWeatherAction",
        "reviewWeatherAgainAction",
        "updatePreferencesAction",
        "setThemeAction",
        "setStampLabelsAction",
        "setStopsAction",
      ].map(command),
    ),
  };
});
vi.mock("./actions", () => ({
  loadTripsAction: actions.loadTripsAction,
  createTripAction: actions.createTripAction,
  createTripWithWeatherAction: actions.createTripWithWeatherAction,
  ...actions.dashboard,
}));
vi.mock("./trip-actions", () => ({
  getTripAction: actions.getTripAction,
  listStaplesAction: actions.listStaplesAction,
  upsertStapleAction: actions.upsertStapleAction,
  listWeatherSuggestionsAction: actions.listWeatherSuggestionsAction,
  applyWeatherReviewAction: actions.applyWeatherReviewAction,
  ...actions.commands,
}));
vi.mock("@/features/settings/weather-actions", () => ({
  getWeatherSettingsAction: actions.getWeatherSettingsAction,
  updateWeatherSettingsAction: actions.updateWeatherSettingsAction,
}));
vi.mock("../staples/saved-list-actions", () => ({
  listSavedListsAction: actions.listSavedListsAction,
  getSavedListAction: actions.getSavedListAction,
}));
vi.mock("./weather-client", () => ({ fetchTripWeather: actions.fetchTripWeather }));
vi.mock("./weather-preview-action", () => ({
  previewWeatherAction: actions.previewWeatherAction,
}));
actions.loadTripsAction.mockResolvedValue({
  ok: true,
  state: { trips: [{ id: "from-the-server" }], deletedTrips: [], draft: null },
});

function Probe({ expected }: { expected?: TripsSource }) {
  const source = useTripsSource();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    void source.load().then((state) => setIds(state.trips.map((trip) => trip.id)));
  }, [source]);
  return (
    <>
      <p>{source === expected ? "injected" : "default"}</p>
      <p aria-label="loaded">{ids.join(",")}</p>
    </>
  );
}

describe("TripsSourceProvider", () => {
  it("throws outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/TripsSourceProvider/);
    spy.mockRestore();
  });

  it("provides the injected source", () => {
    const source = createMemoryTripsSource(sampleLifecycleState(), { now: () => 1 });
    render(
      <TripsSourceProvider source={source}>
        <Probe expected={source} />
      </TripsSourceProvider>,
    );
    expect(screen.getByText("injected")).toBeTruthy();
  });

  it("falls back to a source that reads and writes through the server actions", async () => {
    render(
      <TripsSourceProvider>
        <Probe />
      </TripsSourceProvider>,
    );
    expect(screen.getByText("default")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("loaded").textContent).toBe("from-the-server"),
    );
    expect(actions.loadTripsAction).toHaveBeenCalledTimes(1);
  });

  describe("the default wiring: every source method calls exactly its own action, once, with its arguments", () => {
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
    const draft = { mode: "create" } as never;
    const staple = {
      id: "razor",
      name: "Razor",
      qty: 1,
      cadence: "per trip",
      category: "Bathroom",
      packLast: false,
    } as const;

    // method -> [how to call it on the source, the one action it must reach, that action's expected arguments]
    const WIRING: [
      string,
      (source: TripsSource) => Promise<unknown>,
      () => ReturnType<typeof vi.fn>,
      unknown[],
    ][] = [
      ["load", (s) => s.load(), () => actions.loadTripsAction, []],
      ["archive", (s) => s.archive("a"), () => actions.dashboard.archiveTripAction, ["a"]],
      ["restore", (s) => s.restore("a"), () => actions.dashboard.restoreTripAction, ["a"]],
      ["remove", (s) => s.remove("a"), () => actions.dashboard.removeTripAction, ["a"]],
      ["undoRemove", (s) => s.undoRemove("a"), () => actions.dashboard.undoRemoveTripAction, ["a"]],
      ["createTrip", (s) => s.createTrip(draft), () => actions.createTripAction, [draft]],
      ["getTrip", (s) => s.getTrip("t"), () => actions.getTripAction, ["t"]],
      ["listStaples", (s) => s.listStaples(), () => actions.listStaplesAction, []],
      ["upsertStaple", (s) => s.upsertStaple(staple), () => actions.upsertStapleAction, [staple]],
      [
        "setPacked",
        (s) => s.setPacked("t", "i", 3),
        () => actions.commands.setPackedAction,
        ["t", "i", 3],
      ],
      [
        "togglePacked",
        (s) => s.togglePacked("t", "i"),
        () => actions.commands.togglePackedAction,
        ["t", "i"],
      ],
      [
        "incrementPacked",
        (s) => s.incrementPacked("t", "i"),
        () => actions.commands.incrementPackedAction,
        ["t", "i"],
      ],
      [
        "decrementPacked",
        (s) => s.decrementPacked("t", "i"),
        () => actions.commands.decrementPackedAction,
        ["t", "i"],
      ],
      [
        "editItem",
        (s) => s.editItem("t", "i", edit),
        () => actions.commands.editItemAction,
        ["t", "i", edit],
      ],
      [
        "removeItem",
        (s) => s.removeItem("t", "i", "remember"),
        () => actions.commands.removeItemAction,
        ["t", "i", "remember"],
      ],
      [
        "addToiletryItem",
        (s) => s.addToiletryItem("t", toiletry),
        () => actions.commands.addToiletryItemAction,
        ["t", toiletry],
      ],
      [
        "addItem",
        (s) => s.addItem("t", { name: "Camera", category: "Tech", neededQty: 2 }),
        () => actions.commands.addItemAction,
        ["t", { name: "Camera", category: "Tech", neededQty: 2 }],
      ],
      [
        "saveAsList",
        (s) => s.saveAsList("t", "Beach week", ["a", "b"]),
        () => actions.commands.saveAsListAction,
        ["t", "Beach week", ["a", "b"]],
      ],
      [
        "confirmBagPlacement",
        (s) => s.confirmBagPlacement("t"),
        () => actions.commands.confirmBagPlacementAction,
        ["t"],
      ],
      [
        "undoBagPlacement",
        (s) => s.undoBagPlacement("t"),
        () => actions.commands.undoBagPlacementAction,
        ["t"],
      ],
      ["markReady", (s) => s.markReady("t"), () => actions.commands.markReadyAction, ["t"]],
      [
        "markNotReady",
        (s) => s.markNotReady("t"),
        () => actions.commands.markNotReadyAction,
        ["t"],
      ],
      [
        "acceptWeather",
        (s) => s.acceptWeather("t"),
        () => actions.commands.acceptWeatherAction,
        ["t"],
      ],
      ["skipWeather", (s) => s.skipWeather("t"), () => actions.commands.skipWeatherAction, ["t"]],
      [
        "reviewWeatherAgain",
        (s) => s.reviewWeatherAgain("t"),
        () => actions.commands.reviewWeatherAgainAction,
        ["t"],
      ],
      [
        "updatePreferences",
        (s) => s.updatePreferences("t", config, "2030-01-01T00:00:00.000Z"),
        () => actions.commands.updatePreferencesAction,
        ["t", config, "2030-01-01T00:00:00.000Z"],
      ],
      [
        "setTheme",
        (s) => s.setTheme("t", "city"),
        () => actions.commands.setThemeAction,
        ["t", "city"],
      ],
      [
        "setStampLabels",
        (s) => s.setStampLabels("t", "ABC", null),
        () => actions.commands.setStampLabelsAction,
        ["t", "ABC", null],
      ],
      ["setStops", (s) => s.setStops("t", []), () => actions.commands.setStopsAction, ["t", []]],
    ];

    const everyAction = () => [
      actions.loadTripsAction,
      actions.createTripAction,
      actions.getTripAction,
      actions.listStaplesAction,
      actions.upsertStapleAction,
      ...Object.values(actions.dashboard),
      ...Object.values(actions.commands),
    ];

    function Capture({ onSource }: { onSource: (source: TripsSource) => void }) {
      onSource(useTripsSource());
      return null;
    }

    it("previews a draft with provider-minimal stops: dates and coordinates only, the last stop includes its leave day", async () => {
      let captured!: TripsSource;
      render(
        <TripsSourceProvider>
          <Capture onSource={(source) => (captured = source)} />
        </TripsSourceProvider>,
      );
      actions.previewWeatherAction.mockClear();
      const place = { id: "x", city: "A", region: "", country: "", countryCode: "", label: "A" };
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2030, 3, 20, 23, 30));
      await captured.weather!.previewDraft([
        {
          location: { ...place, latitude: 1.5, longitude: 2.5, city: "Secret name" },
          arrive: "2030-05-01",
          leave: "2030-05-03",
        },
        { location: place, arrive: "2030-05-03", leave: "2030-05-05" },
      ]);
      expect(actions.previewWeatherAction).toHaveBeenCalledWith(
        [
          {
            stopIndex: 0,
            arrive: "2030-05-01",
            leave: "2030-05-03",
            includeLeave: false,
            latitude: 1.5,
            longitude: 2.5,
          },
          { stopIndex: 1, arrive: "2030-05-03", leave: "2030-05-05", includeLeave: true },
        ],
        "2030-04-20",
      );
      vi.useRealTimers();
    });

    it("reads the owner's saved lists through the list and get actions, and turns a refusal into an error (#170)", async () => {
      let captured!: TripsSource;
      render(
        <TripsSourceProvider>
          <Capture onSource={(source) => (captured = source)} />
        </TripsSourceProvider>,
      );
      expect(await captured.savedLists!.list()).toEqual([{ id: "l1" }]);
      expect(await captured.savedLists!.get("l1")).toEqual({ id: "l1", items: [] });
      expect(actions.getSavedListAction).toHaveBeenCalledWith("l1");
      actions.listSavedListsAction.mockResolvedValueOnce({ ok: false, code: "INTERNAL" });
      await expect(captured.savedLists!.list()).rejects.toThrow("INTERNAL");
      actions.getSavedListAction.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
      await expect(captured.savedLists!.get("other")).rejects.toThrow("NOT_FOUND");
    });

    it("covers every method of the port", () => {
      let captured!: TripsSource;
      render(
        <TripsSourceProvider>
          <Capture onSource={(source) => (captured = source)} />
        </TripsSourceProvider>,
      );
      expect([...WIRING.map(([name]) => name), "weather", "savedLists"].sort()).toEqual(
        Object.keys(captured).sort(),
      );
    });

    it.each(WIRING)("%s", async (_name, call, target, args) => {
      let captured!: TripsSource;
      render(
        <TripsSourceProvider>
          <Capture onSource={(source) => (captured = source)} />
        </TripsSourceProvider>,
      );
      for (const action of everyAction()) action.mockClear();
      await call(captured);
      expect(target()).toHaveBeenCalledTimes(1);
      expect(target()).toHaveBeenCalledWith(...args);
      for (const action of everyAction().filter((other) => other !== target()))
        expect(action).not.toHaveBeenCalled();
    });
  });
});
