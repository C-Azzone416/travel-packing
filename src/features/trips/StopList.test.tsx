// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { curatedLocationProvider } from "@/domain/location-provider";
import { locationById } from "@/domain/locations";
import type { DraftStop } from "@/domain/trip-lifecycle";
import { StopList } from "./StopList";

const at = (id: string | null, arrive: string, leave: string): DraftStop => ({
  location: id ? locationById(id) : null,
  arrive,
  leave,
});
const THREE = [
  at("pt-lisbon", "2030-05-01", "2030-05-04"),
  at("fr-idf-paris", "2030-05-04", "2030-05-06"),
  at("it-lazio-rome", "2030-05-06", "2030-05-09"),
];

function Harness({
  initial,
  attempted = false,
  onStops,
}: {
  initial: DraftStop[];
  attempted?: boolean;
  onStops?: (stops: DraftStop[]) => void;
}) {
  const [stops, setStops] = useState(initial);
  return (
    <StopList
      stops={stops}
      attempted={attempted}
      provider={curatedLocationProvider}
      onChange={(next) => {
        setStops(next);
        onStops?.(next);
      }}
    />
  );
}

const card = (n: number) => screen.getByRole("group", { name: `Stop ${n}` });
const summary = () => document.querySelector(".route-summary")?.textContent;
const status = () => screen.getByRole("status", { name: "Stops updates" }).textContent;

describe("the stop cards", () => {
  it("shows a card per stop with its number, place, dates and nights, and a route summary", () => {
    render(<Harness initial={THREE} />);
    expect(screen.getAllByRole("group", { name: /^Stop \d$/ })).toHaveLength(3);
    expect(within(card(2)).getByText("Destination confirmed")).toBeTruthy();
    expect(within(card(1)).getByText("3 nights")).toBeTruthy();
    expect(within(card(2)).getByText("2 nights")).toBeTruthy();
    expect(summary()).toBe("Lisbon → Paris → Rome · May 1 – May 9 · 8 nights");
  });

  it("makes Arrive read-only from stop 2 on, with the reason, and editable on stop 1", () => {
    render(<Harness initial={THREE} />);
    expect((screen.getByLabelText("Arrive") as HTMLInputElement).readOnly).toBe(false);
    const second = screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement;
    expect(second.readOnly).toBe(true);
    expect(second.value).toBe("2030-05-04");
    expect(screen.getByText("Same day you leave Stop 1")).toBeTruthy();
    expect(second.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("ignores an edit to Arrive on stops 2+ (iOS opens a picker on read-only date inputs) and marks it read-only", () => {
    render(<Harness initial={THREE} />);
    const second = screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement;
    expect(second.getAttribute("aria-readonly")).toBe("true");
    fireEvent.change(second, { target: { value: "2030-06-20" } });
    expect((screen.getByLabelText("Arrive") as HTMLInputElement).value).toBe("2030-05-01");
    expect((screen.getByLabelText("Leave, Stop 3") as HTMLInputElement).value).toBe("2030-05-09");
    expect(summary()).toContain("8 nights");
  });

  it("changing a Leave date shifts every later stop", () => {
    render(<Harness initial={THREE} />);
    fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2030-05-06" } });
    expect((screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement).value).toBe("2030-05-06");
    expect((screen.getByLabelText("Leave, Stop 3") as HTMLInputElement).value).toBe("2030-05-11");
    expect(summary()).toContain("10 nights");
  });

  it("changing the first Arrive moves the whole trip", () => {
    render(<Harness initial={THREE} />);
    fireEvent.change(screen.getByLabelText("Arrive"), { target: { value: "2030-06-10" } });
    expect((screen.getByLabelText("Leave, Stop 3") as HTMLInputElement).value).toBe("2030-06-18");
  });

  it("confirming a place by search fills the stop", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[THREE[0], at(null, "2030-05-04", "2030-05-06")]} />);
    expect(summary()).toBe("Pick a place for each stop to see your route.");
    await user.type(
      screen.getByRole("combobox", { name: "Destination search, Stop 2" }),
      "seattle",
    );
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    expect(summary()).toBe("Lisbon → Seattle · May 1 – May 6 · 5 nights");
    // Editing the confirmed place clears it again.
    await user.click(within(card(2)).getByRole("button", { name: "Change" }));
    expect(summary()).toBe("Pick a place for each stop to see your route.");
  });
});

describe("polish (#117)", () => {
  it("the move and remove buttons carry SVG icons, not text glyphs or emoji", () => {
    render(<Harness initial={THREE} />);
    for (const name of ["Move Lisbon up", "Move Lisbon down", "Remove Lisbon"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(button.textContent).toBe("");
    }
  });

  it("the nights chip sits in the dates row, with the two dates", () => {
    render(<Harness initial={THREE} />);
    const row = card(1).querySelector(".stop-dates") as HTMLElement;
    expect(row.querySelector(".nights-chip")?.textContent).toBe("3 nights");
    expect(row.querySelectorAll("input")).toHaveLength(2);
  });
});

describe("add, remove and reorder", () => {
  it("adds a stop that arrives the day the last one leaves, focuses its search and announces it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE.slice(0, 2)} />);
    await user.click(screen.getByRole("button", { name: "+ Add another stop" }));
    expect((screen.getByLabelText("Arrive, Stop 3") as HTMLInputElement).value).toBe("2030-05-06");
    expect((screen.getByLabelText("Leave, Stop 3") as HTMLInputElement).value).toBe("2030-05-07");
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Destination search, Stop 3" }),
    );
    expect(status()).toBe("Stop 3 added");
  });

  it("stops offering Add at six stops and says why", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    for (let n = 0; n < 3; n++) {
      await user.click(screen.getByRole("button", { name: "+ Add another stop" }));
    }
    expect(screen.getAllByRole("group", { name: /^Stop \d$/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "+ Add another stop" })).toBeNull();
    expect(screen.getByText("You can add up to 6 stops.")).toBeTruthy();
  });

  it("removes a stop with no place at once, closing the gap and announcing the new length", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[...THREE.slice(0, 2), at(null, "2030-05-06", "2030-05-07")]} />);
    await user.click(screen.getByRole("button", { name: "Remove Stop 3" }));
    expect(screen.queryByRole("group", { name: "Stop 3" })).toBeNull();
    expect(status()).toBe("Stop removed. Trip is now 5 nights.");
  });

  it("asks before removing a stop that has a place; Keep leaves it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    await user.click(screen.getByRole("button", { name: "Remove Paris" }));
    expect(screen.getByText("Remove Paris?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Remove Paris?")).toBeNull();
    expect(screen.getAllByRole("group", { name: /^Stop \d$/ })).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Remove Paris" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getAllByRole("group", { name: /^Stop \d$/ })).toHaveLength(2);
    expect(summary()).toBe("Lisbon → Rome · May 1 – May 7 · 6 nights");
  });

  it("moves a stop up and down, keeping nights, re-deriving dates and announcing it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    await user.click(screen.getByRole("button", { name: "Move Rome up" }));
    expect(summary()).toBe("Lisbon → Rome → Paris · May 1 – May 9 · 8 nights");
    expect(status()).toBe("Rome moved to stop 2. Dates updated.");
    await user.click(screen.getByRole("button", { name: "Move Lisbon down" }));
    expect(summary()).toBe("Rome → Lisbon → Paris · May 1 – May 9 · 8 nights");
    expect((screen.getByLabelText("Leave") as HTMLInputElement).value).toBe("2030-05-04");
  });

  it("keeps a search box's text with its stop when stops are reordered", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[THREE[0], at(null, "2030-05-04", "2030-05-06")]} />);
    await user.type(screen.getByRole("combobox", { name: "Destination search, Stop 2" }), "sea");
    await user.click(screen.getByRole("button", { name: "Move Stop 2 up" }));
    expect(
      (screen.getByRole("combobox", { name: "Destination search, Stop 1" }) as HTMLInputElement)
        .value,
    ).toBe("sea");
  });

  it("marks the first Move up and the last Move down aria-disabled and ignores them", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    const up = screen.getByRole("button", { name: "Move Lisbon up" });
    const down = screen.getByRole("button", { name: "Move Rome down" });
    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(down.getAttribute("aria-disabled")).toBe("true");
    await user.click(up);
    await user.click(down);
    expect(summary()).toBe("Lisbon → Paris → Rome · May 1 – May 9 · 8 nights");
  });
});

describe("validation messages", () => {
  it("says to stay a night when Leave is not after Arrive, as soon as it happens", () => {
    render(<Harness initial={THREE} />);
    fireEvent.change(screen.getByLabelText("Leave, Stop 2"), { target: { value: "2030-05-04" } });
    expect(
      within(card(2)).getByText("Stay at least one night. Leave must be after you arrive."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Leave, Stop 2").getAttribute("aria-invalid")).toBe("true");
  });

  it("asks for a place only after Continue was pressed, and counts the problems", () => {
    const { rerender } = render(
      <StopList
        stops={[THREE[0], at(null, "2030-05-04", "2030-05-06")]}
        attempted={false}
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByText("Pick a place for Stop 2, or choose Custom.")).toBeNull();
    rerender(
      <StopList
        stops={[THREE[0], at(null, "2030-05-04", "2030-05-06")]}
        attempted
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("Pick a place for Stop 2, or choose Custom.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Fix 1 thing above to continue.");
  });

  it("explains a gap on the later stop's Arrive and offers Fix dates", async () => {
    const user = userEvent.setup();
    const broken = [THREE[0], { ...THREE[1], arrive: "2030-05-05" }];
    render(<Harness initial={broken} />);
    expect(screen.getByText(/Stop 2 must start the day you leave Stop 1 \(May 4\)\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Fix dates" }));
    expect((screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement).value).toBe("2030-05-04");
    expect(screen.queryByRole("button", { name: "Fix dates" })).toBeNull();
  });

  it("does not shout 'Choose a date' until Continue was pressed", () => {
    const blank = [at("pt-lisbon", "", ""), at("fr-idf-paris", "", "")];
    const { rerender } = render(
      <StopList
        stops={blank}
        attempted={false}
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByText("Choose a date.")).toBeNull();
    rerender(
      <StopList
        stops={blank}
        attempted
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    expect(screen.getAllByText("Choose a date.").length).toBeGreaterThan(0);
  });
});

describe("a notice under the first Arrive", () => {
  it("shows at once, as an error tied to the field", () => {
    render(
      <StopList
        stops={THREE}
        attempted={false}
        arriveNotice="Choose a new start date for the copy."
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    const arrive = screen.getByLabelText("Arrive");
    const notice = screen.getByText("Choose a new start date for the copy.");
    expect(notice.className).toContain("field-error");
    expect(arrive.getAttribute("aria-invalid")).toBe("true");
    expect(arrive.getAttribute("aria-describedby")).toBe(notice.id);
  });

  it("gives way to a real problem with the same field", () => {
    const broken = [{ ...THREE[0], arrive: "" }, THREE[1]];
    render(
      <StopList
        stops={broken}
        attempted
        arriveNotice="Choose a new start date for the copy."
        provider={curatedLocationProvider}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByText("Choose a new start date for the copy.")).toBeNull();
    expect(screen.getAllByText("Choose a date.").length).toBeGreaterThan(0);
  });
});

describe("a single stop (the edit sheet)", () => {
  it("has no numbers, move or remove, no nights chip, and allows a day trip", () => {
    render(<Harness initial={[at("pt-lisbon", "2030-05-01", "2030-05-01")]} />);
    expect(screen.queryByRole("button", { name: /Move|Remove/ })).toBeNull();
    expect(document.querySelector(".nights-chip")).toBeNull();
    expect(screen.queryByText(/Stay at least one night/)).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add another stop" })).toBeTruthy();
  });
});
