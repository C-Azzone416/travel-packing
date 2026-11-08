// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Staple } from "@/domain/trip";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { STAPLE_COUNT_RULES } from "./staple-count-rules";
import { StaplesScreen } from "./StaplesScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/staples" }));

type Memory = ReturnType<typeof memory>;

function memory() {
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => "new",
    today: () => "2026-10-16",
  });
}

/** jsdom has no media queries: pick the laptop (>= 1024px) or the phone layout, and a tall or short screen. */
function viewport(laptop: boolean, short = false) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1024px") ? laptop : query.includes("max-height") && short,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const TEES: Staple = {
  id: "tops",
  name: "Tees",
  qty: 1,
  cadence: "per day",
  category: "Clothing",
  packLast: false,
  laundryHalves: true,
};

function setup(
  options: {
    laptop?: boolean;
    short?: boolean;
    wrap?: (base: Memory) => TripsSource;
    extra?: Staple[];
    removeStaple?: (id: string) => Promise<Staple[]>;
  } = {},
) {
  viewport(options.laptop ?? true, options.short);
  const base = memory();
  const withExtra: TripsSource = options.extra
    ? { ...base, listStaples: async () => [...(await base.listStaples()), ...options.extra!] }
    : base;
  const source = options.wrap ? options.wrap(base) : withExtra;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <StaplesScreen removeStaple={options.removeStaple} />
    </TripsSourceProvider>,
  );
  return { user, source: base };
}

const ready = () => screen.findByRole("heading", { name: "Staples", level: 1 });
const loaded = async () => {
  await ready();
  await screen.findByRole("form", { name: "Add a staple" });
};
const card = (name: string) => screen.getByRole("region", { name });
const rowFor = (id: string) => document.querySelector(`[data-staple-id="${id}"]`) as HTMLElement;
const problem = () => document.getElementById("staple-add-problem");
const live = () => screen.getByRole("status", { name: "Staples updates" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe("laptop: the page", () => {
  it("shows the title, the lede, the cube cards in order with counts, and the preview", async () => {
    setup();
    await loaded();
    expect(screen.getByText(/Your Staples start every new trip/)).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 5)).toEqual(["Clothing", "Toiletries", "Tech", "Documents", "Misc"]);
    // 4 nights = 5 days: underwear and socks 5 each, sleepwear 1.
    expect(within(card("Clothing")).getByText("3 staples · 11 items")).toBeTruthy();
    expect(within(card("Toiletries")).getByText("4 staples · 4 items")).toBeTruthy();
    expect(within(card("Documents")).getByText("No staples yet")).toBeTruthy();
    expect(within(card("Misc")).getByText("2 staples · 2 items")).toBeTruthy();
    expect(screen.getByLabelText("Preview")).toBeTruthy();
    expect(
      screen.getByText("Weather suggestions and special items", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saved lists" })).toBeTruthy();
  });

  it("keeps the setup count rules reachable in a closed lede disclosure", async () => {
    const { user } = setup();
    await loaded();
    const summary = screen.getByText("How counts work", { selector: "summary" });
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    for (const rule of STAPLE_COUNT_RULES) {
      const label = within(disclosure).getByText(rule.label);
      const item = label.closest("li");
      expect(item).toBeTruthy();
      expect(item!.textContent).toBe(`${rule.label} ${rule.description}`);
    }
    expect(within(disclosure).getByText(/Items marked ↻ are halved/)).toBeTruthy();
    await user.click(summary);
    expect(disclosure.open).toBe(true);
  });

  it("shows each row's name, cadence and count in the preview trip", async () => {
    setup();
    await loaded();
    const underwear = rowFor("underwear");
    expect(within(underwear).getByText("per day")).toBeTruthy();
    expect(within(underwear).getByText("× 5")).toBeTruthy();
    expect(within(rowFor("last-toothbrush")).getByText("per trip")).toBeTruthy();
    expect(within(rowFor("last-laptop")).getByText("Pack last")).toBeTruthy();
  });

  it("shows the loading state, then the page", async () => {
    const gate = deferred<void>();
    setup({
      wrap: (base) => ({
        ...base,
        listStaples: async () => (await gate.promise, base.listStaples()),
      }),
    });
    expect(screen.getByRole("region", { name: "Loading staples" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => gate.resolve());
    await loaded();
  });

  it("shows a load error with Try again that recovers", async () => {
    viewport(true);
    const base = memory();
    const listStaples = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(() => base.listStaples());
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={{ ...base, listStaples }}>
        <StaplesScreen />
      </TripsSourceProvider>,
    );
    expect(await screen.findByText("Couldn’t load your staples.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await loaded();
  });

  it("opening the screen never shows Saving…", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const gate = deferred<void>();
      setup({
        wrap: (base) => ({
          ...base,
          listStaples: async () => (await gate.promise, base.listStaples()),
        }),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.queryByText("Saving…")).toBeNull();
      await act(async () => gate.resolve());
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the list is empty", async () => {
    setup({ wrap: (base) => ({ ...base, listStaples: async () => [] }) });
    await loaded();
    expect(screen.getByText(/Your Staples list is intentionally empty/)).toBeTruthy();
    expect(screen.getByText("Nothing scales with the trip yet.")).toBeTruthy();
  });
});

describe("laptop: the preview", () => {
  it("scales per-day counts with the slider and announces the value as nights", async () => {
    setup();
    await loaded();
    const slider = screen.getByRole("slider", { name: "Preview a trip of" });
    expect(slider.getAttribute("aria-valuetext")).toBe("4 nights");
    fireEvent.change(slider, { target: { value: "6" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("6 nights");
    expect(within(rowFor("underwear")).getByText("× 7")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("1 night");
    expect(within(rowFor("underwear")).getByText("× 2")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "21" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("21 nights");
    expect(within(rowFor("underwear")).getByText("× 22")).toBeTruthy();
  });

  it("halves the staples marked ↻ when laundry is on, and says what it saves", async () => {
    const { user } = setup({ extra: [TEES] });
    await loaded();
    // 4 nights: a real trip gives tops 4 (days minus the return-outfit day); laundry halves it to 2.
    expect(within(rowFor("tops")).getByText("× 4").closest("del")).toBeTruthy();
    expect(within(rowFor("tops")).getByText("× 2")).toBeTruthy();
    expect(within(rowFor("tops")).getByText(/reduced from 4 with laundry/)).toBeTruthy();
    expect(screen.getByText("Laundry saves 2 (anything marked ↻ is halved).")).toBeTruthy();
    const laundry = screen.getByRole("switch", { name: "Laundry on the trip" });
    expect(laundry).toHaveProperty("checked", true);
    await user.click(laundry);
    expect(laundry).toHaveProperty("checked", false);
    expect(within(rowFor("tops")).getByText("× 4")).toBeTruthy();
    expect(within(rowFor("tops")).queryByText("× 2")).toBeNull();
    expect(
      screen.getByText("Laundry would save 2. Underwear and socks stay one per day."),
    ).toBeTruthy();
  });

  it("lists what scales with the trip and the items by cube", async () => {
    setup({ extra: [TEES] });
    await loaded();
    const preview = screen.getByLabelText("Preview");
    const scales = within(preview).getByRole("heading", { name: "Scales with the trip" })
      .nextElementSibling as HTMLElement;
    const names = within(scales)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/^Underwear× 5$/);
    expect(names[1]).toMatch(/^Socks× 5$/);
    expect(names[2]).toMatch(/^TeesFewer with laundry× 4× 2, reduced from 4 with laundry$/);
    const byCube = within(preview).getByRole("heading", { name: "By cube" })
      .nextElementSibling as HTMLElement;
    expect(
      within(byCube)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Clothing13", "Toiletries4", "Tech2", "Documents0", "Misc2"]);
    expect(within(preview).getByText(/items to start/)).toBeTruthy();
  });
});

describe("laptop: the inline editor", () => {
  it("opens under the row, one at a time, and closes with Escape and returns focus", async () => {
    const { user } = setup();
    await loaded();
    const socks = within(rowFor("socks")).getByRole("button", { name: /^Socks/ });
    await user.click(socks);
    expect(socks.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Edit Socks" })).toBeTruthy();
    const underwear = within(rowFor("underwear")).getByRole("button", { name: /^Underwear/ });
    await user.click(underwear);
    expect(screen.queryByRole("group", { name: "Edit Socks" })).toBeNull();
    expect(screen.getByRole("group", { name: "Edit Underwear" })).toBeTruthy();
    // Tapping the row again closes it.
    await user.click(underwear);
    expect(screen.queryByRole("group", { name: "Edit Underwear" })).toBeNull();
    await user.click(underwear);
    const group = screen.getByRole("group", { name: "Edit Underwear" });
    within(group)
      .getByRole("button", { name: /^More / })
      .focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Edit Underwear" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(underwear));
  });

  it("changes the count and saves as it goes, applying to future trips only", async () => {
    const gate = deferred<void>();
    const { user, source } = setup({
      wrap: (base) => ({
        ...base,
        upsertStaple: async (staple) => (await gate.promise, base.upsertStaple(staple)),
      }),
    });
    await loaded();
    const tripsBefore = JSON.stringify(source.snapshot().trips);
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    const group = screen.getByRole("group", { name: "Edit Laptop" });
    await user.click(within(group).getByRole("button", { name: /^More / }));
    // The editor shows it at once; the list is stored only after the server answers.
    expect(within(group).getByRole("status").textContent).toBe("2");
    expect(source.staplesSnapshot().find((s) => s.id === "last-laptop")!.qty).toBe(1);
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "last-laptop")!.qty).toBe(2),
    );
    expect(within(rowFor("last-laptop")).getByText("× 2")).toBeTruthy();
    expect(JSON.stringify(source.snapshot().trips)).toBe(tripsBefore);
  });

  it("coalesces quick changes into the last value", async () => {
    const calls: number[] = [];
    const gate = deferred<void>();
    const { user, source } = setup({
      wrap: (base) => ({
        ...base,
        upsertStaple: async (staple) => {
          calls.push(staple.qty);
          if (calls.length === 1) await gate.promise;
          return base.upsertStaple(staple);
        },
      }),
    });
    await loaded();
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    const more = within(screen.getByRole("group", { name: "Edit Laptop" })).getByRole("button", {
      name: /^More /,
    });
    await user.click(more);
    await user.click(more);
    await user.click(more);
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "last-laptop")!.qty).toBe(4),
    );
    expect(calls).toEqual([2, 4]);
  });

  it("changes the cadence with the three chips, including per night", async () => {
    const { user, source } = setup();
    await loaded();
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    const scales = screen.getByRole("group", { name: "How Laptop scales" });
    expect(
      within(scales)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["per trip", "per day", "per night"]);
    expect(
      within(scales).getByRole("button", { name: "per trip" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(within(scales).getByRole("button", { name: "per night" }));
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "last-laptop")!.cadence).toBe(
        "per night",
      ),
    );
    // 4 nights: one laptop per night.
    expect(within(rowFor("last-laptop")).getByText("× 4")).toBeTruthy();
  });

  it("moves a staple to another cube", async () => {
    const { user, source } = setup();
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Cube for Sleepwear" }),
      "documents",
    );
    await waitFor(() => expect(within(card("Documents")).getByText("Sleepwear")).toBeTruthy());
    const saved = source.staplesSnapshot().find((s) => s.id === "sleepwear")!;
    expect(saved.category).toBe("Other essentials");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Cube for Sleepwear" }),
      "toiletries",
    );
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "sleepwear")!.groupId).toBeTruthy(),
    );
  });

  it("toggles ↻ Fewer with laundry on and off", async () => {
    const { user, source } = setup();
    await loaded();
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    const toggle = screen.getByRole("switch", { name: "Fewer with laundry" });
    expect(toggle.textContent).toBe("Fewer with laundry · off");
    await user.click(toggle);
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "last-laptop")!.laundryHalves).toBe(
        true,
      ),
    );
    expect(toggle.textContent).toBe("Fewer with laundry · on");
    expect(within(rowFor("last-laptop")).getByText("Fewer with laundry")).toBeTruthy();
    await user.click(toggle);
    await waitFor(() =>
      expect(
        source.staplesSnapshot().find((s) => s.id === "last-laptop")!.laundryHalves,
      ).toBeUndefined(),
    );
  });

  it("explains why underwear and socks cannot carry ↻", async () => {
    const { user } = setup();
    await loaded();
    await user.click(within(rowFor("underwear")).getByRole("button", { name: /^Underwear/ }));
    const toggle = screen.getByRole("switch", { name: "Fewer with laundry" });
    expect(toggle).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Underwear and socks stay one per day, with or without laundry."),
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("explains a legacy Smart staple instead of offering ↻", async () => {
    const { user } = setup({
      extra: [
        { ...TEES, id: "nice-top", name: "Nice top", cadence: "smart", laundryHalves: undefined },
      ],
    });
    await loaded();
    await user.click(within(rowFor("nice-top")).getByRole("button", { name: /^Nice top/ }));
    expect(screen.getByRole("switch", { name: "Fewer with laundry" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText(/follows your trip's preferences/)).toBeTruthy();
  });

  it("flips Pack last", async () => {
    const { user, source } = setup();
    await loaded();
    await user.click(within(rowFor("sunglasses")).getByRole("button", { name: /^Sunglasses/ }));
    await user.click(screen.getByRole("switch", { name: "Pack last" }));
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "sunglasses")!.packLast).toBe(true),
    );
  });

  it("removes a staple and says so", async () => {
    const removeStaple = vi.fn(async (id: string) =>
      (await memory().listStaples()).filter((s) => s.id !== id),
    );
    const { user } = setup({ removeStaple });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(rowFor("sleepwear")).toBeNull());
    expect(removeStaple).toHaveBeenCalledWith("sleepwear");
    expect(live().textContent).toBe("Sleepwear removed from future trips.");
  });

  it("keeps the value stored when a save fails, and shows the Error chip", async () => {
    const { user } = setup({
      wrap: (base) => ({ ...base, upsertStaple: () => Promise.reject(new Error("down")) }),
    });
    await loaded();
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    await user.click(screen.getByRole("button", { name: /^More / }));
    expect(await screen.findByRole("button", { name: /not saved/i })).toBeTruthy();
    await waitFor(() => expect(within(rowFor("last-laptop")).getByText("× 1")).toBeTruthy());
  });
});

describe("renaming, Smart, and removing", () => {
  it("renames a staple from the inline editor, saving when the field is left", async () => {
    const { user, source } = setup();
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    const field = screen.getByRole("textbox", { name: "Name" });
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("name")).toBe("packing-item-name");
    await user.clear(field);
    await user.type(field, "  Pyjamas ");
    expect(source.staplesSnapshot().find((s) => s.id === "sleepwear")!.name).toBe("Sleepwear");
    await user.tab();
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "sleepwear")!.name).toBe("Pyjamas"),
    );
    expect(within(rowFor("sleepwear")).getByRole("button", { name: /^Pyjamas/ })).toBeTruthy();
    expect(source.staplesSnapshot().filter((s) => s.name === "Pyjamas")).toHaveLength(1);
  });

  it("saves a rename on Enter, and refuses an empty or taken name without saving", async () => {
    const upsertStaple = vi.fn();
    const { user, source } = setup({ wrap: (base) => ({ ...base, upsertStaple }) });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    const group = () => within(screen.getByRole("group", { name: "Edit Sleepwear" }));
    const field = screen.getByRole("textbox", { name: "Name" });
    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(group().getByRole("alert").textContent).toBe("Enter a name.");
    await user.type(field, "socks");
    await user.keyboard("{Enter}");
    expect(group().getByRole("alert").textContent).toBe("You already have Socks.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    await user.type(field, "x");
    expect(group().queryByRole("alert")).toBeNull();
    await user.clear(field);
    await user.type(field, "Sleepwear");
    await user.tab();
    expect(upsertStaple).not.toHaveBeenCalled();
    expect(source.staplesSnapshot().find((s) => s.id === "sleepwear")!.name).toBe("Sleepwear");
  });

  it("renames from the phone sheet", async () => {
    const { user, source } = setup({ laptop: false });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    const field = within(screen.getByRole("dialog")).getByRole("textbox", { name: "Name" });
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("name")).toBe("packing-item-name");
    await user.clear(field);
    await user.type(field, "Pyjamas");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "sleepwear")!.name).toBe("Pyjamas"),
    );
    expect(screen.getByRole("dialog", { name: "Pyjamas" })).toBeTruthy();
  });

  it("offers a Smart chip only to staples that have a Smart quantity, and can go back to it", async () => {
    const bottoms: Staple = {
      id: "bottoms",
      name: "Bottoms",
      qty: 1,
      cadence: "smart",
      category: "Clothing",
      packLast: false,
    };
    const { user, source } = setup({ extra: [bottoms] });
    await loaded();
    await user.click(within(rowFor("bottoms")).getByRole("button", { name: /^Bottoms/ }));
    const scales = screen.getByRole("group", { name: "How Bottoms scales" });
    expect(within(scales).getByRole("button", { name: "smart" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(within(scales).getByRole("button", { name: "per day" }));
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "bottoms")!.cadence).toBe("per day"),
    );
    await user.click(within(scales).getByRole("button", { name: "smart" }));
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "bottoms")!.cadence).toBe("smart"),
    );
    // A laptop has no Smart quantity: three chips only.
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    const laptopScales = screen.getByRole("group", { name: "How Laptop scales" });
    expect(within(laptopScales).queryByRole("button", { name: "smart" })).toBeNull();
  });

  it("removes after an in-flight save, so the staple cannot come back", async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const removeStaple = vi.fn(async (id: string) => {
      order.push("remove");
      return (await memory().listStaples()).filter((s) => s.id !== id);
    });
    const { user, source } = setup({
      removeStaple,
      wrap: (base) => ({
        ...base,
        upsertStaple: async (staple) => {
          order.push("upsert-start");
          await gate.promise;
          order.push("upsert-end");
          return base.upsertStaple(staple);
        },
      }),
    });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    await user.click(
      within(screen.getByRole("group", { name: "Edit Sleepwear" })).getByRole("button", {
        name: /^More /,
      }),
    );
    await waitFor(() => expect(order).toEqual(["upsert-start"]));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    // Remove waits behind the save that is still in flight.
    expect(removeStaple).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    await waitFor(() => expect(removeStaple).toHaveBeenCalledWith("sleepwear"));
    expect(order).toEqual(["upsert-start", "upsert-end", "remove"]);
    await waitFor(() => expect(rowFor("sleepwear")).toBeNull());
    void source;
  });

  it("drops a save that is still queued when the staple is removed", async () => {
    const calls: number[] = [];
    const gate = deferred<void>();
    const removeStaple = vi.fn(async (id: string) =>
      (await memory().listStaples()).filter((s) => s.id !== id),
    );
    const { user } = setup({
      removeStaple,
      wrap: (base) => ({
        ...base,
        upsertStaple: async (staple) => {
          calls.push(staple.qty);
          await gate.promise;
          return base.upsertStaple(staple);
        },
      }),
    });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    const more = within(screen.getByRole("group", { name: "Edit Sleepwear" })).getByRole("button", {
      name: /^More /,
    });
    await user.click(more);
    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await act(async () => gate.resolve());
    await waitFor(() => expect(removeStaple).toHaveBeenCalled());
    expect(calls).toEqual([2]);
  });
});

describe("adding a staple", () => {
  it("adds to the chosen cube on a laptop, saved after the server confirms", async () => {
    const gate = deferred<void>();
    const { user, source } = setup({
      wrap: (base) => ({
        ...base,
        upsertStaple: async (staple) => (await gate.promise, base.upsertStaple(staple)),
      }),
    });
    await loaded();
    const itemName = screen.getByRole("textbox", { name: "Staple name" });
    expect(itemName.getAttribute("autocomplete")).toBe("off");
    expect(itemName.getAttribute("name")).toBe("packing-item-name");
    expect(itemName.closest("form")?.getAttribute("autocomplete")).toBe("off");
    await user.type(itemName, "  Phone charger ");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Cube for the new staple" }),
      "tech",
    );
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    expect(screen.queryByText("Phone charger")).toBeNull();
    await act(async () => gate.resolve());
    await waitFor(() => expect(within(card("Tech")).getByText("Phone charger")).toBeTruthy());
    const saved = source.staplesSnapshot().find((s) => s.name === "Phone charger")!;
    expect(saved).toMatchObject({ qty: 1, cadence: "per trip", category: "Tech", packLast: false });
    expect(saved.id).toMatch(/^staple-/);
    expect(screen.getByRole("textbox", { name: "Staple name" })).toHaveProperty("value", "");
    expect(live().textContent).toBe("Phone charger added to Tech.");
    expect(await screen.findByText("Phone charger saved for future trips.")).toBeTruthy();
  });

  it("asks for a name, and treats spaces as empty", async () => {
    const upsertStaple = vi.fn();
    const { user } = setup({ wrap: (base) => ({ ...base, upsertStaple }) });
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    expect(problem()?.textContent).toBe("Enter a name.");
    await user.type(screen.getByRole("textbox", { name: "Staple name" }), "   ");
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    expect(problem()?.textContent).toBe("Enter a name.");
    await user.type(screen.getByRole("textbox", { name: "Staple name" }), "x");
    expect(problem()).toBeNull();
    expect(upsertStaple).not.toHaveBeenCalled();
  });

  it("refuses a duplicate (ignoring case) and offers to edit the existing one", async () => {
    const { user, source } = setup();
    await loaded();
    const before = source.staplesSnapshot().length;
    await user.type(screen.getByRole("textbox", { name: "Staple name" }), "  socks ");
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    const alert = problem() as HTMLElement;
    expect(alert.textContent).toBe("You already have Socks. Edit it instead.");
    expect(source.staplesSnapshot()).toHaveLength(before);
    await user.click(within(alert).getByRole("button", { name: "Edit it instead" }));
    expect(screen.getByRole("group", { name: "Edit Socks" })).toBeTruthy();
    expect(problem()).toBeNull();
  });

  it("shows the Error chip and adds nothing when the save fails", async () => {
    const { user } = setup({
      wrap: (base) => ({ ...base, upsertStaple: () => Promise.reject(new Error("down")) }),
    });
    await loaded();
    await user.type(screen.getByRole("textbox", { name: "Staple name" }), "Hat");
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    expect(await screen.findByRole("button", { name: /not saved/i })).toBeTruthy();
    expect(screen.queryByText("Hat saved for future trips.")).toBeNull();
  });
});

describe("phone", () => {
  it("shows the staple count, no cube select, the round add button, and per-cube item counts", async () => {
    setup({ laptop: false });
    await loaded();
    expect(screen.getByText("11 staples")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Cube for the new staple" })).toBeNull();
    expect(within(card("Clothing")).getByText("11 items")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add staple" })).toBeTruthy();
  });

  it("opens the sheet from a row, with cube chips, a stepper, cadence chips and Done", async () => {
    const { user, source } = setup({ laptop: false, extra: [TEES] });
    await loaded();
    const row = within(rowFor("tops")).getByRole("button", { name: /^Tees/ });
    await user.click(row);
    const dialog = screen.getByRole("dialog", { name: "Tees" });
    const cubes = within(dialog).getByRole("radiogroup", { name: "Cube" });
    expect(
      within(cubes)
        .getAllByRole("radio")
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(["clothing", "toiletries", "tech", "documents", "misc"]);
    expect(within(cubes).getByRole("radio", { name: "Clothing" })).toHaveProperty("checked", true);
    await user.click(within(cubes).getByRole("radio", { name: "Tech" }));
    await user.click(within(dialog).getByRole("button", { name: /^More / }));
    await user.click(within(dialog).getByRole("button", { name: "per night" }));
    const laundry = within(dialog).getByRole("switch", { name: "Fewer with laundry" });
    expect(laundry.textContent).toContain("On");
    await user.click(laundry);
    expect(laundry.textContent).toContain("Off");
    await waitFor(() =>
      expect(source.staplesSnapshot().find((s) => s.id === "tops")).toMatchObject({
        category: "Tech",
        qty: 2,
        cadence: "per night",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The row moved to the Tech card, so it is a new element: focus is on the staple's row, not lost.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(rowFor("tops")).getByRole("button", { name: /^Tees/ }),
      ),
    );
  });

  it("explains in the sheet why underwear cannot carry ↻", async () => {
    const { user } = setup({ laptop: false });
    await loaded();
    await user.click(within(rowFor("underwear")).getByRole("button", { name: /^Underwear/ }));
    const dialog = screen.getByRole("dialog", { name: "Underwear" });
    expect(within(dialog).getByRole("switch", { name: "Fewer with laundry" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByText(/stay one per day/)).toBeTruthy();
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
  });

  it("closes on Escape, and removes from the sheet", async () => {
    const removeStaple = vi.fn(async (id: string) =>
      (await memory().listStaples()).filter((s) => s.id !== id),
    );
    const { user } = setup({ laptop: false, removeStaple });
    await loaded();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(within(rowFor("sleepwear")).getByRole("button", { name: /^Sleepwear/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(rowFor("sleepwear")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the sheet for a newly added staple in the last used cube", async () => {
    const { user, source } = setup({ laptop: false });
    await loaded();
    await user.click(within(rowFor("last-laptop")).getByRole("button", { name: /^Laptop/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Documents" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
    await user.type(screen.getByRole("textbox", { name: "Staple name" }), "Passport");
    await user.click(screen.getByRole("button", { name: "Add staple" }));
    const dialog = await screen.findByRole("dialog", { name: "Passport" });
    expect(within(dialog).getByRole("radio", { name: "Documents" })).toHaveProperty(
      "checked",
      true,
    );
    expect(source.staplesSnapshot().find((s) => s.name === "Passport")!.category).toBe(
      "Other essentials",
    );
  });

  it("shows the dock, collapsible on a short screen", async () => {
    const { user } = setup({ laptop: false, short: true });
    await loaded();
    const title = screen.getByRole("button", { name: "Preview: 4 nights" });
    expect(title.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("slider")).toBeNull();
    await user.click(title);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("slider", { name: "Preview a trip of" })).toBeTruthy();
    expect(screen.getByText("Laundry saves 0 (anything marked ↻ is halved).")).toBeTruthy();
  });

  it("starts the dock open on a tall screen and shows the item count", async () => {
    setup({ laptop: false });
    await loaded();
    expect(
      screen.getByRole("button", { name: "Preview: 4 nights" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(screen.getByLabelText("Preview")).getByRole("status").textContent).toContain(
      "items",
    );
  });
});
