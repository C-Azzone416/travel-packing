// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState, SAMPLE_LOCATIONS } from "@/features/trips/fixtures";
import { buildTrip, emptyLifecycleState, type LifecycleState } from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { SampleLocation } from "@/domain/trip-stops";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { StampsContent, StampsScreen, StickerTeaser } from "./StampsScreen";
import { stampsView } from "./stamps-view";

vi.mock("next/navigation", () => ({ usePathname: () => "/stamps" }));

const TODAY = "2026-10-16";
const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};
const LISBON = "Lisbon, Sep 2026, inked, 1 trip";
const SAN_DIEGO = "San Diego, Oct 2026, upcoming, not inked yet";

function source(state: LifecycleState = sampleLifecycleState()) {
  return createMemoryTripsSource(state, { now: () => 1, today: () => TODAY });
}

function open(src: ReturnType<typeof source> = source()) {
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={src}>
      <StampsScreen getToday={() => TODAY} />
    </TripsSourceProvider>,
  );
  return { user, src };
}

const place = (id: string, city: string, countryCode: string, country: string): SampleLocation => ({
  id,
  city,
  region: "",
  country,
  countryCode,
  label: `${city}, ${country}`,
});

function trip(id: string, start: string, end: string, location = SAMPLE_LOCATIONS["pt-lisbon"]) {
  return buildTrip(location.city, location, start, end, CONFIG, [], {
    newId: () => id,
    today: TODAY,
  });
}
const withTrips = (...trips: ReturnType<typeof trip>[]): LifecycleState => ({
  ...emptyLifecycleState(),
  trips,
});

describe("upcoming stickers do not read as earned (#493)", () => {
  it("names an upcoming sticker as upcoming and an earned one as inked", async () => {
    open();
    expect(await screen.findByRole("button", { name: LISBON })).toBeTruthy();
    expect(screen.getByRole("button", { name: SAN_DIEGO })).toBeTruthy();
  });

  it("selects nothing, and shows no selected card, when only upcoming stickers exist", async () => {
    open(source(withTrips(trip("ahead", "2026-11-20", "2026-11-25"))));
    const sticker = await screen.findByRole("button", {
      name: "Lisbon, Nov 2026, upcoming, not inked yet",
    });
    expect(sticker.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1); // the "Last 12 months" filter only
    expect(screen.queryByRole("article", { name: /Selected trip/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit stamp label" })).toBeNull();
  });

  it("selects the earned sticker first when there is an earned one as well", async () => {
    open();
    const earned = await screen.findByRole("button", { name: LISBON });
    expect(earned.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: SAN_DIEGO }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("tags only an upcoming sticker, and keeps it dashed when it is selected", async () => {
    const { user } = open();
    const upcoming = await screen.findByRole("button", { name: SAN_DIEGO });
    expect(within(upcoming).getByText("Upcoming")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: LISBON })).queryByText("Upcoming")).toBeNull();
    await user.click(upcoming);
    await user.keyboard("{Escape}");
    expect(upcoming.getAttribute("aria-pressed")).toBe("true");
    expect(upcoming.getAttribute("data-upcoming")).toBe("true");
    expect(within(upcoming).getByText("Upcoming")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Selected trip: San Diego" }).textContent).toContain(
      "Upcoming · inks when you get home",
    );
  });

  it("draws the Home teaser's stickers decorative, an upcoming one with no tag", () => {
    const view = stampsView(
      withTrips(trip("ahead", "2026-11-20", "2026-11-25")).trips,
      TODAY,
      "all",
    );
    render(
      <StickerTeaser
        stickers={view.stickers}
        inked={view.inked}
        filterLabel="All time"
        totals={{ trips: 0, nights: 0 }}
      />,
    );
    expect(view.stickers[0].upcoming).toBe(true);
    expect(document.querySelector('[data-decorative="true"][data-upcoming="true"]')).toBeTruthy();
    expect(screen.queryByText("Upcoming")).toBeNull();
  });
});

describe("a sticker opens its details (#494)", () => {
  it("opens on a tap, on an already selected sticker, and on Enter and Space", async () => {
    const { user } = open();
    const lisbon = await screen.findByRole("button", { name: LISBON });
    expect(lisbon.getAttribute("aria-pressed")).toBe("true");
    expect(lisbon.getAttribute("aria-haspopup")).toBe("dialog");
    await user.click(lisbon);
    const dialog = screen.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    expect(within(dialog).getByRole("img", { name: LISBON })).toBeTruthy();
    expect(within(dialog).getByText("Inked")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Reuse this list" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open trip" }).getAttribute("href")).toBe(
      "/trips/lisbon",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(lisbon);
    lisbon.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says Upcoming for an upcoming trip and counts repeat visits", async () => {
    const { user } = open(
      source(
        withTrips(
          trip("a", "2025-11-01", "2025-11-03"),
          trip("b", "2026-09-03", "2026-09-07"),
          trip("c", "2026-11-20", "2026-11-25", SAMPLE_LOCATIONS["us-ca-san-diego"]),
        ),
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Lisbon, Sep 2026, inked, 2 trips" }),
    );
    expect(screen.getByText(/Visited 2 times/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "San Diego, Nov 2026, upcoming, not inked yet" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("Upcoming · inks when you get home"),
    ).toBeTruthy();
  });

  it("edits the label: the typed value is saved, and the sticker, card and details change in place", async () => {
    const { user, src } = open();
    const save = vi.spyOn(src, "setStampLabels");
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    // Only one modal is open: the details closed first.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenCalledWith("lisbon", "ABC", null);
    const sticker = screen.getByRole("button", { name: LISBON });
    expect(sticker.querySelector("[data-text='ABC']")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Selected trip: Lisbon" }).textContent).toContain(
      "ABC",
    );
    expect(document.activeElement).toBe(sticker);
    expect(
      screen.getAllByRole("status").some((node) => node.textContent === "Stamp label saved."),
    ).toBe(true);
    // The details show the trip's stamp as saved.
    await user.click(sticker);
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: /ABC/ })).toBeTruthy();
  });

  it("leaves the label and puts focus back on the sticker when the editor is cancelled", async () => {
    const { user, src } = open();
    const save = vi.spyOn(src, "setStampLabels");
    const sticker = await screen.findByRole("button", { name: LISBON });
    const before = sticker.querySelector("[data-text]")?.getAttribute("data-text");
    await user.click(sticker);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(sticker.querySelector("[data-text]")?.getAttribute("data-text")).toBe(before);
    expect(document.activeElement).toBe(sticker);
  });

  it("keeps the editor open when the save fails, and Save tries again", async () => {
    const { user, src } = open();
    const real = src.setStampLabels.bind(src);
    let attempts = 0;
    vi.spyOn(src, "setStampLabels").mockImplementation((...args) => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("down")) : real(...args);
    });
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "xyz");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Couldn’t save the stamp/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: LISBON }).querySelector("[data-text='XYZ']"),
    ).toBeTruthy();
  });

  it("the selected card edits the label too, and a reset says so", async () => {
    const { user, src } = open();
    await screen.findByRole("article", { name: "Selected trip: Lisbon" });
    const edit = screen.getByRole("button", { name: "Edit stamp label" });
    await user.click(edit);
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "ZZZ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(src.snapshot().trips.find((t) => t.id === "lisbon")?.stampLabels?.[0]).toBe("ZZZ");
    await user.click(screen.getByRole("button", { name: "Edit stamp label" }));
    await user.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Stamp reset to automatic.")).toBeTruthy();
  });

  it("leaves the stamp shape alone: only the existing labels are written", async () => {
    const { user, src } = open();
    const before = Object.keys(src.snapshot().trips.find((t) => t.id === "lisbon")!);
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "QQQ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = src.snapshot().trips.find((t) => t.id === "lisbon")!;
    expect(after.stampLabels).toEqual(["QQQ", null]);
    for (const key of Object.keys(after)) expect([...before, "stampLabels"]).toContain(key);
  });

  it("hides the action when the route has no stamp to edit", async () => {
    const blank = trip("blank", "2026-09-10", "2026-09-12", place("x", "Mystery", "", ""));
    const { user } = open(source(withTrips(blank)));
    await user.click(
      await screen.findByRole("button", { name: "Mystery, Sep 2026, inked, 1 trip" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Edit stamp label" }),
    ).toBeNull();
    expect(screen.queryByText(/code comes from the route/)).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Edit stamp label" })).toBeNull();
  });

  it("disables the action, and says why, for a sticker the editor cannot change", async () => {
    // Three countries: the route shows ONE departure stamp, so the sticker for the second stop has no slot to edit.
    const multi = trip("multi", "2026-09-03", "2026-09-12");
    const base = multi.stops[0];
    multi.stops = [
      base,
      { ...base, location: place("us", "Austin", "US", "United States") },
      { ...base, location: place("es", "Madrid", "ES", "Spain") },
    ];
    const { user } = open(source(withTrips(multi)));
    // Both Austin and Madrid are one place each; Lisbon (stop 1) is editable, Austin (stop 2) is not.
    await user.click(
      await screen.findByRole("button", { name: "Austin, Sep 2026, inked, 1 trip" }),
    );
    const dialog = screen.getByRole("dialog");
    const edit = within(dialog).getByRole("button", {
      name: "Edit stamp label",
    }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(within(dialog).getByText("This sticker’s code comes from the route.")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" }));
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Edit stamp label",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("a write from the editor changes exactly the sticker the route label names (Lisbon, Porto, Madrid)", async () => {
    const route = trip("lpm", "2026-09-03", "2026-09-12");
    const base = route.stops[0];
    route.stops = [
      base,
      { ...base, location: place("pt2", "Porto", "PT", "Portugal") },
      { ...base, location: place("es", "Madrid", "ES", "Spain") },
    ];
    const { user } = open(source(withTrips(route)));
    const porto = "Porto, Sep 2026, inked, 1 trip";
    const codes = () =>
      Object.fromEntries(
        ["Lisbon", "Porto", "Madrid"].map((city) => [
          city,
          screen
            .getByRole("button", { name: `${city}, Sep 2026, inked, 1 trip` })
            .querySelector("strong")
            ?.getAttribute("data-text"),
        ]),
      );
    await screen.findByRole("button", { name: porto });
    const before = codes();
    await user.click(screen.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    const stamp2 = within(screen.getByRole("group", { name: /Stamp 2/ }));
    await user.click(stamp2.getByRole("radio", { name: "Custom" }));
    const field = stamp2.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "qqq");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = codes();
    expect(after.Madrid).toBe("QQQ");
    expect(after.Porto).toBe(before.Porto);
    expect(after.Lisbon).toBe(before.Lisbon);
  });

  function deferSave(src: ReturnType<typeof source>) {
    const real = src.setStampLabels.bind(src);
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    vi.spyOn(src, "setStampLabels").mockImplementationOnce(async (...args) => {
      await gate;
      return real(...args);
    });
    return release;
  }
  async function typeLabel(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, text);
  }

  it("cannot be dismissed while a save is pending", async () => {
    const { user, src } = open();
    const release = deferSave(src);
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await typeLabel(user, "lat");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: LISBON }).querySelector("[data-text='LAT']"),
    ).toBeTruthy();
  });

  it("keeps the editor open when Back is pressed during a save, and the entry stays marked until the save is done", async () => {
    const { user, src } = open();
    const release = deferSave(src);
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    expect(window.history.state).toEqual({ stampEditor: true });
    await typeLabel(user, "lat");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      window.history.back();
      await new Promise((done) => setTimeout(done, 20));
    });
    // Back did not dismiss it, and the entry Back removed is back, so the next Back is still ours.
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    expect(window.history.state).toEqual({ stampEditor: true });
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Closing after the save pops the entry: the page is not left on a marked one.
    await waitFor(() => expect(window.history.state).not.toEqual({ stampEditor: true }));
  });

  it("writes only the slot that was changed, over the labels as last confirmed", async () => {
    const sample = sampleLifecycleState();
    const lisbon = sample.trips[1];
    const base = lisbon.stops[0];
    const madrid = {
      ...base,
      location: { ...base.location, id: "es", city: "Madrid", country: "Spain", countryCode: "ES" },
    };
    const stops = [base, madrid];
    const stateWith = (labels: [string | null, string | null]): LifecycleState => ({
      ...sample,
      trips: [sample.trips[0], { ...lisbon, stops, stampLabels: labels }],
    });
    const src = source(stateWith([null, null]));
    const write = vi.spyOn(src, "setStampLabels");
    const user = userEvent.setup();
    const tree = (state: LifecycleState) => (
      <ToastProvider>
        <SaveStatusProvider>
          <TripsSourceProvider source={src}>
            <StampsContent state={state} today={TODAY} onTripSaved={() => undefined} />
          </TripsSourceProvider>
        </SaveStatusProvider>
      </ToastProvider>
    );
    const view = render(tree(stateWith([null, null])));
    await user.click(screen.getByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    // Another surface confirms Stamp 2 while this editor is open.
    view.rerender(tree(stateWith([null, "QQQ"])));
    const one = within(screen.getByRole("group", { name: /Stamp 1/ }));
    await user.click(one.getByRole("radio", { name: "Custom" }));
    await user.clear(one.getByLabelText("Label"));
    await user.type(one.getByLabelText("Label"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("lisbon", "ABC", "QQQ"));
  });

  it("writes only Stamp 2 when Stamp 1 was confirmed meanwhile", async () => {
    const sample = sampleLifecycleState();
    const lisbon = sample.trips[1];
    const base = lisbon.stops[0];
    const madrid = {
      ...base,
      location: { ...base.location, id: "es", city: "Madrid", country: "Spain", countryCode: "ES" },
    };
    const stops = [base, madrid];
    const stateWith = (labels: [string | null, string | null]): LifecycleState => ({
      ...sample,
      trips: [sample.trips[0], { ...lisbon, stops, stampLabels: labels }],
    });
    const src = source(stateWith([null, null]));
    const write = vi.spyOn(src, "setStampLabels");
    const user = userEvent.setup();
    const tree = (state: LifecycleState) => (
      <ToastProvider>
        <SaveStatusProvider>
          <TripsSourceProvider source={src}>
            <StampsContent state={state} today={TODAY} onTripSaved={() => undefined} />
          </TripsSourceProvider>
        </SaveStatusProvider>
      </ToastProvider>
    );
    const view = render(tree(stateWith([null, null])));
    await user.click(screen.getByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    // Another surface confirms Stamp 1 while this editor is open.
    view.rerender(tree(stateWith(["QQQ", null])));
    const one = within(screen.getByRole("group", { name: /Stamp 2/ }));
    await user.click(one.getByRole("radio", { name: "Custom" }));
    await user.clear(one.getByLabelText("Label"));
    await user.type(one.getByLabelText("Label"), "abd");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("lisbon", "QQQ", "ABD"));
  });
});
