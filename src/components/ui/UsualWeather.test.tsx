// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  USUAL_WEATHER_NOTE,
  UsualWeatherBlock,
  WEATHER_OFF_TEXT,
  WeatherOffBlock,
  type UsualWeatherRow,
} from "./UsualWeather";

const ROWS: UsualWeatherRow[] = [
  {
    id: "lis",
    city: "Lisbon",
    dates: "14 – 18 Mar",
    line: "usually mild, about 3 rainy days",
    range: "64° / 51°",
  },
  { id: "opo", city: "Porto", dates: "18 – 24 Mar", unavailable: true, range: "60° / 48°" },
];

describe("UsualWeatherBlock", () => {
  it("says usual weather and when the forecast opens, in words", () => {
    render(<UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("Usual weather, not a forecast");
    expect(screen.getByTestId("forecast-opens").textContent).toContain("Forecast opens Sat 27 Feb");
  });

  it("counts down in days when the forecast opens within a week", () => {
    render(<UsualWeatherBlock start="2026-11-23" today="2026-11-05" rows={ROWS} />);
    expect(screen.getByTestId("forecast-opens").textContent).toContain("Forecast opens in 3 days");
  });

  it("leaves the open date out when the start is not a date", () => {
    render(<UsualWeatherBlock start="" today="2026-11-05" rows={ROWS} />);
    expect(screen.queryByTestId("forecast-opens")).toBeNull();
  });

  it("has one dashed row per stop with the usual line and range, and no alert, tiles or buttons", () => {
    render(<UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Lisbon")).toBeTruthy();
    expect(within(items[0]).getByText("usually mild, about 3 rainy days")).toBeTruthy();
    expect(within(items[0]).getByText("64° / 51°")).toBeTruthy();
    expect(screen.queryByText(/alert/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains a stop with no data and shows no range for it", () => {
    render(<UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} />);
    const item = screen.getAllByRole("listitem")[1];
    expect(item.textContent).toContain("Weather isn’t available for Porto right now.");
    expect(within(item).queryByText("60° / 48°")).toBeNull();
  });

  it("shows a row with neither a line nor a range", () => {
    render(
      <UsualWeatherBlock
        start="2027-03-14"
        today="2027-01-01"
        rows={[{ id: "a", city: "Oslo", dates: "1 Apr" }]}
      />,
    );
    expect(screen.getByRole("listitem").textContent).toContain("Oslo");
  });

  it("shows the 5-years note, and can leave it out", () => {
    const { rerender } = render(
      <UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} />,
    );
    expect(screen.getByText(USUAL_WEATHER_NOTE)).toBeTruthy();
    rerender(
      <UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} showNote={false} />,
    );
    expect(screen.queryByText(USUAL_WEATHER_NOTE)).toBeNull();
  });

  it("uses an h3 inside a card", () => {
    render(
      <UsualWeatherBlock start="2027-03-14" today="2027-01-01" rows={ROWS} headingLevel={3} />,
    );
    expect(screen.getByRole("heading", { level: 3 }).textContent).toContain("Usual weather");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});

describe("WeatherOffBlock", () => {
  it("says weather is off and links to Settings", () => {
    render(<WeatherOffBlock />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Weather is off");
    expect(screen.getByText(WEATHER_OFF_TEXT)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  it("can use an h3 and another link", () => {
    render(<WeatherOffBlock headingLevel={3} settingsHref="/settings#weather" />);
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe(
      "/settings#weather",
    );
  });
});
