// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, TripsSourceError } from "@/features/trips/trips-source";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { TripScreen } from "./TripScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/san-diego" }));

function stateWithRoute(title = "San Diego → Lisbon"): LifecycleState {
  const state = sampleLifecycleState();
  const [sanDiego, lisbon] = state.trips;
  const tour = {
    ...sanDiego,
    id: "tour",
    destination: title,
    end: "2026-10-29",
    stops: [
      { location: sanDiego.location!, arrive: "2026-10-23", leave: "2026-10-26" },
      { location: lisbon.location!, arrive: "2026-10-26", leave: "2026-10-29" },
    ],
  };
  return { ...state, trips: [tour, ...state.trips] };
}

function setup(id: string, fail = false, title?: string) {
  const base = createMemoryTripsSource(stateWithRoute(title), {
    now: () => 1,
    newId: () => "new",
    today: () => "2026-10-16",
  });
  const source = fail
    ? { ...base, setStops: async () => Promise.reject(new TripsSourceError("INTERNAL")) }
    : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId={id} />
    </TripsSourceProvider>,
  );
  return { user, source: base };
}

describe("the route on the trip header", () => {
  it("does not repeat the route as a chip when the title is the route", async () => {
    setup("tour");
    await screen.findByRole("heading", { name: "San Diego → Lisbon", level: 1 });
    expect(document.querySelector(".route-chip")).toBeNull();
  });

  it("shows a route chip with the full route when the title is something else", async () => {
    setup("tour", false, "Autumn tour");
    await screen.findByRole("heading", { name: "Autumn tour", level: 1 });
    const chip = document.querySelector(".route-chip") as HTMLElement;
    expect(chip.textContent).toContain("Route: San Diego, then Lisbon.");
    expect(chip.querySelector(".route-text")?.getAttribute("title")).toBe("San Diego → Lisbon");
  });

  it("shows no route chip for a single destination", async () => {
    setup("san-diego");
    await screen.findByRole("heading", { name: "San Diego", level: 1 });
    expect(document.querySelector(".route-chip")).toBeNull();
  });
});

describe("Edit route", () => {
  it("opens the stop cards on the trip's stops and saves a changed route", async () => {
    const { user, source } = setup("tour");
    await screen.findByRole("heading", { name: "San Diego → Lisbon", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    expect(within(dialog).getAllByRole("group", { name: /^Stop \d$/ })).toHaveLength(2);

    fireEvent.change(within(dialog).getByLabelText("Leave, Stop 2"), {
      target: { value: "2026-10-31" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save route" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).toBeNull());
    const saved = (await source.getTrip("tour"))!;
    expect(saved).toMatchObject({ end: "2026-10-31", days: 9 });
    expect(screen.getByRole("status", { name: "Packing updates" }).textContent).toBe(
      "Route updated.",
    );
  });

  it("opens a single-destination trip as one plain destination and can add a stop", async () => {
    const { user, source } = setup("san-diego");
    await screen.findByRole("heading", { name: "San Diego", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    await user.click(within(dialog).getByRole("button", { name: "+ Add another stop" }));
    await user.type(
      within(dialog).getByRole("combobox", { name: "Destination search, Stop 2" }),
      "paris",
    );
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    await user.click(within(dialog).getByRole("button", { name: "Save route" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).toBeNull());
    expect((await source.getTrip("san-diego")).stops.map((s) => s.location.city)).toEqual([
      "San Diego",
      "Paris",
    ]);
  });

  it("does not save while the route has problems, and says what to fix", async () => {
    const { user, source } = setup("san-diego");
    await screen.findByRole("heading", { name: "San Diego", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    await user.click(within(dialog).getByRole("button", { name: "+ Add another stop" }));
    await user.click(within(dialog).getByRole("button", { name: "Save route" }));
    expect(within(dialog).getByText("Pick a place for Stop 2, or choose Custom.")).toBeTruthy();
    expect(within(dialog).getAllByText("Fix 1 thing above to continue.").length).toBeGreaterThan(0);
    expect((await source.getTrip("san-diego")).stops).toHaveLength(1);
  });

  it("Cancel discards the edit", async () => {
    const { user, source } = setup("tour");
    await screen.findByRole("heading", { name: "San Diego → Lisbon", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    await user.click(within(dialog).getByRole("button", { name: "Remove Lisbon" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit route" })).toBeNull();
    expect((await source.getTrip("tour")).stops).toHaveLength(2);
  });

  it("keeps the sheet open with a message when the save does not go through, and clears it on close", async () => {
    const { user } = setup("tour", true);
    await screen.findByRole("heading", { name: "San Diego → Lisbon", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    await user.click(within(dialog).getByRole("button", { name: "Save route" }));
    expect(await within(dialog).findByText(/Couldn’t save the route/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit route" }));
    expect(screen.queryByText(/Couldn’t save the route/)).toBeNull();
  });
});
