// @vitest-environment jsdom
// The phone (below 1024px) Packing view "Pack mode" (#386): the header and the counts, the cube bar, the one-city forecast with
// its review rows, the filter pills and the pencil, "All in" and "Next", and the layout switch at 1023/1024px.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import { itemCube } from "@/domain/cubes";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  createMemoryTripsSource,
  TripsSourceError,
  type TripsSource,
} from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { renderInApp } from "@/test/providers";
import { buildCubeViews, headline } from "./packing/packing-model";
import { TripScreen } from "./TripScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push }),
}));

// The viewport width the test pretends to have: a `(min-width: Npx)` query matches when the width is at least N.
let width = 390;
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  width = 390;
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width: (\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return width >= min;
      },
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.clearAllMocks();
});

const hot: DayWeather = {
  date: "2026-09-04",
  stopIndex: 0,
  source: "forecast",
  highC: 31,
  lowC: 21,
  precipProbability: 0,
  precipMm: 0,
  snowCm: 0,
  uvIndexMax: 9,
  sunshineHours: 11,
};
const rainy: StopWeather[] = [
  {
    stopIndex: 0,
    status: "ok",
    days: [
      { ...hot, precipProbability: 0.8, precipMm: 12, highC: 15, lowC: 8 },
      { ...hot, date: "2026-09-05", precipProbability: 0.8, precipMm: 12, highC: 15, lowC: 8 },
    ],
  },
];

interface Options {
  tripId?: string;
  weather?: StopWeather[] | { kind: "offline" };
  optedIn?: boolean;
  /** Wrap the source, to make one call fail. */
  wrap?: (base: ReturnType<typeof memory>) => Partial<TripsSource>;
}

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

function setup(options: Options = {}) {
  const base = memory();
  const applyReview = vi.fn(async (id: string) => base.acceptWeather(id));
  const withCoordinates = (trip: Awaited<ReturnType<typeof base.getTrip>>) => ({
    ...trip,
    stops: trip.stops.map((stop) => ({
      ...stop,
      location: { ...stop.location, latitude: 32.7, longitude: -117.1 },
    })),
  });
  const source: TripsSource = {
    ...base,
    ...(options.weather
      ? {
          getTrip: async (id: string) => withCoordinates(await base.getTrip(id)),
          weather: {
            getSettings: async () => ({
              weatherOptIn: options.optedIn ?? true,
              temperatureUnit: "F" as const,
            }),
            updateSettings: vi.fn(),
            getTripWeather: vi.fn(async () =>
              Array.isArray(options.weather)
                ? { kind: "ready" as const, stops: options.weather }
                : options.weather,
            ),
            previewDraft: vi.fn(),
            createTripWithReview: vi.fn(),
            listSuggestions: vi.fn().mockResolvedValue([]),
            applyReview,
          },
        }
      : {}),
    ...(options.wrap ? options.wrap(base) : {}),
  } as unknown as TripsSource;
  const user = userEvent.setup();
  const tripId = options.tripId ?? "san-diego";
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId={tripId} />
    </TripsSourceProvider>,
  );
  return { user, base, applyReview, tripId };
}

const ready = () => screen.findByRole("heading", { name: "Pack mode", level: 1 });
const bar = () => within(screen.getByRole("navigation", { name: "Cubes" }));
const panel = () => document.querySelector("[data-cube]") as HTMLElement;
const tripOf = (base: ReturnType<typeof memory>, id = "san-diego") =>
  base.snapshot().trips.find((trip) => trip.id === id)!;
const live = () => screen.getByRole("status", { name: "Packing updates" });
const cubeLive = () => screen.getByRole("status", { name: "Cube" });
const allIn = () => screen.getByRole("button", { name: /^All in/ });

describe("the layout switch", () => {
  it("draws the phone layout below 1024px, including 1023, and the laptop layout from 1024", async () => {
    for (const [at, layout] of [
      [390, "phone"],
      [320, "phone"],
      [195, "phone"],
      [1023, "phone"],
      [1024, "laptop"],
    ] as const) {
      width = at;
      setup();
      await screen.findByRole("heading", {
        name: layout === "phone" ? "Pack mode" : "Packing",
        level: 1,
      });
      expect(document.querySelector(`[data-packing-layout="${layout}"]`), `${at}px`).toBeTruthy();
      cleanup();
    }
  });

  it("has no trace of the old page: no hero, no sections panel, no steppers", async () => {
    setup();
    await ready();
    for (const legacy of [
      ".trip-hero",
      ".packing-top",
      ".trip-layout",
      ".sections-panel",
      ".qty-stepper",
    ])
      expect(document.querySelector(legacy), legacy).toBeNull();
  });
});

describe("the header", () => {
  it("shows Pack mode, the Laundry toggle and the count by quantity, with no back link", async () => {
    const { base } = setup();
    await ready();
    const totals = headline(tripOf(base));
    expect(screen.getByRole("button", { name: "Laundry off" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByText(`${totals.packed} of ${totals.total} in the bag`)).toBeTruthy();
    expect(document.querySelector('[data-packing-layout="phone"] header')?.textContent).toContain(
      `${totals.packed} / ${totals.total}`,
    );
    expect(screen.queryByRole("link", { name: /All trips|San Diego/ })).toBeNull();
  });

  it("the Laundry toggle saves the trip's laundry preference and says how many items changed", async () => {
    const { user, base } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Laundry off" }));
    await waitFor(() => expect(tripOf(base).config.laundry).toBe(true));
    expect(screen.getByRole("button", { name: "Laundry on" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText(
        /^Laundry on · \d+ items? changed$/,
      ),
    ).toBeTruthy();
  });

  it("a failed Laundry change says nothing was changed and leaves the toggle as it was", async () => {
    const { user, base } = setup({
      wrap: () => ({ updatePreferences: () => Promise.reject(new Error("down")) }),
    });
    await ready();
    await user.click(screen.getByRole("button", { name: "Laundry off" }));
    expect(await screen.findByText("Couldn’t change laundry. Nothing was changed.")).toBeTruthy();
    expect(tripOf(base).config.laundry).toBe(false);
    expect(screen.getByRole("button", { name: "Laundry off" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});

describe("the cube bar", () => {
  it("is a labelled list of cube buttons, the open one current, Toiletries marked Morning of", async () => {
    const { base } = setup();
    await ready();
    const chips = bar().getAllByRole("button");
    const views = buildCubeViews(tripOf(base));
    expect(chips).toHaveLength(views.length);
    expect(chips[0].textContent).toContain("Clothing");
    expect(chips[0].getAttribute("aria-current")).toBe("true");
    expect(chips[1].getAttribute("aria-current")).toBeNull();
    expect(chips[0].getAttribute("aria-pressed")).toBeNull();
    expect(chips[0].getAttribute("aria-controls")).toBe(panel().id);
    expect(bar().getByRole("button", { name: /Toiletries/ }).textContent).toContain("Morning of");
    // Counts are quantity: "9/14", spoken as "9 of 14 packed".
    expect(chips[0].textContent).toContain(`${views[0].packed}/${views[0].total}`);
    expect(chips[0].textContent).toContain(`${views[0].packed} of ${views[0].total} packed`);
  });

  it("opens another cube, moves focus to its title, and keeps each cube's filter", async () => {
    const { user } = setup();
    await ready();
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    expect(panel().getAttribute("data-cube")).toBe("toiletries");
    expect(
      bar()
        .getByRole("button", { name: /Toiletries/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(document.activeElement?.textContent).toBe("Toiletries");
    // Choosing the open cube again changes nothing (focus stays where it is).
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    await user.click(screen.getByRole("button", { name: /^To pack/ }));
    await user.click(bar().getByRole("button", { name: /Clothing/ }));
    expect(screen.getByRole("button", { name: /^All \d/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    expect(screen.getByRole("button", { name: /^To pack/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("opens the cube named by ?cube=", async () => {
    const base = memory();
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" openCube="tech" />
      </TripsSourceProvider>,
    );
    await ready();
    expect(panel().getAttribute("data-cube")).toBe("tech");
  });

  it("scrolls the open cube's chip to the middle of the bar", async () => {
    const offsets = vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(300);
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    const wide = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);
    try {
      setup();
      await ready();
      const list = screen.getByRole("navigation", { name: "Cubes" }).querySelector("ul")!;
      expect(list.scrollLeft).toBe(300 - (200 - 80) / 2);
    } finally {
      offsets.mockRestore();
      client.mockRestore();
      wide.mockRestore();
    }
  });
});

describe("the filter pills, the pencil and the suitcase", () => {
  it("draws the pills above the suitcase (not in it) and counts rows", async () => {
    const { base } = setup();
    await ready();
    const rows = buildCubeViews(tripOf(base))[0].items;
    const pills = screen.getByRole("group", { name: "Packing list view" });
    expect(panel().contains(pills)).toBe(false);
    expect(within(pills).getByRole("button", { name: `All ${rows.length}` })).toBeTruthy();
    expect(within(pills).getByRole("button", { name: "Edit list" })).toBeTruthy();
  });

  it("titles the open cube 'n of m' (no 'packed'), lists one column, and keeps the hint line off", async () => {
    const { base } = setup();
    await ready();
    const clothing = buildCubeViews(tripOf(base))[0];
    expect(within(panel()).getByText(`${clothing.packed} of ${clothing.total}`)).toBeTruthy();
    expect(panel().textContent).not.toContain("Tick as you pack");
    expect(panel().querySelectorAll("li[data-item-id]")).toHaveLength(clothing.items.length);
  });

  it("still says what a state means: everything packed, nothing here", async () => {
    const { user } = setup({ tripId: "lisbon" });
    await ready();
    expect(within(panel()).getByText("Everything in this cube is packed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^To pack/ }));
    expect(within(panel()).getByText("Nothing here.")).toBeTruthy();
  });

  it("filters to what is left and to what is packed", async () => {
    const { user, base } = setup();
    await ready();
    const rows = buildCubeViews(tripOf(base))[0].items;
    const done = rows.filter((entry) => entry.packed >= entry.qty).length;
    await user.click(screen.getByRole("button", { name: `To pack ${rows.length - done}` }));
    expect(panel().querySelectorAll("li[data-item-id]")).toHaveLength(rows.length - done);
    await user.click(screen.getByRole("button", { name: `Packed ${done}` }));
    expect(panel().querySelectorAll("li[data-item-id]")).toHaveLength(done);
  });

  it("the pencil opens Edit list on the phone: Done replaces it, rows can be edited, moved and removed", async () => {
    const { user, base } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit list" }));
    expect(panel().getAttribute("data-editing")).toBe("true");
    expect(screen.queryByRole("button", { name: /^To pack/ })).toBeNull();
    const move = within(panel()).getByRole("combobox", { name: "Move Underwear to another cube" });
    await user.selectOptions(move, "Misc");
    await waitFor(() => {
      const moved = tripOf(base).items.find((entry) => entry.id === "underwear")!;
      expect(itemCube(moved)).toBe("misc");
    });
    await user.click(within(panel()).getByRole("button", { name: "Remove Socks" }));
    await waitFor(() =>
      expect(tripOf(base).items.some((entry) => entry.id === "socks")).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(panel().getAttribute("data-editing")).toBeNull();
  });

  it("switching cube leaves Edit list", async () => {
    const { user } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit list" }));
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    expect(panel().getAttribute("data-editing")).toBeNull();
  });
});

describe("Next", () => {
  it("goes to the next cube in bar order, moves focus to its title and says so politely", async () => {
    const { user, base } = setup();
    await ready();
    const views = buildCubeViews(tripOf(base));
    expect(screen.getByRole("button", { name: `Next: ${views[1].label}` })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Next: / }));
    expect(panel().getAttribute("data-cube")).toBe(views[1].cube);
    expect(document.activeElement?.textContent).toBe(views[1].label);
    expect(cubeLive().textContent).toBe(
      `${views[1].label}, ${views[1].packed} of ${views[1].total} packed.`,
    );
    expect(cubeLive().getAttribute("role")).toBe("status");
  });

  it("on the last cube it reads Done and goes to Home", async () => {
    const { user, base } = setup();
    await ready();
    const views = buildCubeViews(tripOf(base));
    await user.click(
      bar().getByRole("button", { name: new RegExp(`^${views[views.length - 1].label}`) }),
    );
    const done = screen.getByRole("link", { name: "Done" });
    expect(done.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: /^Next: / })).toBeNull();
  });

  it("a plain Next does not say anything on the chip bar's own selection", async () => {
    const { user } = setup();
    await ready();
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    expect(cubeLive().textContent).toBe("");
  });
});

describe("All in", () => {
  const unpackedIn = (base: ReturnType<typeof memory>, cube: string) =>
    buildCubeViews(tripOf(base))
      .find((view) => view.cube === cube)!
      .items.filter((entry) => entry.packed < entry.qty);

  it("packs every unpacked item of the open cube in ONE change, announces it, offers Undo and moves focus to Next", async () => {
    const setPackedMany = vi.fn();
    const setPacked = vi.fn();
    const { user, base } = setup({
      wrap: (source) => ({
        setPackedMany: (...args: Parameters<typeof source.setPackedMany>) => (
          setPackedMany(args[1]),
          source.setPackedMany(...args)
        ),
        setPacked: (...args: Parameters<typeof source.setPacked>) => (
          setPacked(),
          source.setPacked(...args)
        ),
      }),
    });
    await ready();
    const before = unpackedIn(base, "clothing");
    expect(before.length).toBeGreaterThan(1);
    const otherBefore = JSON.stringify(
      tripOf(base).items.filter((entry) => itemCube(entry) !== "clothing"),
    );
    await user.click(allIn());
    await waitFor(() => expect(unpackedIn(base, "clothing")).toHaveLength(0));
    expect(setPackedMany).toHaveBeenCalledTimes(1);
    expect(setPacked).not.toHaveBeenCalled();
    expect(setPackedMany.mock.calls[0][0]).toEqual(
      before.map((entry) => ({ itemId: entry.id, packed: entry.qty })),
    );
    expect(
      JSON.stringify(tripOf(base).items.filter((entry) => itemCube(entry) !== "clothing")),
    ).toBe(otherBefore);
    expect(live().textContent).toBe(`Packed ${before.length} items in Clothing.`);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText(
        `Packed ${before.length} items`,
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Next: / }));
    expect(allIn().hasAttribute("disabled")).toBe(true);
  });

  it("Undo puts every item back to the count it had (partly packed ones too), as one change", async () => {
    const setPackedMany = vi.fn();
    const { user, base } = setup({
      wrap: (source) => ({
        setPackedMany: (...args: Parameters<typeof source.setPackedMany>) => (
          setPackedMany(args[1]),
          source.setPackedMany(...args)
        ),
      }),
    });
    await ready();
    const before = unpackedIn(base, "clothing").map((entry) => ({
      id: entry.id,
      packed: entry.packed,
    }));
    expect(before.some((entry) => entry.packed > 0)).toBe(true);
    await user.click(allIn());
    await waitFor(() => expect(unpackedIn(base, "clothing")).toHaveLength(0));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(unpackedIn(base, "clothing")).toHaveLength(before.length));
    expect(setPackedMany).toHaveBeenCalledTimes(2);
    expect(setPackedMany.mock.calls[1][0]).toEqual(
      before.map((entry) => ({ itemId: entry.id, packed: entry.packed })),
    );
    for (const entry of before)
      expect(tripOf(base).items.find((item) => item.id === entry.id)?.packed).toBe(entry.packed);
    expect(live().textContent).toBe("Clothing put back.");
  });

  it("a failed Undo says nothing was changed", async () => {
    let calls = 0;
    const { user } = setup({
      wrap: (source) => ({
        setPackedMany: (...args: Parameters<typeof source.setPackedMany>) =>
          ++calls === 2 ? Promise.reject(new Error("down")) : source.setPackedMany(...args),
      }),
    });
    await ready();
    await user.click(allIn());
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn’t undo. Nothing was changed.")).toBeTruthy();
  });

  it("leaves the cube exactly as it was when the save fails, and says so (no half-packed cube)", async () => {
    const { user, base } = setup({
      wrap: () => ({ setPackedMany: () => Promise.reject(new Error("offline")) }),
    });
    await ready();
    const before = JSON.stringify(tripOf(base).items);
    await user.click(allIn());
    expect(await screen.findByText("Couldn’t pack Clothing. Nothing was changed.")).toBeTruthy();
    expect(JSON.stringify(tripOf(base).items)).toBe(before);
    // No row was ticked on screen either: every checkbox still reflects the stored count.
    for (const entry of unpackedIn(base, "clothing")) {
      const box = within(
        panel().querySelector(`[data-item-id="${entry.id}"]`) as HTMLElement,
      ).getByRole("checkbox") as HTMLInputElement;
      expect(box.checked).toBe(false);
    }
    expect(allIn().hasAttribute("disabled")).toBe(false);
    // Focus is not pulled to Next: nothing happened.
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: /^Next: / }));
  });

  it("packs what the filter hides too, and is disabled once the cube is complete", async () => {
    const { user, base } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: /^Packed \d/ }));
    await user.click(allIn());
    await waitFor(() => expect(unpackedIn(base, "clothing")).toHaveLength(0));
    expect(allIn().hasAttribute("disabled")).toBe(true);
  });

  it("is disabled in a cube that is already complete", async () => {
    setup({ tripId: "lisbon" });
    await ready();
    expect(allIn().hasAttribute("disabled")).toBe(true);
  });

  it("ignores a second press while the first is saving", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const setPackedMany = vi.fn();
    const { user } = setup({
      wrap: (source) => ({
        setPackedMany: async (...args: Parameters<typeof source.setPackedMany>) => {
          setPackedMany();
          await gate;
          return source.setPackedMany(...args);
        },
      }),
    });
    await ready();
    await user.click(allIn());
    fireEvent.click(allIn());
    await act(async () => release());
    await waitFor(() => expect(allIn().hasAttribute("disabled")).toBe(true));
    expect(setPackedMany).toHaveBeenCalledTimes(1);
  });

  it("finishing the Bathroom contents with All in opens the bag prompt, like the last tick does", async () => {
    const { user } = setup();
    await ready();
    await user.click(bar().getByRole("button", { name: /Toiletries/ }));
    await user.click(allIn());
    expect(await screen.findByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeTruthy();
  });
});

describe("one city's forecast at a time", () => {
  const tour = (cities = ["Lisbon", "Porto"]) => ({
    tripId: "lisbon",
    wrap: (source: ReturnType<typeof memory>) => ({
      getTrip: async (id: string) => {
        const trip = await source.getTrip(id);
        const stops: TripStop[] = cities.map((city, index) => ({
          ...trip.stops[0],
          location: {
            ...trip.stops[0].location,
            id: `pt-${city.toLowerCase()}`,
            city,
            latitude: 38.7 + index,
            longitude: -9.1,
          },
        }));
        return { ...trip, stops };
      },
    }),
  });
  const dry: StopWeather = {
    stopIndex: 1,
    status: "ok",
    days: [{ ...hot, stopIndex: 1, date: "2026-09-06", highC: 20, lowC: 14 }],
  };

  it("a single stop shows its name and tiles, no city toggle", async () => {
    setup({ tripId: "lisbon", weather: rainy });
    await ready();
    expect(await screen.findByRole("heading", { name: "Lisbon", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "City" })).toBeNull();
    expect(screen.getByRole("list", { name: "Daily forecast for Lisbon" })).toBeTruthy();
    const forecast = screen.getByRole("region", { name: "Forecast" });
    expect(forecast.getAttribute("data-forecast-state")).toBe("alert");
    expect(
      within(forecast).getByRole("link", { name: "Weather data by Open-Meteo.com" }),
    ).toBeTruthy();
  });

  it("two stops are a city toggle with a dot on the city that has changes, and the changed city is shown first", async () => {
    setup({ ...tour(), weather: [...rainy, dry] });
    await ready();
    const tabs = await screen.findByRole("tablist", { name: "City" });
    const [lisbon, porto] = within(tabs).getAllByRole("tab");
    expect(lisbon.getAttribute("aria-selected")).toBe("true");
    expect(lisbon.textContent).toContain("has changes to review");
    expect(porto.getAttribute("aria-selected")).toBe("false");
    expect(porto.textContent).not.toContain("has changes");
    expect(lisbon.querySelector('[aria-hidden="true"]')).toBeTruthy();
    // Only the open city's tiles are on screen.
    expect(screen.getByRole("list", { name: "Daily forecast for Lisbon" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Daily forecast for Porto" })).toBeNull();
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(lisbon.id);
  });

  it("the toggle is keyboard operable: arrows wrap, Home and End jump, one tab stop", async () => {
    const { user } = setup({ ...tour(), weather: [...rainy, dry] });
    await ready();
    const [lisbon, porto] = within(
      await screen.findByRole("tablist", { name: "City" }),
    ).getAllByRole("tab");
    expect(lisbon.getAttribute("tabindex")).toBe("0");
    expect(porto.getAttribute("tabindex")).toBe("-1");
    lisbon.focus();
    await user.keyboard("{ArrowRight}");
    expect(porto.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(porto);
    expect(screen.getByRole("list", { name: "Daily forecast for Porto" })).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(lisbon.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowLeft}");
    expect(porto.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(lisbon.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(porto.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("a");
    expect(porto.getAttribute("aria-selected")).toBe("true");
    await user.click(lisbon);
    expect(lisbon.getAttribute("aria-selected")).toBe("true");
  });

  it("opens the review rows under the tiles: 'New: rain …', Add and Dismiss, and names the cube", async () => {
    const { user } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    const review = await screen.findByRole("button", { name: /\d+ to review/ });
    expect(review.getAttribute("aria-expanded")).toBe("false");
    await user.click(review);
    expect(review.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(review.getAttribute("aria-controls")!) as HTMLElement;
    expect(region.hidden).toBe(false);
    expect(within(region).getByText(/^New: /)).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: "Add Compact umbrella to Rain gear" }),
    ).toBeTruthy();
    await user.click(review);
    expect(region.hidden).toBe(true);
  });

  it("Add applies one change and announces it", async () => {
    const { user, applyReview } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await user.click(await screen.findByRole("button", { name: /\d+ to review/ }));
    await user.click(screen.getByRole("button", { name: "Add Compact umbrella to Rain gear" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(live().textContent).toBe("Compact umbrella added to Rain gear."));
  });

  it("Dismiss skips one change without adding it", async () => {
    const { user, applyReview } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await user.click(await screen.findByRole("button", { name: /\d+ to review/ }));
    await user.click(screen.getByRole("button", { name: "Dismiss Compact umbrella" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(live().textContent).toBe("Compact umbrella dismissed."));
  });

  it("does not count pending suggestions in the totals or the bar", async () => {
    const { base } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await screen.findByRole("button", { name: /\d+ to review/ });
    const totals = headline(tripOf(base, "lisbon"));
    expect(screen.getByText(`${totals.packed} of ${totals.total} in the bag`)).toBeTruthy();
    expect(bar().queryByRole("button", { name: /Rain gear/ })).toBeNull();
  });

  it("with weather off or offline the card is the existing Weather panel", async () => {
    setup({ tripId: "lisbon", weather: { kind: "offline" } });
    await ready();
    expect(await screen.findByText(/You’re offline\. Weather will load/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Forecast" })).toBeNull();
  });
});

describe("text zoom and the fixed-height layout", () => {
  const realObserver = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = realObserver;
    vi.restoreAllMocks();
  });

  it("is not zoomed where ResizeObserver does not exist", async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    setup();
    await ready();
    expect(document.querySelector("[data-zoomed]")).toBeNull();
  });

  it("marks the page zoomed while the root font size is larger than 16px, and clears it again", async () => {
    let notify: () => void = () => {};
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    let px = 16;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width: px }) as DOMRect,
    );
    setup();
    await ready();
    expect(document.querySelector("[data-zoomed]")).toBeNull();
    px = 32;
    act(() => notify());
    expect(
      document.querySelector('[data-packing-layout="phone"]')?.getAttribute("data-zoomed"),
    ).toBe("true");
    px = 16;
    act(() => notify());
    expect(document.querySelector("[data-zoomed]")).toBeNull();
  });
});

describe("the tools under the suitcase", () => {
  it("keeps Edit trip, Save as a list, Change theme, Edit stamp and Edit preferences reachable", async () => {
    setup();
    await ready();
    for (const name of [
      "Edit trip",
      "Save as a list",
      "Change theme",
      "Edit stamp",
      "Edit preferences",
    ])
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
  });

  it("a trip with a TripsSourceError on load shows the same error screen", async () => {
    const base = memory();
    renderInApp(
      <TripsSourceProvider
        source={{ ...base, getTrip: () => Promise.reject(new TripsSourceError("NOT_FOUND")) }}
      >
        <TripScreen tripId="nope" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
  });
});
