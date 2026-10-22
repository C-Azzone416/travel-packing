// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import type { LocationProvider } from "@/domain/location-provider";
import { LocationProviderProvider } from "./LocationProviderContext";
import { TripFlow } from "./TripFlow";
import { TripsSourceProvider } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";
import type { StopWeather } from "@/domain/weather/types";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push }),
}));

function setup(
  props: { copyId?: string; allowCustom?: boolean; getToday?: () => string } = {},
  wrap?: (base: ReturnType<typeof memory>) => TripsSource,
) {
  push.mockClear();
  const base = memory();
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripFlow {...props} />
    </TripsSourceProvider>,
  );
  return { user, source: base };
}

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

function withWeather(base: ReturnType<typeof memory>, optedIn = false) {
  let weatherOptIn = optedIn;
  const stops: StopWeather[] = [
    {
      stopIndex: 0,
      status: "ok",
      days: [
        {
          date: "2026-11-13",
          stopIndex: 0,
          source: "forecast",
          highC: 20,
          lowC: 14,
          precipProbability: 0.8,
          precipMm: 4,
          snowCm: 0,
          uvIndexMax: 1,
          sunshineHours: 1,
        },
      ],
    },
  ];
  const previewDraft = vi.fn().mockResolvedValue({ kind: "ready", stops });
  const updateSettings = vi.fn(async (change: { weatherOptIn?: boolean }) => {
    weatherOptIn = change.weatherOptIn ?? weatherOptIn;
    return { weatherOptIn, temperatureUnit: "F" as const };
  });
  const applyReview = vi.fn(async (tripId: string, _accepted: unknown[], _skipped: unknown[]) => {
    void [_accepted, _skipped];
    return base.acceptWeather(tripId);
  });
  const createTripWithReview = vi.fn(
    async (draft: Parameters<typeof base.createTrip>[0], _accepted: unknown[]) => {
      void _accepted;
      const trip = await base.createTrip(draft);
      return (await base.acceptWeather(trip.id)).trip;
    },
  );
  const source: TripsSource = {
    ...base,
    weather: {
      getSettings: async () => ({ weatherOptIn, temperatureUnit: "F" }),
      updateSettings,
      getTripWeather: vi.fn().mockResolvedValue({ kind: "ready", stops }),
      previewDraft,
      createTripWithReview,
      listSuggestions: vi.fn().mockResolvedValue([]),
      applyReview,
    },
  };
  return { source, previewDraft, updateSettings, applyReview, createTripWithReview };
}

const search = () => screen.getByRole("combobox", { name: "Destination search" });
const cont = () => screen.getByRole("button", { name: "Continue to packing preferences" });
const leave = () => screen.getByLabelText("Leave") as HTMLInputElement;
const ret = () => screen.getByLabelText("Return") as HTMLInputElement;

async function fillDetails(
  user: ReturnType<typeof userEvent.setup>,
  place = "lisbon",
  start = "2026-11-12",
  end = "2026-11-16",
) {
  await user.type(search(), place);
  await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
  fireEvent.change(leave(), { target: { value: start } });
  fireEvent.change(ret(), { target: { value: end } });
}

async function toShapeStep(user: ReturnType<typeof userEvent.setup>, place?: string) {
  await fillDetails(user, place);
  await user.click(cont());
  await screen.findByRole("heading", { name: "Shape the list" });
}

describe("step 1: confirm the trip", () => {
  it("starts empty as a draft, with Continue unavailable and the reason in text", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("New trip")).toBeTruthy();
    expect(
      screen.getByText(/stays a draft and will not appear on the dashboard until you save it/),
    ).toBeTruthy();
    expect(search()).toHaveProperty("value", "");
    expect(leave().value).toBe("");
    expect(ret().value).toBe("");
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    expect(cont().getAttribute("aria-describedby")).toBe("continue-reason");
    expect(screen.getByText("Choose a destination from the list to continue.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sample/i);
  });

  it("free text alone cannot continue; pressing Continue just surfaces the reason", async () => {
    const { user } = setup();
    await user.type(search(), "Somewhere I typed");
    await user.click(cont());
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Choose a destination from the list to continue.").className).toContain(
      "field-error",
    );
  });

  it("a form submit while blocked (e.g. from a script) still cannot skip ahead", () => {
    setup();
    fireEvent.submit(cont().closest("form") as HTMLFormElement);
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Shape the list" })).toBeNull();
  });

  it("ambiguous London requires an explicit choice between the two", async () => {
    const { user } = setup();
    await user.type(search(), "london");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "LondonEngland, United Kingdom",
      "LondonOntario, Canada",
    ]);
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-16" } });
    await user.click(cont());
    expect(screen.queryByRole("heading", { name: "Shape the list" })).toBeNull();
    await user.click(options[1]);
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(screen.getByText(/London · Ontario · Canada/)).toBeTruthy();
    await user.click(cont());
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.getByText(/London, Ontario, Canada/)).toBeTruthy();
  });

  it("ties both date inputs to the hint and the date notice", async () => {
    setup();
    for (const input of [leave(), ret()])
      expect(input.getAttribute("aria-describedby")).toBe("date-hint date-notice");
    expect(document.getElementById("date-hint")?.textContent).toMatch(
      /Return cannot be before departure/,
    );
    expect(document.getElementById("date-notice")?.getAttribute("role")).toBe("status");
  });

  it("after choosing a place it asks for dates next, and moves an earlier return to the departure with a visible notice", async () => {
    const { user } = setup();
    await user.type(search(), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    expect(screen.getByText("Choose your departure and return dates to continue.")).toBeTruthy();
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-10" } });
    expect(ret().value).toBe("2026-11-12");
    expect(screen.getByRole("status", { name: "Date notice" }).textContent).toBe(
      "Return date moved to match your departure.",
    );
    expect(cont().getAttribute("aria-disabled")).toBe("false");
    fireEvent.change(ret(), { target: { value: "2026-11-14" } });
    expect(screen.getByRole("status", { name: "Date notice" }).textContent).toBe("");
    expect(screen.getByText(/Same-day trips are allowed/)).toBeTruthy();
    expect(ret().min).toBe("2026-11-12");
  });

  it("editing the destination text after confirming clears it, and Change does too", async () => {
    const { user } = setup();
    await fillDetails(user);
    expect(cont().getAttribute("aria-disabled")).toBe("false");
    await user.type(search(), "x");
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    await user.clear(search());
    await user.type(search(), "paris");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(cont().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("trip theme", () => {
  const radios = () => screen.getAllByRole("radio") as HTMLInputElement[];

  it("appears only once a destination is confirmed, after the dates, with Travel selected", async () => {
    const { user } = setup();
    expect(screen.queryByRole("group", { name: "Trip theme" })).toBeNull();
    await user.type(search(), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    const group = screen.getByRole("group", { name: "Trip theme" });
    expect(
      within(group).getByText("Pick a picture for your trip. You can change it later."),
    ).toBeTruthy();
    expect(radios().map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    // After the dates fields, before the Continue button.
    const position = (node: Node) => (node as HTMLElement).compareDocumentPosition.bind(node);
    expect(position(ret())(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(position(group)(cont()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("goes away again when the destination is cleared", async () => {
    const { user } = setup();
    await user.type(search(), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByRole("group", { name: "Trip theme" })).toBeNull();
  });

  it("the chosen theme is what gets saved, and counts as a change for the discard prompt", async () => {
    const { user, source } = setup();
    await fillDetails(user);
    await user.click(screen.getByRole("radio", { name: "Beach" }));
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(source.snapshot().trips[0].theme).toBe("beach");
  });

  it("a trip saved without touching it is Travel", async () => {
    const { user, source } = setup();
    await fillDetails(user);
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(source.snapshot().trips[0].theme).toBe("travel");
  });

  it("a copy starts on the source trip's theme, and it can be changed before saving", async () => {
    const { user, source } = setup({ copyId: "lisbon" });
    await screen.findByRole("heading", { name: "Confirm the trip" });
    await fillDetails(user, "paris", "2026-12-04", "2026-12-08");
    expect(
      radios()
        .find((radio) => radio.checked)
        ?.closest("label")?.textContent,
    ).toContain("City");
    await user.click(screen.getByRole("radio", { name: "Home / family" }));
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(source.snapshot().trips[0].theme).toBe("home");
    expect(source.snapshot().trips.find((trip) => trip.id === "lisbon")?.theme).toBe("city");
  });
});

describe("step 2: shape the list", () => {
  it("shows the live calculation from the draft and updates everything the moment a preference changes", async () => {
    const { user } = setup();
    await toShapeStep(user);
    expect(screen.getByText("Unsaved trip draft")).toBeTruthy();
    expect(
      screen.getByText("Lisbon, Lisbon District, Portugal · Nov 12 – Nov 16 · 5 days"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3 days of everyday clothes" })).toBeTruthy();
    expect(screen.queryByText(/Simulated/)).toBeNull();
    const row = (name: string) =>
      screen.getByText(name, { selector: "strong" }).closest(".review-row") as HTMLElement;
    expect(row("Everyday tops").textContent).toContain("2");
    expect(screen.getByRole("switch", { name: "Dedicated return travel outfit" })).toHaveProperty(
      "checked",
      true,
    );

    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    expect(screen.queryByText("Dress shoes", { selector: "strong" })).toBeNull();
    expect(row("Everyday tops").textContent).toContain("3");
    expect(screen.getByRole("status", { name: "List changes" }).textContent).toContain(
      "Everyday tops: 3",
    );
    await user.click(screen.getByRole("switch", { name: "Laundry access" }));
    expect(screen.getByRole("status", { name: "List changes" }).textContent).toBe(
      "Everyday tops: 2, Everyday bottoms: 1",
    );
    await user.click(screen.getByRole("switch", { name: "One spare underwear + socks" }));
    expect(row("Underwear").textContent).toContain("3");
  });

  it("only enables occasions and reuse with Nice outfits, and keeps occasions between 1 and 8", async () => {
    const { user } = setup();
    await toShapeStep(user);
    const occasions = screen.getByLabelText("Occasions") as HTMLInputElement;
    const reuse = screen.getByRole("switch", { name: "Reuse one nice look" }) as HTMLInputElement;
    expect(occasions.disabled).toBe(false);
    fireEvent.change(occasions, { target: { value: "12" } });
    expect(occasions.value).toBe("8");
    fireEvent.change(occasions, { target: { value: "0" } });
    expect(occasions.value).toBe("1");
    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    expect(occasions.disabled).toBe(true);
    expect(reuse.disabled).toBe(true);
    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    await user.click(reuse);
    expect(reuse.checked).toBe(false);
  });

  it("return outfit off: shows what the calculator does, and the third tile becomes the return day that is not counted", async () => {
    const { user } = setup();
    await toShapeStep(user);
    expect(
      screen.getByText("A fresh top, bottoms, underwear and socks for the trip home."),
    ).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Dedicated return travel outfit" }));
    expect(
      screen.getByText(
        "No separate return outfit. Your return day is not added to the everyday count.",
      ),
    ).toBeTruthy();
    const returnDay = screen.getByText("Return day, not counted")
      .previousElementSibling as HTMLElement;
    expect(returnDay.textContent).toBe("1");
    expect(screen.queryByText("Set for the trip home")).toBeNull();
    expect(
      screen.getByText(/5 days away − 1 worn − 1 return day = 3 days of everyday clothes\./),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3 days of everyday clothes" })).toBeTruthy();
  });

  it("Edit trip details goes back with everything kept", async () => {
    const { user } = setup();
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Edit trip details" }));
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(leave().value).toBe("2026-11-12");
    expect(ret().value).toBe("2026-11-16");
  });

  it("asks before previewing and shapes the list with weather reasons after opt-in", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const flow = setup({}, (base) => {
      wired = withWeather(base);
      return wired.source;
    });
    await toShapeStep(flow.user);
    expect(await screen.findByText("Get weather for your stops?")).toBeTruthy();
    expect(screen.getByText(/Only map coordinates and dates are sent to Open-Meteo/)).toBeTruthy();
    expect(wired.previewDraft).not.toHaveBeenCalled();
    await flow.user.click(screen.getByRole("button", { name: "Get weather" }));
    await waitFor(() => expect(wired.previewDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Your list uses the weather for Lisbon.")).toBeTruthy();
    const umbrella = screen
      .getByText("Compact umbrella", { selector: "strong" })
      .closest(".review-row") as HTMLElement;
    expect(umbrella.textContent).toContain("Weather");
    expect(umbrella.textContent).toContain("Rain likely in Lisbon, Nov 13");
    expect(screen.queryByText("Everyday tops", { selector: "strong" })).toBeNull();
    expect(screen.getByText("Long-sleeve tops", { selector: "strong" })).toBeTruthy();
  });

  it("Not now answers the new trip's weather prompt, so the trip screen does not ask again", async () => {
    const skipped: string[] = [];
    const { user, source } = setup({}, (base) => {
      const wired = withWeather(base);
      return {
        ...wired.source,
        skipWeather: async (id) => (skipped.push(id), base.skipWeather(id)),
      };
    });
    await toShapeStep(user);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByText("Weather is off")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(skipped).toEqual([source.snapshot().trips[0].id]);
    expect(source.snapshot().trips[0].weather.status).toBe("skipped");
  });

  it("does not touch the weather status of a trip saved before the question was answered", async () => {
    const skipped: string[] = [];
    const { user, source } = setup({}, (base) => {
      const wired = withWeather(base);
      return {
        ...wired.source,
        skipWeather: async (id) => (skipped.push(id), base.skipWeather(id)),
      };
    });
    await toShapeStep(user);
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(skipped).toEqual([]);
    expect(source.snapshot().trips[0].weather.status).toBe("pending");
  });

  it("omits the forecast card for a custom destination", async () => {
    const { user } = setup({ allowCustom: true });
    await user.type(search(), "Grandma's cabin");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-14" } });
    await user.click(cont());
    expect(await screen.findByText(/Grandma's cabin · Nov 12 – Nov 14 · 3 days/)).toBeTruthy();
    expect(screen.queryByText(/Simulated/)).toBeNull();
  });
});

describe("saving", () => {
  it("is explicit: nothing is saved until Save trip, then the trip is stored, a toast shows and the dashboard opens", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await toShapeStep(user);
    expect(source.snapshot()).toBe(before);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const saved = source.snapshot().trips[0];
    expect(saved).toMatchObject({
      id: "new-1",
      destination: "Lisbon",
      start: "2026-11-12",
      end: "2026-11-16",
      copiedFrom: null,
    });
    expect(saved.items.every((item) => item.packed === 0)).toBe(true);
    expect(source.snapshot().trips).toHaveLength(3);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText("Trip saved"),
    ).toBeTruthy();
  });

  it("persists the weather recommendations shown in Shape the list", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user, source } = setup({}, (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await toShapeStep(user);
    expect(await screen.findByText("Compact umbrella", { selector: "strong" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(wired.createTripWithReview).toHaveBeenCalledTimes(1));
    expect(wired.createTripWithReview.mock.calls[0][1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ semanticId: "weather-umbrella" })]),
    );
    expect(source.snapshot().trips[0].items.some((item) => item.id === "weather-umbrella")).toBe(
      true,
    );
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows Saving…, disables the buttons while pending, and does not navigate before the source confirms", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user } = setup(undefined, (base) => ({
      ...base,
      createTrip: async (draft) => (await gate, base.createTrip(draft)),
    }));
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    const saving = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Edit trip details" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(push).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("on failure stays on step 2 with the Error chip; Retry then saves and navigates", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("down"));
    const { user, source } = setup(undefined, (base) => ({
      ...base,
      createTrip: (draft) => {
        create();
        return create.mock.calls.length === 1
          ? Promise.reject(new Error("down"))
          : base.createTrip(draft);
      },
    }));
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await screen.findByRole("button", { name: "Not saved, retry" });
    expect(screen.getByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save trip" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(push).not.toHaveBeenCalled();
    expect(source.snapshot().trips).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(source.snapshot().trips).toHaveLength(3);
  });
});

describe("cancelling persists nothing", () => {
  it("an untouched draft leaves straight away, with no prompt", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("the back arrow behaves the same as Cancel", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("at step 1, a changed draft asks once; Keep editing stays, Discard leaves, and nothing is saved", async () => {
    const create = vi.fn();
    const { user, source } = setup(undefined, (base) => ({
      ...base,
      createTrip: (draft) => (create(), base.createTrip(draft)),
    }));
    const before = source.snapshot();
    await user.type(search(), "lon");
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this draft?" });
    expect(within(dialog).getByText(/Nothing has been saved/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(create).not.toHaveBeenCalled();
    expect(source.snapshot()).toBe(before);
  });

  it("Escape on the discard prompt keeps editing", async () => {
    const { user } = setup();
    await user.type(search(), "lon");
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.getByRole("dialog", { name: "Discard this draft?" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(search()).toHaveProperty("value", "lon");
  });

  it("at step 2, Cancel draft also asks, and discarding saves nothing", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Discard this draft?" })).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(push).toHaveBeenCalledWith("/");
    expect(source.snapshot()).toBe(before);
    expect(source.snapshot().trips).toHaveLength(2);
  });
});

describe("copy", () => {
  it("opens the same flow seeded with the source's preferences, but an empty destination and dates", async () => {
    const { user } = setup({ copyId: "lisbon" });
    expect(await screen.findByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Copy of Lisbon")).toBeTruthy();
    expect(search()).toHaveProperty("value", "");
    expect(leave().value).toBe("");
    expect(ret().value).toBe("");
    expect(screen.getByText(/The original Lisbon trip stays unchanged/)).toBeTruthy();
    await fillDetails(user, "paris", "2026-12-04", "2026-12-08");
    await user.click(cont());
    expect(await screen.findByText("Unsaved copy of Lisbon")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Laundry access" })).toHaveProperty("checked", true);
    expect(screen.getByRole("switch", { name: "One spare underwear + socks" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("saves a new trip with clear progress and leaves the source trip unchanged", async () => {
    const { user, source } = setup({ copyId: "san-diego" });
    const original = structuredClone(
      source.snapshot().trips.find((trip) => trip.id === "san-diego"),
    );
    await screen.findByRole("heading", { name: "Confirm the trip" });
    await fillDetails(user, "paris", "2026-12-04", "2026-12-08");
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const copy = source.snapshot().trips[0];
    expect(copy).toMatchObject({
      destination: "Paris",
      copiedFrom: "san-diego",
      ready: false,
      toiletryBagPacked: false,
    });
    expect(copy.items.every((item) => item.packed === 0)).toBe(true);
    expect(source.snapshot().trips.find((trip) => trip.id === "san-diego")).toEqual(original);
  });

  it("shows a message with a way back when the trip to copy is gone", async () => {
    setup({ copyId: "nope" });
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("shows the same message when the trips cannot be loaded", async () => {
    setup({ copyId: "lisbon" }, (base) => ({
      ...base,
      load: () => Promise.reject(new Error("down")),
    }));
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
  });

  it("shows a loading state while the source trip loads, and ignores a load that finishes after unmount", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { source } = setup({ copyId: "lisbon" }, (base) => ({
      ...base,
      load: async () => (await gate, base.load()),
    }));
    expect(screen.getByRole("region", { name: "Loading trip" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => finish());
    expect(await screen.findByText("Copy of Lisbon")).toBeTruthy();
    expect(source.snapshot().trips).toHaveLength(2);
  });

  it("does not update after unmount when the load resolves or rejects late", async () => {
    push.mockClear();
    let finish!: () => void;
    let fail!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const broken = new Promise<void>(
      (_resolve, reject) => (fail = () => reject(new Error("late"))),
    );
    const base = memory();
    const first = renderInApp(
      <TripsSourceProvider source={{ ...base, load: async () => (await slow, base.load()) }}>
        <TripFlow copyId="lisbon" />
      </TripsSourceProvider>,
    );
    first.unmount();
    const second = renderInApp(
      <TripsSourceProvider source={{ ...base, load: async () => (await broken, base.load()) }}>
        <TripFlow copyId="lisbon" />
      </TripsSourceProvider>,
    );
    second.unmount();
    await act(async () => {
      finish();
      fail();
    });
  });
});

describe("destination provider", () => {
  it("searches through whichever LocationProvider is supplied, so a geocoding adapter needs no UI change", async () => {
    push.mockClear();
    const place = {
      id: "geo-1",
      city: "Springfield",
      region: "Illinois",
      country: "United States",
      countryCode: "US",
      label: "Springfield, Illinois, United States",
    };
    const searchSpy = vi.fn().mockResolvedValue([place]);
    const provider: LocationProvider = { minQueryLength: 2, debounceMs: 0, search: searchSpy };
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={memory()}>
        <LocationProviderProvider provider={provider}>
          <TripFlow />
        </LocationProviderProvider>
      </TripsSourceProvider>,
    );
    await user.type(search(), "sp");
    await user.click(
      (await within(screen.getByRole("listbox", { hidden: true })).findAllByRole("option"))[0],
    );
    expect(searchSpy).toHaveBeenCalled();
    expect(screen.getByText(/Springfield · Illinois · United States/)).toBeTruthy();
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
  });

  it("falls back to the curated list when no provider is supplied", async () => {
    const { user } = setup();
    await user.type(search(), "paris");
    expect(
      (await within(screen.getByRole("listbox", { hidden: true })).findAllByRole("option"))[0]
        .textContent,
    ).toContain("Île-de-France");
  });
});
