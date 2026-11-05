// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { precipPercent, WeatherDayTile } from "./WeatherDayTile";

const css = readFileSync(
  join(process.cwd(), "src/components/suitcase/WeatherDayTile.module.css"),
  "utf8",
);

describe("precipPercent", () => {
  it.each([
    [0.05, 5],
    [0.8, 80],
    [1.4, 100],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("%s is %s%%", (value, percent) => {
    expect(precipPercent(value)).toBe(percent);
  });
});

describe("WeatherDayTile", () => {
  const base = { day: "Sun", date: "15", high: 68, low: 55 } as const;

  it("a forecast tile has an icon, temperatures and the rain chance, and says it all in one name", () => {
    const { container } = render(
      <WeatherDayTile {...base} icon="cloud" precipProbability={0.05} />,
    );
    expect(
      screen.getByRole("group", { name: "Sun 15, high 68, low 55, 5% chance of rain" }),
    ).toBeTruthy();
    expect(container.querySelector("[data-icon='cloud']")).toBeTruthy();
    expect(container.querySelector("[data-icon='umbrella']")).toBeTruthy();
    expect(container.textContent).toContain("Sun 15");
    expect(container.textContent).toContain("68°");
    expect(container.textContent).toContain("55°");
    expect(container.textContent).toContain("5%");
    expect(
      container.querySelector("[data-weather-state]")?.getAttribute("data-weather-state"),
    ).toBe("normal");
  });

  it("draws a sun in gold and rain in the accent", () => {
    const sun = render(<WeatherDayTile {...base} icon="sun" precipProbability={0} />);
    expect(sun.container.querySelector("[data-icon='sun']")?.getAttribute("class")).toContain(
      "sun",
    );
    sun.unmount();
    const rain = render(<WeatherDayTile {...base} icon="rain" precipProbability={0.7} />);
    expect(rain.container.querySelector("[data-icon='rain']")?.getAttribute("class")).toContain(
      "rain",
    );
    expect(css).toMatch(/\.sun \{\s*color: var\(--gold\)/);
    expect(css).toMatch(/\.rain \{\s*color: var\(--accent\)/);
    expect(css).toMatch(/\.icon \{\s*color: var\(--muted\)/);
  });

  it("a rain day starts at the packing rule (40%): alert, and the name says so", () => {
    const { rerender } = render(<WeatherDayTile {...base} precipProbability={0.39} />);
    expect(screen.getByRole("group").getAttribute("data-weather-state")).toBe("normal");
    expect(screen.getByRole("group").getAttribute("aria-label")).not.toContain("rain day");
    rerender(<WeatherDayTile {...base} precipProbability={0.4} />);
    expect(screen.getByRole("group").getAttribute("data-weather-state")).toBe("alert");
    expect(screen.getByRole("group").getAttribute("aria-label")).toContain(", rain day");
    expect(screen.getByRole("group").className).toContain("alert");
  });

  it("an explicit alert wins over the probability", () => {
    const { rerender } = render(<WeatherDayTile {...base} precipProbability={0.9} alert={false} />);
    expect(screen.getByRole("group").getAttribute("data-weather-state")).toBe("normal");
    rerender(<WeatherDayTile {...base} precipProbability={0.1} alert />);
    expect(screen.getByRole("group").getAttribute("data-weather-state")).toBe("alert");
  });

  it("the alert forecast tile is soft accent fill with a 1.5px accent border and accent rain text", () => {
    expect(css).toMatch(
      /\.forecast \{[^}]*border: 1\.5px solid transparent[^}]*background: var\(--paper\)/,
    );
    expect(css).toMatch(
      /\.forecast\.alert \{\s*border-color: var\(--accent\);\s*background: var\(--accentSoft\)/,
    );
    expect(css).toMatch(/\.forecast\.alert \.precip \{\s*color: var\(--accent\)/);
  });

  it("a compact tile has no icon, a tint when it rains, and 'rain' in words", () => {
    const { container } = render(
      <WeatherDayTile {...base} variant="compact" day="Thu" date="19" precipProbability={0.8} />,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(
      container.querySelector("[data-weather-variant]")?.getAttribute("data-weather-variant"),
    ).toBe("compact");
    expect(container.textContent).toContain("80% rain");
    expect(css).toMatch(/\.compact\.alert \{\s*background: var\(--tint\)/);
    expect(css).toMatch(/\.compact \{[^}]*color-mix\(in srgb, var\(--paper\) 45%, transparent\)/);
  });

  it("the compact day label stays on one line (Sun 22 and Mon 23 no longer wrap at 390)", () => {
    expect(css).toMatch(/\.compact \.day \{[^}]*font-size: 15px;\s*white-space: nowrap/);
  });

  it("keeps the spec sizes: forecast padding 9 6 radius 12 on a laptop, 6 2 radius 10 on a phone", () => {
    expect(css).toMatch(/\.forecast \{[^}]*border-radius: 10px;\s*padding: 6px 2px/);
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*padding: 9px 6px;\s*border-radius: 12px/,
    );
    expect(css).toMatch(/\.compact \{[^}]*border-radius: 12px;\s*padding: 8px 4px/);
  });
});
