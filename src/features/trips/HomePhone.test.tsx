// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { HomePhone } from "./HomePhone";

function renderHome(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  const state = sampleLifecycleState();
  const trip = state.trips.find((entry) => entry.id === "san-diego")!;
  return renderInApp(
    <HomePhone
      trip={trip}
      trips={state.trips}
      later={[]}
      today="2026-10-16"
      weather={{ phase: "none" }}
      map={<svg role="img" aria-label="Route map" />}
      busy={false}
      onEdit={vi.fn()}
      onArchive={vi.fn()}
      onRemove={vi.fn()}
      onOpenArchive={vi.fn()}
    />,
  );
}

describe("HomePhone", () => {
  it("shows the next-trip tag, four tabs and the phone suitcase by default", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Home sections" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      expect.stringMatching(/^Pack\d+\/\d+$/),
      "WeatherAll clear",
      "Future0 trips",
      expect.stringMatching(/^Stamps\d+$/),
    ]);
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("home-phone-panel-pack");
    expect(screen.getByRole("img", { name: "Route map" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Cubes" })).toBeTruthy();
  });

  it("keeps the active panel in the URL and supports keyboard tab selection", async () => {
    const user = userEvent.setup();
    renderHome("?tab=future");
    const future = screen.getByRole("tab", { name: /Future/ });
    expect(future.getAttribute("aria-selected")).toBe("true");
    future.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("home-phone-panel-stamps");
    expect(window.location.search).toBe("?tab=stamps");
    expect(screen.getByRole("group", { name: "Filter stamps" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Past trips" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Lisbon/ }).length).toBeGreaterThan(0);
  });

  it("the Future archive row opens the Stamps panel without navigation", async () => {
    const user = userEvent.setup();
    renderHome("?tab=future");
    await user.click(screen.getByRole("button", { name: /Past trips are with your stamps/ }));
    expect(screen.getByRole("tab", { name: /Stamps/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Past trips" })).toBeTruthy();
  });
});
