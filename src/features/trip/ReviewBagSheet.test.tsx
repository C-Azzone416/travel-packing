// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { ReviewBagSheet } from "./ReviewBagSheet";

const sanDiego = (): LifecycleTrip =>
  sampleLifecycleState().trips.find((t) => t.id === "san-diego")!;
const packedAll = (trip: LifecycleTrip): LifecycleTrip => ({
  ...trip,
  items: trip.items.map((item) => ({ ...item, packed: item.qty })),
});

function show(trip: LifecycleTrip, busy = false) {
  const handlers = {
    onTick: vi.fn(),
    onPlaceBag: vi.fn(),
    onUndoBag: vi.fn(),
    onReady: vi.fn(),
    onNotReady: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ReviewBagSheet
      trip={trip}
      busy={busy}
      pending={[]}
      failedRows={new Set()}
      failure={null}
      onRetry={vi.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ReviewBagSheet", () => {
  it("while Bathroom contents are unchecked the gate says 'Waiting on contents' and Ready says how many items are left", () => {
    show(sanDiego());
    const dialog = screen.getByRole("dialog", { name: "Review your bag" });
    expect(within(dialog).getByText("Waiting on contents")).toBeTruthy();
    expect(within(dialog).getByText("Not confirmed")).toBeTruthy();
    const ready = within(dialog).getByRole("button", { name: "I’m ready to go" });
    expect(ready.getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog).getByText(/^Check off \d+ more items$/)).toBeTruthy();
  });

  it("ticking a row asks the screen to pack or unpack that item", async () => {
    const user = userEvent.setup();
    const handlers = show(sanDiego());
    const box = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    await user.click(box);
    expect(handlers.onTick).toHaveBeenCalledWith(expect.objectContaining({}), !box.checked);
  });

  it("a ready-to-go bag presses through: I'm ready to go, Put bag in suitcase / Undo placement, Back", async () => {
    const user = userEvent.setup();
    const pending = show({ ...packedAll(sanDiego()), toiletryBagPacked: false });
    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    expect(pending.onPlaceBag).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Back to packing list" }));
    expect(pending.onClose).toHaveBeenCalledTimes(1);
  });

  it("with the bag placed Ready is available and Undo placement is offered", async () => {
    const user = userEvent.setup();
    const handlers = show({ ...packedAll(sanDiego()), toiletryBagPacked: true });
    await user.click(screen.getByRole("button", { name: "Undo placement" }));
    expect(handlers.onUndoBag).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText(/Confirm your toiletry bag/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "I’m ready to go" }));
    expect(handlers.onReady).toHaveBeenCalledTimes(1);
  });

  it("a busy sheet ignores the bag step and the Ready buttons", async () => {
    const user = userEvent.setup();
    const handlers = show({ ...packedAll(sanDiego()), toiletryBagPacked: false }, true);
    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    expect(handlers.onPlaceBag).not.toHaveBeenCalled();
  });

  it("a Ready trip offers Mark as not ready instead of I'm ready to go", async () => {
    const user = userEvent.setup();
    const handlers = show({ ...packedAll(sanDiego()), toiletryBagPacked: true, ready: true });
    expect(screen.queryByRole("button", { name: "I’m ready to go" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    expect(handlers.onNotReady).toHaveBeenCalledTimes(1);
  });

  it("a busy Ready trip ignores Mark as not ready; a blocked bag ignores I'm ready to go", async () => {
    const user = userEvent.setup();
    const handlers = show({ ...packedAll(sanDiego()), toiletryBagPacked: true, ready: true }, true);
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    expect(handlers.onNotReady).not.toHaveBeenCalled();
  });

  it("a trip with no Bathroom items has no gate row, and the gate sits after the other cubes only when there is no Toiletries cube", () => {
    const trip = sanDiego();
    show({ ...trip, items: trip.items.filter((item) => item.groupId !== "toiletry-bag") });
    expect(screen.queryByText("Toiletry bag in suitcase")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Toiletries" })).toBeNull();
  });

  it("shows Saving… on a row whose tick is not confirmed, and Not saved · Retry on one that failed", async () => {
    const user = userEvent.setup();
    const trip = sanDiego();
    const onRetry = vi.fn();
    render(
      <ReviewBagSheet
        trip={trip}
        busy={false}
        pending={[trip.items[0].id]}
        failedRows={new Set([trip.items[1].id])}
        failure={null}
        onRetry={onRetry}
        onTick={vi.fn()}
        onPlaceBag={vi.fn()}
        onUndoBag={vi.fn()}
        onReady={vi.fn()}
        onNotReady={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Saving…")).toHaveLength(1);
    expect(screen.getByText(/Not saved/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: new RegExp(`^Retry ${trip.items[1].name}`) }),
    );
    expect(onRetry).toHaveBeenCalledWith(trip.items[1].id);
  });

  it("shows a failed bag step or Ready write as an alert inside the sheet, with a Retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <ReviewBagSheet
        trip={sanDiego()}
        busy={false}
        pending={[]}
        failedRows={new Set()}
        failure={{ message: "Marking the trip Ready didn’t save. Nothing was changed.", retry }}
        onRetry={vi.fn()}
        onTick={vi.fn()}
        onPlaceBag={vi.fn()}
        onUndoBag={vi.fn()}
        onReady={vi.fn()}
        onNotReady={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const alert = screen.getByText(/Marking the trip Ready didn’t save/).closest('[role="alert"]')!;
    await user.click(within(alert as HTMLElement).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
