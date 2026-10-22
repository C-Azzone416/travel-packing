// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { StopWeather } from "@/domain/weather/types";
import { renderInApp } from "@/test/providers";
import type { SavedListDetail } from "@/server/data/service";
import { updatedText } from "@/features/saved-lists/saved-lists-view";
import { sampleLifecycleState } from "./fixtures";
import { TripFlow } from "./TripFlow";
import { TripsSourceProvider } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push }),
}));

const BEACH: SavedListDetail = {
  id: "list-beach",
  name: "Beach week",
  updatedAt: "2026-10-12T10:00:00.000Z",
  items: [
    { id: "i1", name: "Swimsuit", category: "Clothing", qty: 2 },
    { id: "i2", name: "Sunscreen", category: "Bathroom", qty: 1 },
    { id: "i3", name: "Phone charger", category: "Tech", qty: 1 },
    { id: "i4", name: "Swimsuit", category: "Clothing", qty: 1 },
  ],
};
const WORK: SavedListDetail = {
  id: "list-work",
  name: "Work trip",
  updatedAt: "2026-10-01T10:00:00.000Z",
  items: [{ id: "w1", name: "Laptop", category: "Tech", qty: 1 }],
};
const EMPTY: SavedListDetail = {
  id: "list-empty",
  name: "Nothing yet",
  updatedAt: "2026-09-01T10:00:00.000Z",
  items: [],
};

function memory(savedLists?: readonly SavedListDetail[]) {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
    ...(savedLists ? { savedLists } : {}),
  });
}

function setup(
  options: {
    lists?: readonly SavedListDetail[];
    copyId?: string;
    wrap?: (b: ReturnType<typeof memory>) => TripsSource;
  } = {},
) {
  push.mockClear();
  const base = memory(options.lists);
  const source = options.wrap ? options.wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripFlow {...(options.copyId ? { copyId: options.copyId } : {})} />
    </TripsSourceProvider>,
  );
  return { user, base, source };
}

const search = () => screen.getByRole("combobox", { name: "Destination search" });
const leave = () => screen.getByLabelText("Leave") as HTMLInputElement;
const ret = () => screen.getByLabelText("Return") as HTMLInputElement;

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(search(), "lisbon");
  await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
  fireEvent.change(leave(), { target: { value: "2026-11-12" } });
  fireEvent.change(ret(), { target: { value: "2026-11-16" } });
}

const continueButton = (name: string | RegExp) => screen.getByRole("button", { name });

async function toStartStep(user: ReturnType<typeof userEvent.setup>) {
  await fillDetails(user);
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Start from a saved list" });
}

describe("no saved lists, or a copy: the flow is exactly today's", () => {
  it("shows no list step and the usual button when the source has no lists", async () => {
    const { user } = setup();
    await fillDetails(user);
    await user.click(continueButton("Continue to packing preferences"));
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Start from a saved list" })).toBeNull();
  });

  it("shows no list step when the owner has an empty set of lists", async () => {
    const { user } = setup({ lists: [] });
    await fillDetails(user);
    await user.click(continueButton("Continue to packing preferences"));
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
  });

  it("never offers a list when copying a trip, even if the owner has lists", async () => {
    const { user } = setup({ lists: [BEACH], copyId: "san-diego" });
    await screen.findByRole("heading", { name: "Confirm the trip" });
    expect(screen.getByText(/^Copy of /)).toBeTruthy();
    await user.type(search(), "lisbon");
    await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
    fireEvent.change(leave(), { target: { value: "2026-11-12" } });
    fireEvent.change(ret(), { target: { value: "2026-11-16" } });
    await user.click(continueButton("Continue to packing preferences"));
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Start from a saved list" })).toBeNull();
  });
});

describe("the Start from a saved list step", () => {
  it("is optional: it appears after the details with 'Continue', and 'No saved list' is selected by default", async () => {
    const { user } = setup({ lists: [BEACH, WORK] });
    await toStartStep(user);
    expect(screen.getByText(/Optional\. Pick one list/)).toBeTruthy();
    const group = screen.getByRole("radiogroup", { name: "Starting point" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(within(group).getByRole("radio", { name: /No saved list/ })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /Beach week/ })).toBeTruthy();
    expect(screen.getByText(`4 items · updated ${updatedText(BEACH.updatedAt)}`)).toBeTruthy();
    expect(screen.getByText(`1 item · updated ${updatedText(WORK.updatedAt)}`)).toBeTruthy();
    expect(screen.getByRole("status", { name: "Saved list choice" }).textContent).toBe("");
  });

  it("choosing none continues to today's Shape the list, and the trip gets staples plus recommendations", async () => {
    const { user, base } = setup({ lists: [BEACH] });
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.getByText("Your packing preferences")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const created = base.snapshot().trips[0];
    expect(created.items.some((item) => item.id === "socks")).toBe(true);
    expect(created.items.some((item) => item.id.startsWith("saved:"))).toBe(false);
  });

  it("choosing a list says it replaces staples and recommendations, in a polite status", async () => {
    const { user } = setup({ lists: [BEACH, WORK] });
    await toStartStep(user);
    await user.click(screen.getByRole("radio", { name: /Beach week/ }));
    const status = screen.getByRole("status", { name: "Saved list choice" });
    expect(status.textContent).toMatch(/“Beach week” replaces your staples and recommendations\./);
    expect(status.textContent).toMatch(/only this list’s 4 items, all unpacked/);
    expect(status.textContent).toMatch(/Later edits to the list won’t change this trip/);
    await user.click(screen.getByRole("radio", { name: /No saved list/ }));
    expect(screen.getByRole("status", { name: "Saved list choice" }).textContent).toBe("");
  });

  it("is a single select: picking a second list unpicks the first", async () => {
    const { user } = setup({ lists: [BEACH, WORK] });
    await toStartStep(user);
    await user.click(screen.getByRole("radio", { name: /Beach week/ }));
    await user.click(screen.getByRole("radio", { name: /Work trip/ }));
    const checked = (screen.getAllByRole("radio") as HTMLInputElement[]).filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].closest("label")?.textContent).toMatch(/Work trip/);
  });

  it("previews a list's items inline without choosing it", async () => {
    const { user } = setup({ lists: [BEACH, WORK] });
    await toStartStep(user);
    const toggle = screen.getByRole("button", { name: "Preview items in Beach week" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = await screen.findByRole("region", { name: "Items in Beach week" });
    expect(within(region).getByText("Phone charger")).toBeTruthy();
    expect(within(region).getByText("Clothing · qty 2")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /No saved list/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(toggle);
    expect(screen.queryByRole("region", { name: "Items in Beach week" })).toBeNull();
  });

  it("says so when a preview cannot load, and still lets the person choose", async () => {
    const { user } = setup({
      lists: [BEACH],
      wrap: (base) => ({
        ...base,
        savedLists: {
          list: base.savedLists!.list,
          get: async () => {
            throw new Error("nope");
          },
        },
      }),
    });
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: "Preview items in Beach week" }));
    expect(await screen.findByText(/Couldn’t load this list\. Nothing was changed\./)).toBeTruthy();
  });

  it("shows Preview items as a text button inside its list's card, not a separate bordered button", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toStartStep(user);
    const toggle = screen.getByRole("button", { name: "Preview items in Beach week" });
    expect(toggle.closest(".start-entry")).toBe(
      screen.getByRole("radio", { name: /Beach week/ }).closest(".start-entry"),
    );
    expect(toggle.className).toBe("start-preview-toggle");
    await user.click(toggle);
    expect(
      screen.getByRole("region", { name: "Items in Beach week" }).closest(".start-entry"),
    ).toBe(toggle.closest(".start-entry"));
  });

  it("an empty list cannot be chosen and says why", async () => {
    const { user } = setup({ lists: [WORK, EMPTY] });
    await toStartStep(user);
    const radio = screen.getByRole("radio", { name: /Nothing yet/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText(/This list is empty\. Add items to it first\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview items in Nothing yet" })).toBeNull();
  });

  it("Back returns to the details with everything kept", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    expect(leave().value).toBe("2026-11-12");
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
  });

  it("choosing a list makes the draft dirty, so leaving asks first", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toStartStep(user);
    await user.click(screen.getByRole("radio", { name: /Beach week/ }));
    await user.click(screen.getByRole("button", { name: "Cancel draft and return to trips" }));
    expect(await screen.findByText("Discard this draft?")).toBeTruthy();
  });

  it("says so, and stays put, when the chosen list cannot be loaded on Continue", async () => {
    let fail = false;
    const { user } = setup({
      lists: [BEACH],
      wrap: (base) => ({
        ...base,
        savedLists: {
          list: base.savedLists!.list,
          get: async (id) => {
            if (fail) throw new Error("gone");
            return base.savedLists!.get(id);
          },
        },
      }),
    });
    await toStartStep(user);
    await user.click(screen.getByRole("radio", { name: /Beach week/ }));
    fail = true;
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Couldn’t load that list\. Nothing was changed\./)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Start from a saved list" })).toBeTruthy();
  });
});

describe("a trip that starts from a list", () => {
  async function toReview(user: ReturnType<typeof userEvent.setup>) {
    await toStartStep(user);
    await user.click(screen.getByRole("radio", { name: /Beach week/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review your list" });
  }

  it("shows the chosen list read-only, grouped by category, in place of the preferences", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toReview(user);
    expect(screen.getByText("Starting from “Beach week”")).toBeTruthy();
    expect(
      screen.getByText(/Preferences and the length-based counts aren’t used with a saved list\./),
    ).toBeTruthy();
    expect(screen.queryByText("Your packing preferences")).toBeNull();
    expect(screen.queryByText("Live calculation")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    const clothing = screen.getByRole("region", { name: "Clothing" });
    expect(within(clothing).getAllByText("Swimsuit")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Bathroom" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Tech" })).toBeTruthy();
    expect(screen.getByText(/Not on your dashboard yet/)).toBeTruthy();
  });

  it("uses the neutral secondary style for Edit trip details, Change starting point and Cancel draft; only Save trip is primary", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toReview(user);
    for (const name of ["Edit trip details", "Change starting point", "Cancel draft"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className, name).toContain("secondary");
      expect(button.className, name).not.toContain("ghost");
    }
    const save = screen.getByRole("button", { name: "Save trip" });
    expect(save.className).not.toMatch(/secondary|ghost/);
  });

  it("keeps the review's two cards in one spaced stack", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toReview(user);
    const stack = document.querySelector(".list-shape") as HTMLElement;
    expect(stack.children).toHaveLength(2);
    expect(stack.querySelectorAll(".card")).toHaveLength(2);
  });

  it("saves the list's items only: copies, all unpacked, Bathroom in the toiletries group, no staples", async () => {
    const { user, base } = setup({ lists: [BEACH] });
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const trip = base.snapshot().trips[0];
    expect(trip.items.map((item) => [item.name, item.category, item.qty, item.packed])).toEqual([
      ["Swimsuit", "Clothing", 2, 0],
      ["Sunscreen", "Bathroom", 1, 0],
      ["Phone charger", "Tech", 1, 0],
      ["Swimsuit", "Clothing", 1, 0],
    ]);
    expect(trip.items.every((item) => item.id.startsWith("saved:list-beach:"))).toBe(true);
    expect(trip.items.find((item) => item.name === "Sunscreen")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(trip.items.some((item) => item.id === "socks" || item.id === "underwear")).toBe(false);
    // The two Swimsuit rows were kept as two rows when the list was saved: nothing is merged or summed here.
    expect(trip.items.filter((item) => item.name === "Swimsuit")).toHaveLength(2);
  });

  it("Change starting point goes back to the choice; choosing none then gives today's Shape the list", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Change starting point" }));
    expect(await screen.findByRole("heading", { name: "Start from a saved list" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Beach week/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(screen.getByRole("radio", { name: /No saved list/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Shape the list" })).toBeTruthy();
    expect(screen.getByText("Your packing preferences")).toBeTruthy();
  });

  it("Edit trip details goes back to the details, and Continue returns to the list step", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Edit trip details" }));
    expect(await screen.findByRole("heading", { name: "Confirm the trip" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Start from a saved list" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Beach week/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("Back from today's Shape the list returns to the list step when there is one", async () => {
    const { user } = setup({ lists: [BEACH] });
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Shape the list" });
    await user.click(screen.getByRole("button", { name: "Edit trip details" }));
    expect(await screen.findByRole("heading", { name: "Start from a saved list" })).toBeTruthy();
  });

  it("never mixes weather in: the preview is not fetched and the trip is made without a weather review", async () => {
    const previewDraft = vi
      .fn()
      .mockResolvedValue({ kind: "ready", stops: [] satisfies StopWeather[] });
    const createTripWithReview = vi.fn();
    const { user, base } = setup({
      lists: [BEACH],
      wrap: (b) => ({
        ...b,
        weather: {
          getSettings: async () => ({ weatherOptIn: true, temperatureUnit: "F" }),
          updateSettings: vi.fn(),
          getTripWeather: vi.fn(),
          previewDraft,
          createTripWithReview,
          listSuggestions: vi.fn().mockResolvedValue([]),
          applyReview: vi.fn(),
        },
      }),
    });
    await toReview(user);
    expect(previewDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(createTripWithReview).not.toHaveBeenCalled();
    const trip = base.snapshot().trips[0];
    expect(trip.weather.status).toBe("pending");
    expect(trip.items).toHaveLength(4);
  });

  it("keeps the draft and says nothing was saved when the server refuses", async () => {
    const { user } = setup({
      lists: [BEACH],
      wrap: (b) => ({
        ...b,
        createTrip: async () => {
          throw new Error("NOT_FOUND");
        },
      }),
    });
    await toReview(user);
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save trip" })).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review your list" })).toBeTruthy();
  });
});
