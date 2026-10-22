// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import { QuickView } from "./QuickView";
import { RouteText } from "./RouteText";
import { TripCard } from "./TripCard";
import { tripCardView } from "./view";

describe("RouteText", () => {
  it("shows the whole route, speaks it in words, and carries the full route as its title", () => {
    const { container } = render(<RouteText cities={["Lisbon", "Porto", "Madrid"]} />);
    expect(container.textContent).toContain("Lisbon → Porto → Madrid");
    expect(screen.getByText("Route: Lisbon, then Porto, then Madrid.")).toBeTruthy();
    expect(container.querySelector(".route-text")?.getAttribute("title")).toBe(
      "Lisbon → Porto → Madrid",
    );
  });

  it("shortens a long route to first, an ellipsis and last, with the stop count", () => {
    const { container } = render(
      <RouteText cities={["Lisbon", "Porto", "Madrid", "Barcelona", "Valencia"]} className="x" />,
    );
    const visible = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(visible.textContent).toBe("Lisbon → … → Valencia · 5 stops");
    expect(container.querySelector(".route-text.x")).toBeTruthy();
    expect(
      screen.getByText(/Route: Lisbon, then Porto, then Madrid, then Barcelona, then Valencia\./),
    ).toBeTruthy();
  });

  it("honours a roomier budget", () => {
    const { container } = render(
      <RouteText cities={["Lisbon", "Porto", "Madrid", "Barcelona", "Valencia"]} budget={80} />,
    );
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "Lisbon → Porto → Madrid → Barcelona → Valencia",
    );
  });
});

describe("the dashboard card and Quick view", () => {
  const multi = () => {
    const [sanDiego, lisbon] = sampleLifecycleState().trips;
    return {
      ...sanDiego,
      stops: [
        { location: sanDiego.location!, arrive: "2026-10-23", leave: "2026-10-25" },
        { location: lisbon.location!, arrive: "2026-10-25", leave: "2026-10-27" },
      ],
    };
  };
  const card = (trip: ReturnType<typeof multi>) => (
    <TripCard
      trip={trip}
      view={tripCardView(trip, "2026-10-16", "upcoming")}
      first
      busy={false}
      onArchive={() => undefined}
      onRestore={() => undefined}
      onRemove={() => undefined}
    />
  );

  it("replaces the place line with the route for a multi-stop trip", () => {
    const { container } = render(card(multi()));
    expect(container.querySelector(".item-meta")?.textContent).toContain("San Diego → Lisbon");
    expect(container.textContent).not.toContain("California, United States");
  });

  it("prints the stop count instead when the title is already the route", () => {
    const trip = { ...multi(), destination: "San Diego → Lisbon" };
    const { container } = render(card(trip));
    expect(container.querySelector(".item-meta")?.textContent).toBe("2 stops");
    expect(container.querySelectorAll(".route-text")).toHaveLength(0);
  });

  it("keeps the place line for a single destination", () => {
    const [single] = sampleLifecycleState().trips;
    const { container } = render(card(single as ReturnType<typeof multi>));
    expect(container.querySelector(".item-meta")?.textContent).toBe("California, United States");
  });

  it("Quick view shows the route above the list, and nothing for one destination", () => {
    const { container, rerender } = render(<QuickView trip={multi()} id="q" />);
    expect(container.querySelector(".quick-view-route")?.textContent).toContain(
      "San Diego → Lisbon",
    );
    rerender(<QuickView trip={sampleLifecycleState().trips[0]} id="q" />);
    expect(container.querySelector(".quick-view-route")).toBeNull();
    rerender(<QuickView trip={{ ...multi(), destination: "San Diego → Lisbon" }} id="q" />);
    expect(container.querySelector(".quick-view-route")).toBeNull();
  });
});
