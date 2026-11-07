// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import { HomeEmpty } from "./HomeEmpty";
import { noTripModel } from "./home-view";

const FIRST = noTripModel([], "2026-12-01");
const RETURNING = noTripModel(sampleLifecycleState().trips, "2026-12-01");

function renderEmpty(
  model = FIRST,
  options: { laptop?: boolean; homeCityUnset?: boolean; hasHistory?: boolean } = {},
) {
  const onOpenArchive = vi.fn();
  render(
    <HomeEmpty
      model={model}
      laptop={options.laptop ?? false}
      homeCityUnset={options.homeCityUnset ?? false}
      hasHistory={options.hasHistory ?? false}
      onOpenArchive={onOpenArchive}
    />,
  );
  return onOpenArchive;
}

describe("the first-run Home", () => {
  it("welcomes with Where to first?, the two actions and five empty dashed cubes", () => {
    renderEmpty();
    expect(screen.getByRole("heading", { name: "Trips", level: 1 })).toBeTruthy();
    expect(screen.getByText("WELCOME")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where to first?", level: 2 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "+ Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    expect(screen.getByRole("link", { name: "Set up your Staples" }).getAttribute("href")).toBe(
      "/staples",
    );
    const suitcase = document.querySelector("[data-empty-suitcase]")!;
    expect(suitcase.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(suitcase.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Clothing-",
      "Toiletries-",
      "Tech-",
      "Documents-",
      "Misc-",
    ]);
    expect(suitcase.textContent).toContain("0 of 0");
  });

  it("shows the home-city nudge only while the home city is unset", () => {
    const { unmount } = render(
      <HomeEmpty
        model={FIRST}
        laptop={false}
        homeCityUnset
        hasHistory={false}
        onOpenArchive={() => undefined}
      />,
    );
    const nudge = screen.getByRole("link", {
      name: "Set your home city so trips know where you\u2019re leaving from ›",
    });
    expect(nudge.getAttribute("href")).toBe("/settings");
    unmount();
    renderEmpty();
    expect(screen.queryByRole("link", { name: /Set your home city/ })).toBeNull();
  });

  it("links the phone to Stamps with a dashed row, and the laptop does not", () => {
    const { unmount } = render(
      <HomeEmpty
        model={FIRST}
        laptop={false}
        homeCityUnset={false}
        hasHistory={false}
        onOpenArchive={() => undefined}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Your stamps will collect here ›" }).getAttribute("href"),
    ).toBe("/stamps");
    unmount();
    renderEmpty(FIRST, { laptop: true });
    expect(screen.queryByRole("link", { name: /Your stamps will collect here/ })).toBeNull();
  });

  it("offers Past & archive only when there is history, and opens it", async () => {
    const none = renderEmpty();
    expect(screen.queryByRole("button", { name: "Past & archive" })).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });

  it("opens the Past & archive list from the history button", async () => {
    const open = renderEmpty(FIRST, { hasHistory: true });
    await userEvent.setup().click(screen.getByRole("button", { name: "Past & archive" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("the returning Home", () => {
  it("laptop: Where to next?, the Stamps teaser, and the recent trips with a way to each", () => {
    const open = renderEmpty(RETURNING, { laptop: true });
    expect(screen.getByText("WELCOME BACK")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where to next?", level: 2 })).toBeTruthy();
    expect(screen.getByText("Your Staples are ready to start the list.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Stickers · Last 12 months/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All stamps ›" }).getAttribute("href")).toBe("/stamps");
    const recent = screen.getByRole("region", { name: "Recent trips" });
    const rows = within(recent).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("href")).toMatch(/^\/stamps\?trip=/);
    expect(rows[0].textContent).toContain("packed");
    // The laptop keeps the archive reachable in the Recent trips heading row.
    expect(screen.getByRole("button", { name: "Past & archive" })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it("phone: the hero, the recent trips and a dashed All stamps row, with no teaser suitcase", () => {
    renderEmpty(RETURNING, { laptop: false, homeCityUnset: true });
    expect(screen.getByRole("heading", { name: "Where to next?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Set your home city/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Stickers/ })).toBeNull();
    expect(screen.getByRole("link", { name: "All stamps ›" }).getAttribute("href")).toBe("/stamps");
    expect(screen.getAllByRole("link", { name: /packed/ })).toHaveLength(2);
  });

  it("the teaser stickers are decoration, not controls", () => {
    renderEmpty(RETURNING, { laptop: true });
    expect(document.querySelectorAll('[data-decorative="true"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /, \d+ trips?$/ })).toBeNull();
  });

  it("says so when the last 12 months hold no stickers", () => {
    const old = noTripModel(
      [{ ...sampleLifecycleState().trips[1], start: "2024-01-03", end: "2024-01-05" }],
      "2026-12-01",
    );
    renderEmpty(old, { laptop: true });
    expect(screen.getByText("No stickers in this window yet.")).toBeTruthy();
  });
});
