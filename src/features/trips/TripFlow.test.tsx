// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { TripFlow } from "./TripFlow";
import { TripsSourceProvider } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push }),
}));

function setup(
  props: { copyId?: string; allowCustom?: boolean } = {},
  wrap?: (base: ReturnType<typeof memory>) => TripsSource,
) {
  push.mockClear();
  const base = memory();
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripFlow {...props} />
    </TripsSourceProvider>,
  );
  return { user, source: base };
}

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

const search = () => screen.getByRole("combobox", { name: "Destination search" });
const cont = () => screen.getByRole("button", { name: "Continue to packing preferences" });
const leave = () => screen.getByLabelText("Leave") as HTMLInputElement;
const ret = () => screen.getByLabelText("Return") as HTMLInputElement;

async function fillDetails(
  user: ReturnType<typeof userEvent.setup>,
  place = "lisbon",
  start = "2026-11-12",
  end = "2026-11-16",
) {
  await user.type(search(), place);
  await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
  fireEvent.change(leave(), { target: { value: start } });
  fireEvent.change(ret(), { target: { value: end } });
}

async function toShapeStep(user: ReturnType<typeof userEvent.setup>, place?: string) {
  await fillDetails(user, place);
  await user.click(cont());
  await screen.findByRole("heading", { name: "Shape the list" });
}

describe("step 1: confirm the trip", () => {
  it("starts empty as a draft, with Continue unavailable and the reason in text", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("New trip")).toBeTruthy();
    expect(
      screen.getByText(/stays a draft and will not appear on the dashboard until you save it/),
    ).toBeTruthy();
    expect(search()).toHaveProperty("value", "");
    expect(leave().value).toBe("");
    expect(ret().value).toBe("");
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    expect(cont().getAttribute("aria-describedby")).toBe("continue-reason");
    expect(screen.getByText("Choose a destination from the list to continue.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sample/i);
  });

  it("free text alone cannot continue; pressing Continue just surfaces the reason", async () => {
    const { user } = setup();
    await user.type(search(), "Somewhere I typed");
    await user.click(cont());
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Choose a destination from the list to continue.").className).toContain(
      "field-error",
    );
  });

  it("ambiguous London requires an explicit choice between the two", async () => {
    const { user } = setup();
    await user.type(search(), "london");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "LondonEngland, United Kingdom",
      "LondonOntario, Canada",
    ]);
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-16" } });
    await user.click(cont());
    expect(screen.queryByRole("heading", { name: "Shape the list" })).toBeNull();
    await user.click(options[1]);
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(screen.getByText(/London · Ontario · Canada/)).toBeTruthy();
    await user.click(cont());
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.getByText(/London, Ontario, Canada/)).toBeTruthy();
  });

  it("after choosing a place it asks for dates next, and moves an earlier return to the departure with a visible notice", async () => {
    const { user } = setup();
    await user.type(search(), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    expect(screen.getByText("Choose your departure and return dates to continue.")).toBeTruthy();
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-10" } });
    expect(ret().value).toBe("2026-11-12");
    expect(screen.getByRole("status", { name: "Date notice" }).textContent).toBe(
      "Return date moved to match your departure.",
    );
    expect(cont().getAttribute("aria-disabled")).toBe("false");
    fireEvent.change(ret(), { target: { value: "2026-11-14" } });
    expect(screen.getByRole("status", { name: "Date notice" }).textContent).toBe("");
    expect(screen.getByText(/Same-day trips are allowed/)).toBeTruthy();
    expect(ret().min).toBe("2026-11-12");
  });

  it("editing the destination text after confirming clears it, and Change does too", async () => {
    const { user } = setup();
    await fillDetails(user);
    expect(cont().getAttribute("aria-disabled")).toBe("false");
    await user.type(search(), "x");
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(cont().getAttribute("aria-disabled")).toBe("true");
    await user.clear(search());
    await user.type(search(), "paris");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(cont().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("step 2: shape the list", () => {
  it("shows the live calculation from the draft and updates everything the moment a preference changes", async () => {
    const { user } = setup();
    await toShapeStep(user);
    expect(screen.getByText("Unsaved trip draft")).toBeTruthy();
    expect(
      screen.getByText("Lisbon, Lisbon District, Portugal · Nov 12 – Nov 16 · 5 days"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3 everyday days" })).toBeTruthy();
    expect(screen.getByText("Simulated · Seasonal outlook")).toBeTruthy();
    const row = (name: string) =>
      screen.getByText(name, { selector: "strong" }).closest(".review-row") as HTMLElement;
    expect(row("Everyday tops").textContent).toContain("2");
    expect(screen.getByRole("switch", { name: "Dedicated return travel outfit" })).toHaveProperty(
      "checked",
      true,
    );

    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    expect(screen.queryByText("Dress shoes", { selector: "strong" })).toBeNull();
    expect(row("Everyday tops").textContent).toContain("3");
    expect(screen.getByRole("status", { name: "List changes" }).textContent).toContain(
      "Everyday tops: 3",
    );
    await user.click(screen.getByRole("switch", { name: "Laundry access" }));
    expect(screen.getByRole("status", { name: "List changes" }).textContent).toBe(
      "Everyday tops: 2, Everyday bottoms: 1",
    );
    await user.click(screen.getByRole("switch", { name: "One spare underwear + socks" }));
    expect(row("Underwear").textContent).toContain("3");
  });

  it("only enables occasions and reuse with Nice outfits, and keeps occasions between 1 and 8", async () => {
    const { user } = setup();
    await toShapeStep(user);
    const occasions = screen.getByLabelText("Occasions") as HTMLInputElement;
    const reuse = screen.getByRole("switch", { name: "Reuse one nice look" }) as HTMLInputElement;
    expect(occasions.disabled).toBe(false);
    fireEvent.change(occasions, { target: { value: "12" } });
    expect(occasions.value).toBe("8");
    fireEvent.change(occasions, { target: { value: "0" } });
    expect(occasions.value).toBe("1");
    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    expect(occasions.disabled).toBe(true);
    expect(reuse.disabled).toBe(true);
    await user.click(screen.getByRole("switch", { name: "Nice outfits" }));
    await user.click(reuse);
    expect(reuse.checked).toBe(false);
  });

  it("return outfit off: shows what the calculator does, and the return set count drops to 0", async () => {
    const { user } = setup();
    await toShapeStep(user);
    expect(
      screen.getByText("A fresh top, bottoms, underwear and socks for the trip home."),
    ).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Dedicated return travel outfit" }));
    expect(
      screen.getByText(
        "No separate return outfit. Your return day is not added to the everyday count.",
      ),
    ).toBeTruthy();
    const returnSet = screen.getByText("RETURN SET").previousElementSibling as HTMLElement;
    expect(returnSet.textContent).toBe("0");
    expect(screen.getByRole("heading", { name: "3 everyday days" })).toBeTruthy();
  });

  it("Edit trip details goes back with everything kept", async () => {
    const { user } = setup();
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Edit trip details" }));
    expect(screen.getByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(leave().value).toBe("2026-11-12");
    expect(ret().value).toBe("2026-11-16");
  });

  it("omits the forecast card for a custom destination", async () => {
    const { user } = setup({ allowCustom: true });
    await user.type(search(), "Grandma's cabin");
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-14" } });
    await user.click(cont());
    expect(await screen.findByText(/Grandma's cabin · Nov 12 – Nov 14 · 3 days/)).toBeTruthy();
    expect(screen.queryByText(/Simulated/)).toBeNull();
  });
});

describe("saving", () => {
  it("is explicit: nothing is saved until Save trip, then the trip is stored, a toast shows and the dashboard opens", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await toShapeStep(user);
    expect(source.snapshot()).toBe(before);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const saved = source.snapshot().trips[0];
    expect(saved).toMatchObject({
      id: "new-1",
      destination: "Lisbon",
      start: "2026-11-12",
      end: "2026-11-16",
      copiedFrom: null,
    });
    expect(saved.items.every((item) => item.packed === 0)).toBe(true);
    expect(source.snapshot().trips).toHaveLength(3);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText("Trip saved"),
    ).toBeTruthy();
  });

  it("shows Saving…, disables the buttons while pending, and does not navigate before the source confirms", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user } = setup(undefined, (base) => ({
      ...base,
      createTrip: async (draft) => (await gate, base.createTrip(draft)),
    }));
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    const saving = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Edit trip details" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(push).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("on failure stays on step 2 with the Error chip; Retry then saves and navigates", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("down"));
    const { user, source } = setup(undefined, (base) => ({
      ...base,
      createTrip: (draft) => {
        create();
        return create.mock.calls.length === 1
          ? Promise.reject(new Error("down"))
          : base.createTrip(draft);
      },
    }));
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await screen.findByRole("button", { name: "Couldn't save, retry" });
    expect(screen.getByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save trip" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(push).not.toHaveBeenCalled();
    expect(source.snapshot().trips).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Couldn't save, retry" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(source.snapshot().trips).toHaveLength(3);
  });
});

describe("cancelling persists nothing", () => {
  it("an untouched draft leaves straight away, with no prompt", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("the back arrow behaves the same as Cancel", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("at step 1, a changed draft asks once; Keep editing stays, Discard leaves, and nothing is saved", async () => {
    const create = vi.fn();
    const { user, source } = setup(undefined, (base) => ({
      ...base,
      createTrip: (draft) => (create(), base.createTrip(draft)),
    }));
    const before = source.snapshot();
    await user.type(search(), "lon");
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this draft?" });
    expect(within(dialog).getByText(/Nothing has been saved/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(create).not.toHaveBeenCalled();
    expect(source.snapshot()).toBe(before);
  });

  it("Escape on the discard prompt keeps editing", async () => {
    const { user } = setup();
    await user.type(search(), "lon");
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.getByRole("dialog", { name: "Discard this draft?" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(search()).toHaveProperty("value", "lon");
  });

  it("at step 2, Cancel draft also asks, and discarding saves nothing", async () => {
    const { user, source } = setup();
    const before = source.snapshot();
    await toShapeStep(user);
    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Discard this draft?" })).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(push).toHaveBeenCalledWith("/");
    expect(source.snapshot()).toBe(before);
    expect(source.snapshot().trips).toHaveLength(2);
  });
});

describe("copy", () => {
  it("opens the same flow seeded with the source's preferences, but an empty destination and dates", async () => {
    const { user } = setup({ copyId: "lisbon" });
    expect(await screen.findByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(screen.getByText("Copy of Lisbon")).toBeTruthy();
    expect(search()).toHaveProperty("value", "");
    expect(leave().value).toBe("");
    expect(ret().value).toBe("");
    expect(screen.getByText(/The original Lisbon trip stays unchanged/)).toBeTruthy();
    await fillDetails(user, "paris", "2026-12-04", "2026-12-08");
    await user.click(cont());
    expect(await screen.findByText("Unsaved copy of Lisbon")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Laundry access" })).toHaveProperty("checked", true);
    expect(screen.getByRole("switch", { name: "One spare underwear + socks" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("saves a new trip with clear progress and leaves the source trip unchanged", async () => {
    const { user, source } = setup({ copyId: "san-diego" });
    const original = structuredClone(
      source.snapshot().trips.find((trip) => trip.id === "san-diego"),
    );
    await screen.findByRole("heading", { name: "Confirm the trip" });
    await fillDetails(user, "paris", "2026-12-04", "2026-12-08");
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const copy = source.snapshot().trips[0];
    expect(copy).toMatchObject({
      destination: "Paris",
      copiedFrom: "san-diego",
      ready: false,
      toiletryBagPacked: false,
    });
    expect(copy.items.every((item) => item.packed === 0)).toBe(true);
    expect(source.snapshot().trips.find((trip) => trip.id === "san-diego")).toEqual(original);
  });

  it("shows a message with a way back when the trip to copy is gone", async () => {
    setup({ copyId: "nope" });
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("shows the same message when the trips cannot be loaded", async () => {
    setup({ copyId: "lisbon" }, (base) => ({
      ...base,
      load: () => Promise.reject(new Error("down")),
    }));
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
  });

  it("shows a loading state while the source trip loads, and ignores a load that finishes after unmount", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { source } = setup({ copyId: "lisbon" }, (base) => ({
      ...base,
      load: async () => (await gate, base.load()),
    }));
    expect(screen.getByRole("region", { name: "Loading trip" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => finish());
    expect(await screen.findByText("Copy of Lisbon")).toBeTruthy();
    expect(source.snapshot().trips).toHaveLength(2);
  });

  it("does not update after unmount when the load resolves or rejects late", async () => {
    push.mockClear();
    let finish!: () => void;
    let fail!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const broken = new Promise<void>(
      (_resolve, reject) => (fail = () => reject(new Error("late"))),
    );
    const base = memory();
    const first = renderInApp(
      <TripsSourceProvider source={{ ...base, load: async () => (await slow, base.load()) }}>
        <TripFlow copyId="lisbon" />
      </TripsSourceProvider>,
    );
    first.unmount();
    const second = renderInApp(
      <TripsSourceProvider source={{ ...base, load: async () => (await broken, base.load()) }}>
        <TripFlow copyId="lisbon" />
      </TripsSourceProvider>,
    );
    second.unmount();
    await act(async () => {
      finish();
      fail();
    });
  });
});
