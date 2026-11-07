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

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push }),
}));

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

const SAVE = { name: /^Save \d+ changes?$/ };

describe("Edit trip: Route & dates", () => {
  it("opens the stops on the trip's route and saves a changed Come home date", async () => {
    const { user, source } = setup("tour");
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    expect(within(dialog).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText("San Diego")).toBeTruthy();
    expect(within(dialog).getByText("Lisbon")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Come home"), {
      target: { value: "2026-10-31" },
    });
    // The live panel says what the new date does before anything is saved.
    expect(within(dialog).getByText("Dates")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", SAVE));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull());
    const saved = (await source.getTrip("tour"))!;
    expect(saved).toMatchObject({ end: "2026-10-31", days: 9 });
    expect(screen.getByRole("status", { name: "Packing updates" }).textContent).toBe(
      "Route updated.",
    );
  });

  it("opens a single-destination trip as one plain destination and can add a stop", async () => {
    const { user, source } = setup("san-diego");
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("button", { name: "Add a stop" }));
    await user.type(
      within(dialog).getByRole("combobox", { name: "Destination search, Stop 2" }),
      "paris",
    );
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    await user.click(within(dialog).getByRole("button", SAVE));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull());
    expect((await source.getTrip("san-diego")).stops.map((s) => s.location.city)).toEqual([
      "San Diego",
      "Paris",
    ]);
  });

  it("does not save while the route has problems, and says what to fix", async () => {
    const { user, source } = setup("san-diego");
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("button", { name: "Add a stop" }));
    expect(within(dialog).getByText("Pick a place for Stop 2, or choose Custom.")).toBeTruthy();
    expect(within(dialog).getByText("Fix 1 thing above to save.")).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((await source.getTrip("san-diego")).stops).toHaveLength(1);
  });

  it("Cancel discards the edit, without asking: nothing was saved", async () => {
    const { user, source } = setup("tour");
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("button", { name: "Remove Lisbon" }));
    expect(within(dialog).getByRole("button", SAVE)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull();
    expect((await source.getTrip("tour")).stops).toHaveLength(2);
  });

  it("keeps the sheet open with a message when the save does not go through, and clears it on close", async () => {
    const { user } = setup("tour", true);
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("button", { name: "Remove Lisbon" }));
    await user.click(within(dialog).getByRole("button", SAVE));
    expect(await within(dialog).findByText(/Couldn’t save the route/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    expect(screen.queryByText(/Couldn’t save the route/)).toBeNull();
  });

  it("saves how you are getting there and announces it", async () => {
    const { user, source } = setup("tour");
    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("radio", { name: "Drive" }));
    expect(within(dialog).getAllByText("Getting there")).toHaveLength(2); // the label and the changes row
    await user.click(within(dialog).getByRole("button", { name: "Save 1 change" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull());
    expect((await source.getTrip("tour")).travelMode).toBe("drive");
    expect(screen.getByRole("status", { name: "Packing updates" }).textContent).toBe(
      "Getting there updated.",
    );
  });
});
