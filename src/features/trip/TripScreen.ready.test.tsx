// @vitest-environment jsdom
// All packed, "Review your bag" and Ready on the Packing screen (#411), on both layouts: the ribbon and banner, the sheet, the
// toiletry-bag gate, "I'm ready to go", the Ready chip and "Mark as not ready", and the ?review=1 deep link.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { renderInApp } from "@/test/providers";
import { TripScreen } from "./TripScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push: vi.fn() }),
}));

const realMatchMedia = window.matchMedia;
const layout = { laptop: true };
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: layout.laptop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  window.history.replaceState(null, "", "/");
});

/** San Diego with everything packed but the toiletry bag still outside the suitcase, and not Ready. */
function memory(options: { ready?: boolean; bag?: boolean; short?: number } = {}) {
  const state = sampleLifecycleState();
  state.trips = state.trips.map((trip) =>
    trip.id !== "san-diego"
      ? trip
      : {
          ...trip,
          ready: options.ready ?? false,
          toiletryBagPacked: options.bag ?? false,
          items: trip.items.map((item, index) => ({
            ...item,
            packed: index < (options.short ?? 0) ? 0 : item.qty,
          })),
        },
  );
  return createMemoryTripsSource(state, {
    now: () => 1,
    newId: () => "x",
    today: () => "2026-10-16",
  });
}

function setup(options: Parameters<typeof memory>[0] & { openReview?: boolean } = {}) {
  const source = memory(options);
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId="san-diego" openReview={options.openReview} />
    </TripsSourceProvider>,
  );
  const trip = () => source.snapshot().trips.find((entry) => entry.id === "san-diego")!;
  return { user, source, trip };
}

const title = () => screen.findByRole("heading", { level: 1 });
const sheet = () => screen.findByRole("dialog", { name: "Review your bag" });
const ribbon = (tone: "gold" | "good") => document.querySelector(`[data-packed-ribbon="${tone}"]`);

describe.each([
  ["laptop", true],
  ["phone", false],
])("all packed and Ready on the %s layout", (_name, laptop) => {
  beforeEach(() => {
    layout.laptop = laptop;
  });

  it("all packed: gold ribbon and one banner whose button opens the Review sheet; nothing is Ready by itself", async () => {
    const { user, trip } = setup();
    await title();
    expect(ribbon("gold")?.textContent).toContain("All packed");
    expect(ribbon("good")).toBeNull();
    const banner = document.querySelector("[data-packed-banner]") as HTMLElement;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain(
      "Everything is in. Review your bag to mark the trip Ready.",
    );
    await user.click(within(banner).getByRole("button", { name: "Review your bag" }));
    expect(await sheet()).toBeTruthy();
    expect(trip().ready).toBe(false);
  });

  it("the banner is dismissible, and comes back only after an untick and a new completion", async () => {
    const { user } = setup();
    await title();
    const banner = () => document.querySelector("[data-packed-banner]");
    await user.click(within(banner() as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(banner()).toBeNull();
    // Still all packed: stays dismissed.
    expect(ribbon("gold")).toBeTruthy();
    // Untick one item: the ribbon and banner go; tick it again: the banner returns.
    const box = screen
      .getAllByRole("checkbox")
      .find((entry) => (entry as HTMLInputElement).checked)!;
    await user.click(box);
    await waitFor(() => expect(ribbon("gold")).toBeNull());
    expect(banner()).toBeNull();
    await user.click(box);
    await waitFor(() => expect(banner()).toBeTruthy());
  });

  it("the sheet groups the list by cube with a checkbox per item, and the bag gate offers 'Put bag in suitcase'", async () => {
    const { user, trip } = setup({ openReview: true });
    const dialog = await sheet();
    expect(within(dialog).getByText("FINAL CHECK")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Clothing", level: 3 })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Toiletries", level: 3 })).toBeTruthy();
    expect(within(dialog).getAllByRole("checkbox").length).toBe(trip().items.length);
    expect(within(dialog).getByText(/Nothing becomes Ready automatically/)).toBeTruthy();
    // Blocked: the button says why, and pressing it does nothing.
    const ready = within(dialog).getByRole("button", { name: "I’m ready to go" });
    expect(ready.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(ready.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Confirm your toiletry bag is in the suitcase.",
    );
    await user.click(ready);
    expect(trip().ready).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Put bag in suitcase" }));
    await waitFor(() => expect(trip().toiletryBagPacked).toBe(true));
    // The review owns the bag step: no second "Toiletry bag in suitcase?" prompt opens on top of it.
    expect(screen.queryByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeNull();
    expect(await within(dialog).findByRole("button", { name: "Undo placement" })).toBeTruthy();
  });

  it("the full path: Review, bag, I'm ready to go, Ready ribbon, Mark as not ready", async () => {
    const { user, trip } = setup({ bag: true });
    await title();
    await user.click(
      within(document.querySelector("[data-packed-banner]") as HTMLElement).getByRole("button", {
        name: "Review your bag",
      }),
    );
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    await waitFor(() => expect(trip().ready).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ribbon("good")?.textContent).toContain("Ready");
    expect(ribbon("gold")).toBeNull();
    expect(document.querySelector("[data-packed-banner]")).toBeNull();
    expect(screen.getByText("Ready to go")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(ribbon("gold")).toBeTruthy();
    expect(trip().items.every((item) => item.packed >= item.qty)).toBe(true);
  });

  it("'Review bag' on a Ready trip opens the sheet with 'Mark as not ready'; unticking there revokes Ready", async () => {
    const { user, trip } = setup({ ready: true, bag: true });
    await title();
    await user.click(screen.getAllByRole("button", { name: "Review bag" })[0]);
    const dialog = await sheet();
    expect(within(dialog).queryByRole("button", { name: "I’m ready to go" })).toBeNull();
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(await screen.findByText(/No longer ready: an item was unchecked/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "I’m ready to go" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Back to packing list" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("'Mark as not ready' inside the sheet keeps the packed counts", async () => {
    const { user, trip } = setup({ ready: true, bag: true, openReview: true });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(await screen.findByText("Progress kept.")).toBeTruthy();
    expect(trip().items.every((item) => item.packed >= item.qty)).toBe(true);
  });

  it("?review=1 opens the sheet on load, and closing it puts the plain trip address back", async () => {
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    setup({ openReview: true });
    const dialog = await sheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.pathname + window.location.search).toBe("/trips/san-diego");
  });

  it("without ?review the sheet is closed", async () => {
    setup();
    await title();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an unfinished bag shows no ribbon and no banner", async () => {
    setup({ short: 3 });
    await title();
    expect(ribbon("gold")).toBeNull();
    expect(ribbon("good")).toBeNull();
    expect(document.querySelector("[data-packed-banner]")).toBeNull();
  });
});
