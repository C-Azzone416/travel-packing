// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import { TripCard } from "./TripCard";
import { tripCardView } from "./view";

const TODAY = "2026-10-16";
const trip = sampleLifecycleState().trips.find((entry) => entry.id === "san-diego")!;

function renderCard(listView: "upcoming" | "archive", busy = false) {
  const handlers = { onArchive: vi.fn(), onRestore: vi.fn(), onRemove: vi.fn() };
  render(
    <TripCard
      trip={trip}
      view={tripCardView(trip, TODAY, listView)}
      first={false}
      busy={busy}
      {...handlers}
    />,
  );
  return handlers;
}

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
});
