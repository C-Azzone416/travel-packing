// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { curatedLocationProvider } from "@/domain/location-provider";
import { LOCATIONS } from "@/domain/locations";
import type { DraftStop } from "@/domain/trip-lifecycle";
import { StopRows } from "./StopRows";

const place = (id: string) => LOCATIONS.find((entry) => entry.id === id)!;
const stop = (id: string | null, arrive = "", leave = ""): DraftStop => ({
  location: id ? place(id) : null,
  arrive,
  leave,
});

function Harness({
  initial,
  attempted = false,
  onChange,
}: {
  initial: DraftStop[];
  attempted?: boolean;
  onChange?: (stops: DraftStop[]) => void;
}) {
  const [stops, setStops] = useState(initial);
  return (
    <StopRows
      stops={stops}
      attempted={attempted}
      provider={curatedLocationProvider}
      onChange={(next) => {
        setStops(next);
        onChange?.(next);
      }}
    />
  );
}

const cities = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("span[class*=stopName]")?.textContent);

const THREE = [
  stop("gb-eng-london", "2026-11-10", "2026-11-12"),
  stop("pt-lisbon", "2026-11-12", "2026-11-15"),
  stop("fr-idf-paris", "2026-11-15", "2026-11-16"),
];

describe("StopRows", () => {
  it("shows a confirmed place as a row with its dates, and a missing one as the search box", () => {
    render(<Harness initial={[...THREE.slice(0, 2), stop(null)]} />);
    const list = screen.getByRole("list");
    expect(within(list).getByText("London")).toBeTruthy();
    expect(within(list).getByText("10–12 Nov")).toBeTruthy();
    expect(within(list).getByText("12–15 Nov")).toBeTruthy();
    expect(within(list).getByRole("combobox", { name: "Destination search, Stop 3" })).toBeTruthy();
  });

  it("shows no dates until the dates step is done", () => {
    render(<Harness initial={[stop("gb-eng-london"), stop("pt-lisbon")]} />);
    expect(screen.queryByText(/Nov/)).toBeNull();
  });

  it("adds a stop, focuses its search box, announces it, and stops at six", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[stop("gb-eng-london")]} />);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    const box = screen.getByRole("combobox", { name: "Destination search, Stop 2" });
    expect(document.activeElement).toBe(box);
    expect(screen.getByRole("status", { name: "Stops updates" }).textContent).toBe("Stop 2 added");
    await user.type(box, "par");
    await user.click(await screen.findByRole("option", { name: /France/ }));
    for (let at = 3; at <= 6; at += 1) {
      await user.click(screen.getByRole("button", { name: "Add a stop" }));
      await user.type(screen.getByRole("combobox"), "lon");
      await user.click((await screen.findAllByRole("option"))[0]);
    }
    expect(screen.queryByRole("button", { name: "Add a stop" })).toBeNull();
    expect(screen.getByText("You can add up to 6 stops.")).toBeTruthy();
  });

  it("moves a stop up and down with buttons, keeps the route contiguous, and announces it", async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    render(<Harness initial={THREE} onChange={seen} />);
    const list = screen.getByRole("list");
    await user.click(screen.getByRole("button", { name: "Move London down" }));
    expect(cities(list)).toEqual(["Lisbon", "London", "Paris"]);
    expect(screen.getByRole("status", { name: "Stops updates" }).textContent).toBe(
      "London moved to stop 2",
    );
    expect(seen.mock.lastCall![0].map((entry: DraftStop) => [entry.arrive, entry.leave])).toEqual([
      ["2026-11-10", "2026-11-13"],
      ["2026-11-13", "2026-11-15"],
      ["2026-11-15", "2026-11-16"],
    ]);
    // Focus stays on the button that moved the stop, wherever the row went.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move London down" }));
    await user.click(screen.getByRole("button", { name: "Move Paris up" }));
    expect(cities(list)).toEqual(["Lisbon", "Paris", "London"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Paris up" }));
  });

  it("does nothing for a move past either end (the button says it is disabled)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    const up = screen.getByRole("button", { name: "Move London up" });
    const down = screen.getByRole("button", { name: "Move Paris down" });
    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(down.getAttribute("aria-disabled")).toBe("true");
    await user.click(up);
    await user.click(down);
    expect(cities(screen.getByRole("list"))).toEqual(["London", "Lisbon", "Paris"]);
  });

  it("removes a stop and closes the gap", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    await user.click(screen.getByRole("button", { name: "Remove Lisbon" }));
    const list = screen.getByRole("list");
    expect(cities(list)).toEqual(["London", "Paris"]);
    expect(screen.getByRole("status", { name: "Stops updates" }).textContent).toBe(
      "Lisbon removed. 2 stops left.",
    );
    expect(within(list).getByText("12–13 Nov")).toBeTruthy();
  });

  it("removes a stop whose place is not chosen yet", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[stop("gb-eng-london"), stop(null)]} attempted />);
    expect(screen.getByText("Choose a place for Stop 2.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove Stop 2" }));
    expect(screen.queryByRole("combobox", { name: /Stop 2/ })).toBeNull();
  });

  it("with one stop, the × clears the place and returns to the search box", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[stop("gb-eng-london", "2026-11-10", "2026-11-12")]} />);
    expect(screen.queryByRole("button", { name: /Move London/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change London" }));
    const box = screen.getByRole("combobox", { name: "Destination search" });
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(box);
    expect(screen.getByRole("status", { name: "Stops updates" }).textContent).toBe(
      "London cleared",
    );
    expect(screen.queryByRole("button", { name: /Remove Stop/ })).toBeNull();
  });

  it("keeps the first search text a copy arrived with, and an unfinished stop's own text when others move", async () => {
    const user = userEvent.setup();
    render(
      <StopRows
        stops={[stop(null)]}
        attempted={false}
        provider={curatedLocationProvider}
        firstQuery="Lisb"
        onChange={() => undefined}
      />,
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Lisb");
    await user.type(screen.getByRole("combobox"), "o");
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Lisbo");
  });

  describe("dragging", () => {
    function drag(from: HTMLElement, to: HTMLElement) {
      const data = new Map<string, string>();
      const transfer = {
        effectAllowed: "",
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? "",
      };
      fireEvent(from, Object.assign(createEvent.dragStart(from), { dataTransfer: transfer }));
      fireEvent(to, Object.assign(createEvent.dragOver(to), { dataTransfer: transfer }));
      return {
        transfer,
        drop: () => fireEvent(to, Object.assign(createEvent.drop(to), { dataTransfer: transfer })),
      };
    }
    const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

    it("reorders the route by dragging a row onto another", () => {
      render(<Harness initial={THREE} />);
      const { drop, transfer } = drag(row("London"), row("Paris"));
      expect(transfer.effectAllowed).toBe("move");
      expect(row("Paris").hasAttribute("data-over")).toBe(true);
      expect(row("London").hasAttribute("data-dragging")).toBe(true);
      drop();
      expect(cities(screen.getByRole("list"))).toEqual(["Lisbon", "Paris", "London"]);
      expect(screen.getByRole("status", { name: "Stops updates" }).textContent).toBe(
        "London moved to stop 3",
      );
      expect(screen.getByText("London").closest("li")!.hasAttribute("data-dragging")).toBe(false);
    });

    it("does nothing when dropped on itself, and clears the markers when the drag ends", () => {
      render(<Harness initial={THREE} />);
      const london = row("London");
      const { drop } = drag(london, london);
      drop();
      expect(cities(screen.getByRole("list"))).toEqual(["London", "Lisbon", "Paris"]);
      drag(london, row("Lisbon"));
      fireEvent.dragEnd(london);
      expect(row("Lisbon").hasAttribute("data-over")).toBe(false);
    });

    it("ignores a drop that did not start on a row", () => {
      render(<Harness initial={THREE} />);
      const target = row("Paris");
      fireEvent.dragOver(target);
      fireEvent.drop(target);
      expect(cities(screen.getByRole("list"))).toEqual(["London", "Lisbon", "Paris"]);
    });

    it("is not draggable with a single stop", () => {
      render(<Harness initial={[stop("gb-eng-london")]} />);
      expect(row("London").getAttribute("draggable")).toBe("false");
    });
  });
});
