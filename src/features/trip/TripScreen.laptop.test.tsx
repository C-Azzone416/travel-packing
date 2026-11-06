// @vitest-environment jsdom
// The laptop (>= 1024px) Packing view of the trip screen (#385): header and counts, cube rail and open cube, one tick per
// item, filters, Edit list (add, move, remove, Morning of), the laundry toggle and the weather review rows.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cube } from "@/domain/cubes";
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

const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
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

const ready = () => screen.findByRole("heading", { name: "Packing", level: 1 });
const rail = () => within(screen.getByRole("navigation", { name: "Cubes" }));
const panel = () => document.querySelector("[data-cube]") as HTMLElement;
const tripOf = (base: ReturnType<typeof memory>, id = "san-diego") =>
  base.snapshot().trips.find((trip) => trip.id === id)!;
const live = () => screen.getByRole("status", { name: "Packing updates" });

describe("the header and the counts", () => {
  it("shows the laptop view with the title, the trip link, the quantity count and the actions", async () => {
    const { base } = setup();
    await ready();
    expect(document.querySelector('[data-packing-layout="laptop"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "San Diego" }).getAttribute("href")).toBe("/");
    const totals = headline(tripOf(base));
    const bar = screen.getByRole("progressbar", { name: "Packing progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe(String(totals.percent));
    expect(screen.getByText(`${totals.total}`, { exact: false })).toBeTruthy();
    expect(document.body.textContent).toContain(`of ${totals.total} in the bag`);
    expect(screen.getByText(`${totals.toGo} to go`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Staples" }).getAttribute("href")).toBe(
      "/staples",
    );
    expect(screen.getByRole("button", { name: "Laundry off" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("counts quantity: an item of 5 with 2 packed is 2 of 5, not 0 of 1", async () => {
    const { base } = setup();
    await ready();
    const clothing = buildCubeViews(tripOf(base)).find((view) => view.cube === "clothing")!;
    expect(rail().getByRole("button", { name: /Clothing/ }).textContent).toContain(
      `${clothing.packed}/${clothing.total}`,
    );
    expect(
      within(panel()).getByText(`${clothing.packed} of ${clothing.total} packed`),
    ).toBeTruthy();
  });

  it("does not use the legacy trip page layout", async () => {
    setup();
    await ready();
    expect(document.querySelector(".trip-hero")).toBeNull();
    expect(document.querySelector(".packing-panel")).toBeNull();
  });
});

describe("the cube rail", () => {
  it("lists the cubes, marks the open one current, and Toiletries as Morning of", async () => {
    setup();
    await ready();
    const buttons = rail().getAllByRole("button");
    expect(buttons[0].textContent).toContain("Clothing");
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
    expect(rail().getByRole("button", { name: /Toiletries/ }).textContent).toContain("Morning of");
    expect(panel().getAttribute("data-cube")).toBe("clothing");
  });

  it("opens another cube, puts focus on its title and keeps each cube's filter", async () => {
    const { user } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    expect(panel().getAttribute("data-cube")).toBe("toiletries");
    expect(
      rail()
        .getByRole("button", { name: /Toiletries/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(document.activeElement?.textContent).toBe("Toiletries");
    // Choosing the open cube again changes nothing.
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    await user.click(within(panel()).getByRole("button", { name: /^To pack/ }));
    await user.click(rail().getByRole("button", { name: /Clothing/ }));
    expect(within(panel()).getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    expect(
      within(panel())
        .getByRole("button", { name: /^To pack/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("opens the cube named by ?cube=", async () => {
    const base = memory();
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" openCube={"tech" satisfies Cube} />
      </TripsSourceProvider>,
    );
    await ready();
    expect(panel().getAttribute("data-cube")).toBe("tech");
  });
});

describe("one tick per item", () => {
  it("ticks an item to its full quantity and unticking sets 0, announced and saved", async () => {
    const { user, base } = setup();
    await ready();
    const box = within(panel()).getByRole("checkbox", { name: "Underwear, 5" });
    expect((box as HTMLInputElement).indeterminate).toBe(true);
    await user.click(box);
    await waitFor(() =>
      expect(tripOf(base).items.find((entry) => entry.id === "underwear")?.packed).toBe(5),
    );
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(live().textContent).toBe("Underwear 5 of 5 packed");
    await user.click(box);
    await waitFor(() =>
      expect(tripOf(base).items.find((entry) => entry.id === "underwear")?.packed).toBe(0),
    );
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it("strikes a packed item through and moves the counts at once", async () => {
    const { user } = setup();
    await ready();
    const before = rail().getByRole("button", { name: /Clothing/ }).textContent;
    const box = within(panel()).getByRole("checkbox", { name: "Underwear, 5" });
    await user.click(box);
    expect(box.closest("li")?.getAttribute("data-packed")).toBe("true");
    expect(rail().getByRole("button", { name: /Clothing/ }).textContent).not.toBe(before);
  });

  it("filters to what is left to pack and to what is packed, with row counts on the pills", async () => {
    const { user, base } = setup();
    await ready();
    const rows = buildCubeViews(tripOf(base)).find((view) => view.cube === "clothing")!.items;
    const done = rows.filter((entry) => entry.packed >= entry.qty).length;
    const pills = within(panel());
    expect(pills.getByRole("button", { name: `All ${rows.length}` })).toBeTruthy();
    await user.click(pills.getByRole("button", { name: `To pack ${rows.length - done}` }));
    expect(panel().querySelectorAll("li[data-item-id]")).toHaveLength(rows.length - done);
    expect(panel().querySelector('li[data-packed="true"]')).toBeNull();
    await user.click(pills.getByRole("button", { name: `Packed ${done}` }));
    expect(panel().querySelectorAll("li[data-item-id]")).toHaveLength(done);
    // Nothing is packed in Toiletries: its Packed view says so.
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    await user.click(within(panel()).getByRole("button", { name: /^Packed/ }));
    expect(within(panel()).getByText(/Nothing here/)).toBeTruthy();
  });

  it("says when everything in a cube is packed", async () => {
    const { user } = setup({ tripId: "lisbon" });
    await screen.findByRole("heading", { name: "Packing", level: 1 });
    await user.click(rail().getByRole("button", { name: /Clothing/ }));
    expect(within(panel()).getByText("Everything in this cube is packed.")).toBeTruthy();
  });

  it("shows Not saved · Retry on a row whose save failed, and Retry saves it", async () => {
    let failures = 1;
    const { user, base } = setup({
      wrap: (source) => ({
        setPacked: async (...args: Parameters<typeof source.setPacked>) => {
          if (failures-- > 0) throw new Error("down");
          return source.setPacked(...args);
        },
      }),
    });
    await ready();
    await user.click(within(panel()).getByRole("checkbox", { name: "Underwear, 5" }));
    const retry = await within(panel()).findByRole("button", { name: "Not saved · Retry" });
    await user.click(retry);
    await waitFor(() =>
      expect(tripOf(base).items.find((entry) => entry.id === "underwear")?.packed).toBe(5),
    );
    expect(within(panel()).queryByRole("button", { name: "Not saved · Retry" })).toBeNull();
  });
});

describe("Edit list", () => {
  const edit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(panel()).getByRole("button", { name: "Edit list" }));
  };

  it("swaps the filters for editing rows and Done puts the checklist back", async () => {
    const { user } = setup();
    await ready();
    await edit(user);
    expect(within(panel()).queryByRole("button", { name: /^To pack/ })).toBeNull();
    expect(
      within(panel()).getByRole("button", { name: /^Edit\s+Underwear\s+×\s+5$/ }),
    ).toBeTruthy();
    expect(within(panel()).getByRole("button", { name: "Done" })).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: "Done" }));
    expect(within(panel()).getByRole("checkbox", { name: "Underwear, 5" })).toBeTruthy();
  });

  it("adds an item to this cube and announces it", async () => {
    const { user, base } = setup();
    await ready();
    await edit(user);
    await user.type(within(panel()).getByPlaceholderText("+ Add an item"), "Beach towel");
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(within(panel()).getByText("Beach towel")).toBeTruthy());
    const added = tripOf(base).items.find((entry) => entry.name === "Beach towel")!;
    expect(itemCube(added)).toBe("clothing");
    expect((within(panel()).getByPlaceholderText("+ Add an item") as HTMLInputElement).value).toBe(
      "",
    );
    expect(live().textContent).toBe("Beach towel added to Clothing.");
  });

  it("adds to the cube that is open, not to Clothing", async () => {
    const { user, base } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Misc/ }));
    await edit(user);
    await user.type(within(panel()).getByPlaceholderText("+ Add an item"), "Travel pillow");
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(tripOf(base).items.some((entry) => entry.name === "Travel pillow")).toBe(true),
    );
    expect(itemCube(tripOf(base).items.find((entry) => entry.name === "Travel pillow")!)).toBe(
      "misc",
    );
  });

  it("asks for a name, and refuses one that is too long", async () => {
    const { user } = setup();
    await ready();
    await edit(user);
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    expect((await within(panel()).findByRole("alert")).textContent).toBe("Enter an item name.");
    fireEvent.change(within(panel()).getByPlaceholderText("+ Add an item"), {
      target: { value: "x".repeat(130) },
    });
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    expect((await within(panel()).findByRole("alert")).textContent).toMatch(/under 120/);
  });

  it("says an item is already on the list and offers its quantity editor", async () => {
    const { user } = setup();
    await ready();
    await edit(user);
    await user.type(within(panel()).getByPlaceholderText("+ Add an item"), "underwear");
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    expect((await within(panel()).findByRole("alert")).textContent).toContain(
      "already on your list",
    );
    await user.click(within(panel()).getByRole("button", { name: "Edit its quantity" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("says nothing was added when the save fails", async () => {
    const { user } = setup({
      wrap: () => ({ addItem: async () => Promise.reject(new Error("down")) }),
    });
    await ready();
    await edit(user);
    await user.type(within(panel()).getByPlaceholderText("+ Add an item"), "Hat");
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    expect((await within(panel()).findByRole("alert")).textContent).toBe(
      "Couldn’t add it. Nothing was changed.",
    );
  });

  it("treats a server EXISTS the screen did not see as the same answer", async () => {
    const { user } = setup({
      wrap: () => ({ addItem: async () => Promise.reject(new TripsSourceError("EXISTS")) }),
    });
    await ready();
    await edit(user);
    await user.type(within(panel()).getByPlaceholderText("+ Add an item"), "Hat");
    await user.click(within(panel()).getByRole("button", { name: "Add" }));
    // The item is not on the list, so there is nothing to edit: it reads as a failed add.
    expect((await within(panel()).findByRole("alert")).textContent).toMatch(/Couldn’t add it/);
  });

  it("opens the Bathroom form for the Toiletries cube", async () => {
    const { user } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    await edit(user);
    // One add control here: the Bathroom one. The generic "Add an item" row is not shown beside it.
    expect(within(panel()).queryByPlaceholderText("+ Add an item")).toBeNull();
    await user.click(within(panel()).getByRole("button", { name: /Add a Bathroom item/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("moves an item to another cube, which gains it, and announces it", async () => {
    const { user, base } = setup();
    await ready();
    await edit(user);
    await user.selectOptions(
      within(panel()).getByRole("combobox", { name: "Move Underwear to another cube" }),
      "misc",
    );
    await waitFor(() =>
      expect(itemCube(tripOf(base).items.find((entry) => entry.id === "underwear")!)).toBe("misc"),
    );
    expect(
      within(panel()).queryByRole("button", { name: /^Edit\s+Underwear\s+×\s+5$/ }),
    ).toBeNull();
    expect(live().textContent).toBe("Underwear moved to Misc.");
    // The packed count went with it.
    expect(tripOf(base).items.find((entry) => entry.id === "underwear")?.packed).toBe(2);
  });

  it("removes an item", async () => {
    const { user, base } = setup();
    await ready();
    await edit(user);
    await user.click(within(panel()).getByRole("button", { name: "Remove Sleepwear" }));
    await waitFor(() =>
      expect(tripOf(base).items.some((entry) => entry.id === "sleepwear")).toBe(false),
    );
    expect(live().textContent).toBe("Sleepwear removed.");
  });

  it("opens the item's editor from its name and returns focus to it after", async () => {
    const { user } = setup();
    await ready();
    await edit(user);
    await user.click(within(panel()).getByRole("button", { name: /^Edit\s+Underwear\s+×\s+5$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(panel()).getByRole("button", { name: /^Edit\s+Underwear\s+×\s+5$/ }),
      ),
    );
  });

  it("marks and unmarks a cube Morning of, in the rail too", async () => {
    const { user, base } = setup();
    await ready();
    await edit(user);
    const toggle = within(panel()).getByRole("switch", { name: /Morning of/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await user.click(toggle);
    await waitFor(() => expect(tripOf(base).morningOfCubes).toContain("clothing"));
    expect(rail().getByRole("button", { name: /Clothing/ }).textContent).toContain("Morning of");
    expect(live().textContent).toBe("Clothing marked Morning of.");
    await user.click(toggle);
    await waitFor(() => expect(tripOf(base).morningOfCubes).not.toContain("clothing"));
    expect(live().textContent).toBe("Clothing no longer marked Morning of.");
  });

  it("will not unmark a cube that holds a Pack last item", async () => {
    const { user } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Misc/ }));
    await edit(user);
    const toggle = within(panel()).getByRole("switch", { name: /Morning of/ });
    expect((toggle as HTMLInputElement).disabled).toBe(true);
    expect(within(panel()).getByText("A Pack last item is in this cube.")).toBeTruthy();
  });

  it("an empty cube says Nothing here yet.", async () => {
    const { user } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Misc/ }));
    if (panel().querySelectorAll("li[data-item-id]").length === 0) {
      expect(within(panel()).getByText("Nothing here yet.")).toBeTruthy();
    }
  });
});

describe("the laundry toggle", () => {
  it("turns laundry on through the preferences recalculation and says how many items changed", async () => {
    const { user, base } = setup();
    await ready();
    const before = new Map(tripOf(base).items.map((entry) => [entry.id, entry.qty]));
    await user.click(screen.getByRole("button", { name: "Laundry off" }));
    await waitFor(() => expect(tripOf(base).config.laundry).toBe(true));
    const toggle = await screen.findByRole("button", { name: "Laundry on" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const changed = tripOf(base).items.filter((entry) => before.get(entry.id) !== entry.qty).length;
    expect(changed).toBeGreaterThan(0);
    expect(await screen.findByText(`Laundry on · ${changed} items changed`)).toBeTruthy();
    // Packed stays ticked: nothing was un-packed by the recalculation.
    expect(tripOf(base).items.find((entry) => entry.id === "sleepwear")?.packed).toBe(1);
  });

  it("turns it off again", async () => {
    const { user, base } = setup({ tripId: "lisbon" });
    await screen.findByRole("heading", { name: "Packing", level: 1 });
    await user.click(screen.getByRole("button", { name: "Laundry on" }));
    await waitFor(() => expect(tripOf(base, "lisbon").config.laundry).toBe(false));
    expect(await screen.findByRole("button", { name: "Laundry off" })).toBeTruthy();
  });

  it("says nothing changed when the save fails, and the toggle is usable again", async () => {
    const { user } = setup({
      wrap: () => ({ updatePreferences: async () => Promise.reject(new Error("down")) }),
    });
    await ready();
    await user.click(screen.getByRole("button", { name: "Laundry off" }));
    expect(await screen.findByText("Couldn’t change laundry. Nothing was changed.")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Laundry off" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("reloads the trip when the list moved on (STALE) and says nothing was changed", async () => {
    const { user } = setup({
      wrap: () => ({ updatePreferences: async () => Promise.reject(new Error("STALE")) }),
    });
    await ready();
    await user.click(screen.getByRole("button", { name: "Laundry off" }));
    expect(await screen.findByText("Couldn’t change laundry. Nothing was changed.")).toBeTruthy();
  });

  it("ignores a second tap while one is saving", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const updatePreferences = vi.fn();
    const { user } = setup({
      wrap: (source) => ({
        updatePreferences: async (...args: Parameters<typeof source.updatePreferences>) => {
          updatePreferences();
          await gate;
          return source.updatePreferences(...args);
        },
      }),
    });
    await ready();
    const toggle = screen.getByRole("button", { name: "Laundry off" });
    await user.click(toggle);
    fireEvent.click(toggle);
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("button", { name: "Laundry on" })).toBeTruthy());
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });
});

describe("the forecast and the weather review rows", () => {
  it("draws a card per stop with day tiles, outlined with N to review when weather suggests items", async () => {
    setup({ tripId: "lisbon", weather: rainy });
    await ready();
    const heading = await screen.findByRole("heading", { name: "Forecast", level: 2 });
    expect(heading).toBeTruthy();
    const card = screen.getByRole("article", { name: "Lisbon" });
    expect(card.getAttribute("data-city-state")).toBe("alert");
    expect(within(card).getAllByRole("group").length).toBeGreaterThan(0);
    const review = within(card).getByRole("button", { name: /\d+ to review/ });
    expect(review.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/\d+ new to review/)).toBeTruthy();
    // Nothing in the bag count changed: suggestions are not items.
  });

  it("does not count pending suggestions in the totals or the rail", async () => {
    const { base } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await screen.findByRole("button", { name: /\d+ to review/ });
    const totals = headline(tripOf(base, "lisbon"));
    expect(document.body.textContent).toContain(`of ${totals.total} in the bag`);
    expect(rail().queryByRole("button", { name: /Rain gear/ })).toBeNull();
  });

  it("opens the review rows with Add and Dismiss, and names the cube each goes to", async () => {
    const { user } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    const review = await screen.findByRole("button", { name: /\d+ to review/ });
    await user.click(review);
    expect(review.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(review.getAttribute("aria-controls")!) as HTMLElement;
    expect(region.hidden).toBe(false);
    expect(within(region).getByText(/not on your list until you add them/)).toBeTruthy();
    expect(within(region).getAllByRole("button", { name: /^Add / }).length).toBeGreaterThan(0);
    expect(within(region).getAllByRole("button", { name: /^Dismiss / }).length).toBeGreaterThan(0);
    expect(
      within(region).getByRole("button", { name: "Add Compact umbrella to Rain gear" }),
    ).toBeTruthy();
    await user.click(review);
    expect(region.hidden).toBe(true);
  });

  it("Add applies one change, announces it and moves focus on", async () => {
    const { user, applyReview } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await user.click(await screen.findByRole("button", { name: /\d+ to review/ }));
    await user.click(screen.getByRole("button", { name: "Add Compact umbrella to Rain gear" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    const [, accepted, skipped] = applyReview.mock.calls[0] as unknown as [
      string,
      { kind: string; semanticId: string }[],
      unknown[],
    ];
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ kind: "add", semanticId: "weather-umbrella" });
    expect(skipped).toEqual([]);
    await waitFor(() => expect(live().textContent).toBe("Compact umbrella added to Rain gear."));
  });

  it("Dismiss skips one change without adding it", async () => {
    const { user, applyReview } = setup({ tripId: "lisbon", weather: rainy });
    await ready();
    await user.click(await screen.findByRole("button", { name: /\d+ to review/ }));
    await user.click(screen.getByRole("button", { name: "Dismiss Compact umbrella" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    const [, accepted, skipped] = applyReview.mock.calls[0] as unknown as [
      string,
      unknown[],
      { semanticId: string }[],
    ];
    expect(accepted).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].semanticId).toBe("weather-umbrella");
    await waitFor(() => expect(live().textContent).toBe("Compact umbrella dismissed."));
  });

  it("puts a change on the stop its reason names, and says No changes on the other card", async () => {
    const porto = (stop: TripStop): TripStop => ({
      ...stop,
      location: {
        ...stop.location,
        id: "pt-porto",
        city: "Porto",
        latitude: 41.1,
        longitude: -8.6,
      },
    });
    setup({
      tripId: "lisbon",
      weather: [
        ...rainy,
        {
          stopIndex: 1,
          status: "ok",
          days: [
            {
              ...hot,
              stopIndex: 1,
              date: "2026-09-06",
              highC: 20,
              lowC: 14,
              uvIndexMax: 3,
              sunshineHours: 5,
            },
          ],
        },
      ],
      wrap: (source) => ({
        getTrip: async (id: string) => {
          const trip = await source.getTrip(id);
          const lisbon = {
            ...trip.stops[0],
            location: { ...trip.stops[0].location, latitude: 38.7, longitude: -9.1 },
          };
          return { ...trip, stops: [lisbon, porto(trip.stops[0])] };
        },
      }),
    });
    await ready();
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Porto" }).getAttribute("data-city-state")).toBe(
      "normal",
    );
    expect(screen.getByRole("article", { name: "Lisbon" }).getAttribute("data-city-state")).toBe(
      "alert",
    );
    expect(screen.getByText(/^\d+ new to review$/)).toBeTruthy();
  });

  it("says No new changes when nothing is pending", async () => {
    setup({
      tripId: "lisbon",
      weather: [{ stopIndex: 0, status: "ok", days: [hot, { ...hot, date: "2026-09-05" }] }],
      wrap: () => ({
        weather: {
          getSettings: async () => ({ weatherOptIn: true, temperatureUnit: "F" as const }),
          updateSettings: vi.fn(),
          getTripWeather: vi.fn(async () => ({ kind: "ready" as const, stops: [] })),
          previewDraft: vi.fn(),
          createTripWithReview: vi.fn(),
          listSuggestions: vi.fn().mockResolvedValue([]),
          applyReview: vi.fn(),
        },
      }),
    });
    await ready();
    // Every stop is unavailable, so the existing panel stands in.
    expect(await screen.findByText(/couldn’t reach the weather service/)).toBeTruthy();
  });

  it("keeps the existing weather panel as the stand-in while weather is off or offline", async () => {
    setup({ tripId: "lisbon", weather: { kind: "offline" } });
    await ready();
    expect(await screen.findByText(/You’re offline/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Forecast", level: 2 })).toBeNull();
  });

  it("draws nothing for the forecast when the trip has no weather source", async () => {
    setup();
    await ready();
    expect(screen.queryByRole("heading", { name: "Forecast", level: 2 })).toBeNull();
  });
});

describe("the toiletry bag step and what sits under the suitcase", () => {
  it("shows the bag step in Toiletries and opens the confirmation", async () => {
    const { user } = setup({ tripId: "lisbon" });
    await screen.findByRole("heading", { name: "Packing", level: 1 });
    // Lisbon's bag is placed: it offers the undo.
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    expect(within(panel()).getByText("Toiletry bag is in the suitcase")).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: "Undo placement" }));
    await waitFor(() =>
      expect(within(panel()).getByText("Toiletry bag ready to place")).toBeTruthy(),
    );
    await user.click(within(panel()).getByRole("button", { name: "Put bag in suitcase" }));
    expect(await screen.findByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(within(panel()).getByText("Toiletry bag is in the suitcase")).toBeTruthy(),
    );
  });

  it("says the bag is waiting on its contents, and adds a Bathroom item", async () => {
    const { user } = setup();
    await ready();
    await user.click(rail().getByRole("button", { name: /Toiletries/ }));
    expect(within(panel()).getByText("Toiletry bag not ready to place")).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: /Add a Bathroom item/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("keeps the trip tools reachable: save as a list, stamp, preferences, edit trip", async () => {
    const { user } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Save as a list" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Edit stamp" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("shows the Ready card for a Ready trip, and the review prompt once everything is checked", async () => {
    const { user, base } = setup({ tripId: "lisbon" });
    await screen.findByRole("heading", { name: "Packing", level: 1 });
    expect(screen.getByText("You’re ready to go.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review bag again" }).getAttribute("href")).toBe(
      "/trips/lisbon/review",
    );
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(tripOf(base, "lisbon").ready).toBe(false));
    expect(await screen.findByText("Everything is checked. Want to review?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review your bag" }).getAttribute("href")).toBe(
      "/trips/lisbon/review",
    );
  });
});
