// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { TripCard } from "./TripCard";
import { tripCardView, type TripListView } from "./view";

const TODAY = "2026-10-16";
const trip = sampleLifecycleState().trips.find((entry) => entry.id === "san-diego")!;
const lisbon = sampleLifecycleState().trips.find((entry) => entry.id === "lisbon")!;

/** A past trip (ended 2026-09-07) with one item: `packed` of `qty` packed. */
function pastTrip(qty: number, packed: number, patch: Partial<LifecycleTrip> = {}): LifecycleTrip {
  return {
    ...lisbon,
    ready: false,
    toiletryBagPacked: false,
    items: [{ ...lisbon.items[0], qty, packed }],
    ...patch,
  };
}

function renderCard(
  listView: TripListView,
  busy = false,
  tripToRender: LifecycleTrip = trip,
  today = TODAY,
) {
  const handlers = { onArchive: vi.fn(), onRestore: vi.fn(), onRemove: vi.fn() };
  const { container } = render(
    <TripCard
      trip={tripToRender}
      view={tripCardView(tripToRender, today, listView)}
      first={false}
      busy={busy}
      {...handlers}
    />,
  );
  return { ...handlers, container };
}

const article = () => screen.getByRole("article");
const progressFor = (destination: string) =>
  screen.getByRole("progressbar", { name: `${destination} packing progress` });

describe("TripCard actions", () => {
  it("Archive on an upcoming card archives that trip", async () => {
    const { onArchive, onRemove } = renderCard("upcoming");
    await userEvent.click(screen.getByRole("button", { name: `Archive: ${trip.destination}` }));
    expect(onArchive).toHaveBeenCalledWith(trip.id);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("Remove asks to remove that trip", async () => {
    const { onRemove, onArchive } = renderCard("upcoming");
    await userEvent.click(screen.getByRole("button", { name: `Remove: ${trip.destination}` }));
    expect(onRemove).toHaveBeenCalledWith(trip.id);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("offers no Archive on the archive list, and disables the buttons while a change saves", () => {
    renderCard("archive", true);
    expect(screen.queryByRole("button", { name: /^Archive:/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: `Remove: ${trip.destination}` }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps the Copy trip and Remove names on an upcoming card", () => {
    renderCard("upcoming");
    expect(screen.getByRole("link", { name: `Copy trip: ${trip.destination}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove: ${trip.destination}` })).toBeTruthy();
  });

  it("a past card keeps the Copy trip and Remove names, with no Archive or Restore", () => {
    renderCard("archive", false, pastTrip(15, 12));
    expect(screen.getByRole("link", { name: `Copy trip: ${lisbon.destination}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove: ${lisbon.destination}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Archive:|^Restore:/ })).toBeNull();
  });
});

describe("TripCard wording for upcoming and archived-future cards (unchanged)", () => {
  it("an upcoming card says what is left to pack, with the existing progress valuetext", () => {
    renderCard("upcoming");
    expect(within(article()).getByText("26 left to pack")).toBeTruthy();
    expect(progressFor(trip.destination).getAttribute("aria-valuetext")).toBe("19% packed");
    expect(within(article()).getByText("6 of 32 packed")).toBeTruthy();
    expect(screen.getByRole("link", { name: `Keep packing: ${trip.destination}` })).toBeTruthy();
  });

  it("an upcoming Ready card says Ready to go", () => {
    renderCard("upcoming", false, { ...trip, ready: true });
    expect(within(article()).getByText("Ready to go")).toBeTruthy();
  });

  it("an archived trip still in the future keeps today's wording", () => {
    renderCard("archive", false, { ...trip, archived: true });
    expect(within(article()).getByText("Archived trip")).toBeTruthy();
    expect(within(article()).getByText("26 left to pack")).toBeTruthy();
    expect(progressFor(trip.destination).getAttribute("aria-valuetext")).toBe("19% packed");
  });
});

describe("TripCard wording for past cards (spec #301)", () => {
  it("an incomplete, not Ready past trip says Packed 12 of 15, and never what is left", () => {
    renderCard("archive", false, pastTrip(15, 12));
    expect(within(article()).getByText("Packed 12 of 15")).toBeTruthy();
    expect(progressFor(lisbon.destination).getAttribute("aria-valuetext")).toBe(
      "Packed 12 of 15 (80%)",
    );
    expect(article().textContent).not.toMatch(/left/i);
  });

  it("an incomplete, not Ready past trip offers Review bag, never Keep packing", () => {
    renderCard("archive", false, pastTrip(15, 12));
    const link = screen.getByRole("link", { name: `Review bag: ${lisbon.destination}` });
    expect(link.textContent).toBe("Review bag");
    expect(link.getAttribute("href")).toBe(`/trips/${lisbon.id}`);
    expect(article().textContent).not.toMatch(/Keep packing|Continue packing/);
  });

  it("a complete, not Ready past trip says All 15 packed", () => {
    renderCard("archive", false, pastTrip(15, 15));
    expect(within(article()).getByText("All 15 packed")).toBeTruthy();
    expect(progressFor(lisbon.destination).getAttribute("aria-valuetext")).toBe(
      "All 15 packed (100%)",
    );
  });

  it("a Ready past trip at 15 of 15 says Marked Ready with the counts", () => {
    renderCard("archive", false, pastTrip(15, 15, { ready: true }));
    expect(within(article()).getByText("Marked Ready")).toBeTruthy();
    expect(progressFor(lisbon.destination).getAttribute("aria-valuetext")).toBe(
      "Marked Ready, packed 15 of 15 (100%)",
    );
  });

  it("a Ready past trip at 12 of 15 says Marked Ready with 80%", () => {
    renderCard("archive", false, pastTrip(15, 12, { ready: true }));
    expect(within(article()).getByText("Marked Ready")).toBeTruthy();
    expect(progressFor(lisbon.destination).getAttribute("aria-valuetext")).toBe(
      "Marked Ready, packed 12 of 15 (80%)",
    );
  });

  it("a past trip with no items says No items, even when marked Ready", () => {
    const { container } = renderCard("archive", false, pastTrip(0, 0));
    expect(within(article()).getByText("No items")).toBeTruthy();
    expect(progressFor(lisbon.destination).getAttribute("aria-valuetext")).toBe(
      "No items packed (0%)",
    );
    expect(container.querySelector(".status-pill.remaining")?.textContent).toBe("○No items");
  });

  it("a past trip with no items and Ready still says No items", () => {
    renderCard("archive", false, pastTrip(0, 0, { ready: true }));
    expect(within(article()).getByText("No items")).toBeTruthy();
    expect(within(article()).queryByText("Marked Ready")).toBeNull();
  });

  it("uses the Ready chip variant only for Marked Ready", () => {
    const { container } = renderCard("archive", false, pastTrip(15, 15, { ready: true }));
    expect(container.querySelector(".status-pill.ready")?.textContent).toBe("✓Marked Ready");
    expect(container.querySelector(".status-pill.remaining")).toBeNull();
  });

  it("uses the remaining variant for the count chips", () => {
    const { container } = renderCard("archive", false, pastTrip(15, 12));
    expect(container.querySelector(".status-pill.remaining")?.textContent).toBe("○Packed 12 of 15");
    expect(container.querySelector(".status-pill.ready")).toBeNull();
  });

  it("the progress line has one span: the percent packed", () => {
    const { container } = renderCard("archive", false, pastTrip(15, 12));
    const spans = container.querySelectorAll(".progress-copy > span");
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("80% packed");
    expect(article().textContent).not.toContain("12 of 15 packed");
  });

  it("keeps the bar fill and aria-valuenow for a past card", () => {
    renderCard("archive", false, pastTrip(15, 12));
    expect(progressFor(lisbon.destination).getAttribute("aria-valuenow")).toBe("80");
  });

  it("gives historical wording to a trip that ended the day before today", () => {
    renderCard("archive", false, pastTrip(15, 12, { end: "2026-10-15" }));
    expect(within(article()).getByText("Packed 12 of 15")).toBeTruthy();
    expect(within(article()).getByText("Past trip")).toBeTruthy();
  });
});

describe("TripCard place and route lines (unchanged)", () => {
  const porto = (base: LifecycleTrip): LifecycleTrip => ({
    ...base,
    stops: [base.stops[0], { ...base.stops[0], location: { ...base.location!, city: "Porto" } }],
  });

  it("shows the place under the title when there is no route", () => {
    renderCard("upcoming");
    expect(within(article()).getByText("California, United States")).toBeTruthy();
  });

  it("shows no place line for a trip with no confirmed location", () => {
    renderCard("upcoming", false, { ...trip, location: null });
    expect(within(article()).queryByText(/California/)).toBeNull();
  });

  it("shows the stop count when the route is the title", () => {
    renderCard("upcoming", false, { ...porto(trip), destination: "San Diego → Porto" });
    expect(within(article()).getByText("2 stops")).toBeTruthy();
  });

  it("shows the route when the title is something else", () => {
    renderCard("upcoming", false, porto(trip));
    expect(within(article()).queryByText("2 stops")).toBeNull();
    expect(within(article()).getAllByText(/Porto/).length).toBeGreaterThan(0);
  });
});
