// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { TripFlow } from "./TripFlow";
import { TripsSourceProvider } from "./TripsSourceProvider";
import { createMemoryTripsSource } from "./trips-source";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push }),
}));

function setup(props: { copyId?: string } = {}, state = sampleLifecycleState()) {
  push.mockClear();
  let counter = 0;
  const source = createMemoryTripsSource(state, {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripFlow {...props} getToday={() => "2026-10-16"} />
    </TripsSourceProvider>,
  );
  return { user, source };
}

const cont = () => screen.getByRole("button", { name: "Continue to packing preferences" });
const add = () => screen.getByRole("button", { name: "+ Add another stop" });

async function pick(user: ReturnType<typeof userEvent.setup>, name: string, text: string) {
  await user.type(screen.getByRole("combobox", { name }), text);
  await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
}

async function twoStops(user: ReturnType<typeof userEvent.setup>) {
  await pick(user, "Destination search", "lisbon");
  fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2026-11-12" } });
  fireEvent.change(screen.getByLabelText("Return"), { target: { value: "2026-11-15" } });
  await user.click(add());
  await pick(user, "Destination search, Stop 2", "paris");
}

describe("one stop looks and behaves as before", () => {
  it("offers Add another stop with its helper, and no stop numbers or reorder controls", () => {
    setup();
    expect(add()).toBeTruthy();
    expect(screen.getByText("Visiting more than one place? Add each stop in order.")).toBeTruthy();
    expect(screen.queryByText("Stop 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Move|Remove/ })).toBeNull();
  });
});

describe("a route of several stops", () => {
  it("turns into stop cards on Add, carrying the first stop's place and dates over", async () => {
    const { user } = setup();
    await pick(user, "Destination search", "lisbon");
    fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Return"), { target: { value: "2026-11-15" } });
    await user.click(add());
    expect(screen.getByRole("group", { name: "Stop 1" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Stop 2" })).toBeTruthy();
    expect((screen.getByLabelText("Arrive") as HTMLInputElement).value).toBe("2026-11-12");
    expect((screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement).value).toBe("2026-11-15");
    expect(
      within(screen.getByRole("group", { name: "Stop 1" })).getByText("Destination confirmed"),
    ).toBeTruthy();
  });

  it("keeps what was typed in the first search box when the route grows", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox", { name: "Destination search" }), "lis");
    await user.click(add());
    expect(
      (screen.getByRole("combobox", { name: "Destination search, Stop 1" }) as HTMLInputElement)
        .value,
    ).toBe("lis");
  });

  it("explains why Continue is unavailable, then continues once the route is complete", async () => {
    const { user } = setup();
    await pick(user, "Destination search", "lisbon");
    fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Return"), { target: { value: "2026-11-15" } });
    await user.click(add());
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText("Fix 1 thing above to continue.").length).toBeGreaterThan(0);
    await user.click(cont());
    expect(screen.getByText("Pick a place for Stop 2, or choose Custom.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();

    await pick(user, "Destination search, Stop 2", "paris");
    expect(cont().getAttribute("aria-disabled")).not.toBe("true");
    await user.click(cont());
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.getByText(/Lisbon → Paris · Nov 12 – Nov 16 · 5 days/)).toBeTruthy();
  });

  it("saves the whole route as one trip", async () => {
    const { user, source } = setup();
    await twoStops(user);
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const saved = source.snapshot().trips[0];
    expect(saved.destination).toBe("Lisbon → Paris");
    expect(saved.stops.map((stop) => [stop.location.city, stop.arrive, stop.leave])).toEqual([
      ["Lisbon", "2026-11-12", "2026-11-15"],
      ["Paris", "2026-11-15", "2026-11-16"],
    ]);
    expect(saved).toMatchObject({ start: "2026-11-12", end: "2026-11-16" });
  });

  it("goes back to the single-destination layout when only one stop is left", async () => {
    const { user } = setup();
    await twoStops(user);
    await user.click(screen.getByRole("button", { name: "Remove Paris" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("group", { name: "Stop 1" })).toBeNull();
    expect((screen.getByLabelText("Leave") as HTMLInputElement).value).toBe("2026-11-12");
    expect(
      (screen.getByRole("combobox", { name: "Destination search" }) as HTMLInputElement).value,
    ).toBe("Lisbon, Lisbon District");
    expect(cont().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("asks before discarding a multi-stop draft", async () => {
    const { user } = setup();
    await twoStops(user);
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    expect(screen.getByRole("dialog", { name: "Discard this draft?" })).toBeTruthy();
  });
});

describe("copying a multi-stop trip", () => {
  function withRoute() {
    const state = sampleLifecycleState();
    const [sanDiego, lisbon] = state.trips;
    const route = {
      ...sanDiego,
      id: "tour",
      destination: "San Diego → Lisbon",
      stops: [
        { location: sanDiego.location!, arrive: "2026-10-23", leave: "2026-10-26" },
        { location: lisbon.location!, arrive: "2026-10-26", leave: "2026-10-29" },
      ],
      end: "2026-10-29",
    };
    return { ...state, trips: [route, ...state.trips] };
  }

  it("starts from the source's route and shifts every stop when the first arrival moves", async () => {
    const { user, source } = setup({ copyId: "tour" }, withRoute());
    await screen.findByRole("group", { name: "Stop 1" });
    expect(screen.getByText("Copy of San Diego → Lisbon")).toBeTruthy();
    // The source's own dates cannot be saved as the copy's.
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText("Choose a new start date for the copy.").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Arrive"), { target: { value: "2027-01-10" } });
    expect((screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement).value).toBe("2027-01-13");
    expect((screen.getByLabelText("Leave, Stop 2") as HTMLInputElement).value).toBe("2027-01-16");
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const copy = source.snapshot().trips[0];
    expect(copy).toMatchObject({ copiedFrom: "tour", start: "2027-01-10", end: "2027-01-16" });
    expect(copy.stops).toHaveLength(2);
  });
});
