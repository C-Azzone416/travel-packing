// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState, SAMPLE_LOCATIONS } from "@/features/trips/fixtures";
import { buildTrip, emptyLifecycleState, type LifecycleState } from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsContent, StampsScreen } from "./StampsScreen";

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
  });

  it("selects the earned sticker first when there is an earned one as well", async () => {
    open();
    const earned = await screen.findByRole("button", { name: LISBON });
    expect(earned.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: SAN_DIEGO }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("selects the trip that was completed most recently, not the one that started last", async () => {
    // Lisbon ran Aug 25 - Sep 20 and San Diego Sep 10-12: San Diego starts later, Lisbon came home later.
    open(
      source(
        withTrips(
          trip("long", "2026-08-25", "2026-09-20"),
          trip("short", "2026-09-10", "2026-09-12", SAMPLE_LOCATIONS["us-ca-san-diego"]),
        ),
      ),
    );
    const lisbon = await screen.findByRole("button", { name: "Lisbon, Aug 2026, inked, 1 trip" });
    expect(lisbon.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "San Diego, Sep 2026, inked, 1 trip" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("selects nothing when no earned sticker exists, even if a past trip has no stops", async () => {
    const bare = { ...trip("bare", "2026-08-01", "2026-08-03"), stops: [] };
    open(source(withTrips(bare, trip("ahead", "2026-11-20", "2026-11-25"))));
    await screen.findByRole("button", { name: "Lisbon, Nov 2026, upcoming, not inked yet" });
    expect(screen.getByText("0 inked")).toBeTruthy();
    expect(screen.queryByRole("article", { name: /Selected trip/ })).toBeNull();
  });

  it("an undated trip with no completed visit is not earned, counted or selected", async () => {
    const legacy = { ...trip("legacy", "2026-11-20", "2026-11-25"), start: "", end: "" };
    const { user } = open(source(withTrips(legacy)));
    await user.click(await screen.findByRole("button", { name: "All time" }));
    expect(await screen.findByText("0 inked")).toBeTruthy();
    const sticker = screen.getByRole("button", { name: /Date not set/ });
    expect(sticker.getAttribute("aria-pressed")).toBe("false");
    expect(sticker.getAttribute("aria-label")).not.toMatch(/inked, \d/);
    expect(screen.queryByRole("article", { name: /Selected trip/ })).toBeNull();
    await user.click(sticker);
    expect(within(screen.getByRole("dialog")).queryByText("Inked")).toBeNull();
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

  it("leaves the Home's teaser stickers decorative, with no tag", () => {
    render(
      <StampsContent state={withTrips(trip("ahead", "2026-11-20", "2026-11-25"))} today={TODAY} />,
    );
    expect(screen.getAllByText("Upcoming").length).toBe(1);
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

  it("opens with focus on the title, shows the route stamps, and gives focus back on Escape and Close", async () => {
    const { user } = open();
    const lisbon = await screen.findByRole("button", { name: LISBON });
    await user.click(lisbon);
    const dialog = screen.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: /Lisbon/ }));
    // The compact route stamps are shown read only: no control for them.
    expect(dialog.querySelector("[data-text]")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(lisbon);
    await user.click(lisbon);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Close/ }));
    expect(document.activeElement).toBe(lisbon);
  });

  it("returns focus to the sticker that opened the sheet, not the previous one (Close and Escape, #493)", async () => {
    // fireEvent.click leaves focus where it was (as Safari does for a tap), so the second opener is the trap.
    const { user } = open();
    const lisbon = await screen.findByRole("button", { name: LISBON });
    const sanDiego = screen.getByRole("button", { name: SAN_DIEGO });
    fireEvent.click(lisbon);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Close/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(sanDiego);
    expect(screen.getByRole("dialog", { name: "San Diego · Oct 2026" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Close/ }));
    expect(document.activeElement).toBe(sanDiego);
    fireEvent.click(lisbon);
    await user.keyboard("{Escape}");
    fireEvent.click(sanDiego);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(sanDiego);
  });

  it("pins the read-only route preview by its accessible name and saved label, apart from the close-up", async () => {
    const { user } = open(
      source(
        withTrips({ ...trip("lisbon", "2026-09-03", "2026-09-07"), stampLabels: ["ZZX", null] }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: LISBON }));
    const dialog = screen.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    const preview = within(dialog).getByRole("img", { name: "ZZX, Lisbon, departure stamp" });
    expect(preview.textContent).toContain("ZZX");
    expect(within(dialog).getByRole("img", { name: LISBON }).textContent).not.toContain("ZZX");
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

  it("is read only: the details offer no label editing", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: LISBON }));
    expect(screen.queryByRole("button", { name: /Edit stamp label/ })).toBeNull();
    expect(within(screen.getByRole("dialog")).getAllByRole("link")).toHaveLength(2);
  });
});
