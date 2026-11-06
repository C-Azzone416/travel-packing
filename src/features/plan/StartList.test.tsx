// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deltaLabel, pastTripLine, StartList, type StartListProps } from "./StartList";

describe("pastTripLine", () => {
  it("is the place, the month and year, and the item count (by quantity)", () => {
    expect(
      pastTripLine({
        destination: "Portland",
        start: "2026-07-03",
        items: [
          { id: "a", name: "A", category: "Clothing", qty: 20, packed: 0, section: "main" },
          { id: "b", name: "B", category: "Clothing", qty: 2, packed: 0, section: "main" },
        ],
      }),
    ).toBe("Portland · Jul 2026 · 22 items");
  });

  it("says '1 item' for one, and leaves a date it cannot read out", () => {
    expect(
      pastTripLine({
        destination: "Reno",
        start: "bad",
        items: [{ id: "a", name: "A", category: "Clothing", qty: 1, packed: 0, section: "main" }],
      }),
    ).toBe("Reno · 1 item");
  });
});

describe("deltaLabel", () => {
  it("signs what a choice does to the count", () => {
    expect(deltaLabel(2)).toBe("+2");
    expect(deltaLabel(22)).toBe("+22");
    expect(deltaLabel(0)).toBe("0");
    expect(deltaLabel(-3)).toBe("−3");
  });
});

const base: StartListProps = {
  nights: null,
  staplesTotal: null,
  laundry: false,
  onLaundry: () => undefined,
  laundryText: "Laundry text",
  weather: { kind: "hidden" },
  weatherAdds: null,
  useWeather: true,
  onUseWeather: () => undefined,
  onWeatherOptIn: () => undefined,
  onWeatherRefresh: () => undefined,
  pastTrips: [],
  copyId: null,
  copyDelta: null,
  onCopy: () => undefined,
  lists: [],
  listId: null,
  listTotal: null,
  listBusy: false,
  listError: false,
  onList: () => undefined,
  preview: null,
};

describe("StartList", () => {
  it("counts the Staples for the trip's nights, or for 'your trip' before the dates", () => {
    const { rerender } = render(<StartList {...base} />);
    expect(
      screen
        .getByRole("checkbox", { name: /Your Staples/ })
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(""),
    ).toBe("Underwear, socks and other per-day items counted for your trip");
    rerender(<StartList {...base} nights={1} staplesTotal={12} />);
    expect(
      screen.getByText("Underwear, socks and other per-day items counted for 1 night"),
    ).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("shows no footer line until there is a preview", () => {
    render(<StartList {...base} />);
    expect(screen.queryByText(/sorted into/)).toBeNull();
  });
});
