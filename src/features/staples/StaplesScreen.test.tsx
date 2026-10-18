// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
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

function setup(wrap?: (base: Memory) => TripsSource) {
  const base = memory();
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <StaplesScreen />
    </TripsSourceProvider>,
  );
  return { user, source: base };
}

const title = () => screen.findByRole("heading", { name: "Every trip starts here", level: 1 });
const section = (name: string) => screen.getByRole("region", { name });
const live = () => screen.getByRole("status", { name: "Staples updates" });
const rowFor = (id: string) => document.querySelector(`[data-staple-id="${id}"]`) as HTMLElement;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe("loading and states", () => {
  it("shows the four sections as headings with counts, in order, and the Staples copy", async () => {
    setup();
    await title();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Clothing", "Bathroom", "Tech", "Other essentials"]);
    expect(within(section("Clothing")).getByLabelText("3 staples")).toBeTruthy();
    expect(within(section("Bathroom")).getByLabelText("4 staples")).toBeTruthy();
    expect(screen.getByText("My staples")).toBeTruthy();
    expect(screen.getByText(/Changes here never rewrite existing trips/)).toBeTruthy();
    expect(screen.queryByText(/sample|saved to my staples/i)).toBeNull();
    expect(within(rowFor("underwear")).getByText("1 per day")).toBeTruthy();
    expect(within(rowFor("last-laptop")).getByText("Pack last")).toBeTruthy();
    expect(within(rowFor("underwear")).queryByText("Pack last")).toBeNull();
  });

  it("shows a loading state first", async () => {
    const gate = deferred<void>();
    setup((base) => ({
      ...base,
      listStaples: async () => (await gate.promise, base.listStaples()),
    }));
    expect(screen.getByRole("region", { name: "Loading staples" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => gate.resolve());
    expect(await title()).toBeTruthy();
  });

  it("shows a load error with Try again that recovers", async () => {
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
    expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await title()).toBeTruthy();
  });

  it("opening the screen never shows Saving…", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const gate = deferred<void>();
      setup((base) => ({
        ...base,
        listStaples: async () => (await gate.promise, base.listStaples()),
      }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.queryByText("Saving…")).toBeNull();
      await act(async () => gate.resolve());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Pack last filter", () => {
  it("narrows to Pack last staples, hides empty sections, and announces the count", async () => {
    const { user } = setup();
    await title();
    const all = screen.getByRole("button", { name: "All" });
    const packLast = screen.getByRole("button", { name: "Pack last" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    await user.click(packLast);
    expect(packLast.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("region", { name: "Clothing" })).toBeNull();
    expect(screen.getByRole("region", { name: "Bathroom" })).toBeTruthy();
    expect(live().textContent).toBe("7 staples shown");
    await user.click(all);
    expect(live().textContent).toBe("11 staples shown");
    expect(screen.getByRole("region", { name: "Clothing" })).toBeTruthy();
  });

  it("says so when nothing is Pack last", async () => {
    const { user } = setup((base) => ({
      ...base,
      listStaples: async () => (await base.listStaples()).map((s) => ({ ...s, packLast: false })),
    }));
    await title();
    await user.click(screen.getByRole("button", { name: "Pack last" }));
    expect(screen.getByText("No staples match this filter.")).toBeTruthy();
    expect(live().textContent).toBe("0 staples shown");
  });

  it("shows an empty section as 'No staples yet' under All", async () => {
    setup((base) => ({
      ...base,
      listStaples: async () => (await base.listStaples()).filter((s) => s.category !== "Tech"),
    }));
    await title();
    expect(within(section("Tech")).getByText("No staples yet")).toBeTruthy();
  });
});

describe("adding a staple", () => {
  it("starts with Pack last off, saves after the server confirms, and applies to future trips only", async () => {
    const gate = deferred<void>();
    const { user, source } = setup((base) => ({
      ...base,
      upsertStaple: async (staple) => (await gate.promise, base.upsertStaple(staple)),
    }));
    await title();
    const tripsBefore = JSON.stringify(source.snapshot().trips);
    await user.click(screen.getByRole("button", { name: /Add/ }));
    const dialog = screen.getByRole("dialog", { name: "Add a staple" });
    expect(within(dialog).getByRole("switch", { name: "Pack last" })).toHaveProperty(
      "checked",
      false,
    );
    expect(
      within(dialog).getByText("Changes apply to future trips. Existing trips keep their lists."),
    ).toBeTruthy();
    await user.type(within(dialog).getByLabelText("Item name"), "  Phone charger ");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "2");
    await user.click(within(dialog).getByRole("radio", { name: /Per day/ }));
    await user.selectOptions(within(dialog).getByLabelText("Category"), "Tech");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    // Not optimistic: nothing is in the list until the server answers.
    expect(screen.queryByText("Phone charger")).toBeNull();
    expect(source.staplesSnapshot().some((s) => s.name === "Phone charger")).toBe(false);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = source.staplesSnapshot().find((s) => s.name === "Phone charger")!;
    expect(saved).toMatchObject({ qty: 2, cadence: "per day", category: "Tech", packLast: false });
    expect(saved.id).toMatch(/^staple-/);
    expect(within(section("Tech")).getByText("Phone charger")).toBeTruthy();
    expect(within(section("Tech")).getByLabelText("3 staples")).toBeTruthy();
    expect(await screen.findByText("Phone charger saved for future trips.")).toBeTruthy();
    expect(JSON.stringify(source.snapshot().trips)).toBe(tripsBefore);
  });

  it("asks for a name and a sensible quantity", async () => {
    const { user, source } = setup();
    await title();
    const before = source.staplesSnapshot().length;
    await user.click(screen.getByRole("button", { name: /Add/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name.");
    await user.type(within(dialog).getByLabelText("Item name"), "Hat");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "31");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a quantity from 1 to 30.");
    expect(source.staplesSnapshot()).toHaveLength(before);
  });

  it("refuses a duplicate name (ignoring case) and offers to edit the existing one", async () => {
    const { user, source } = setup();
    await title();
    const before = source.staplesSnapshot().length;
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.type(screen.getByLabelText("Item name"), "  socks ");
    const alert = within(screen.getByRole("dialog")).getByRole("alert");
    expect(alert.textContent).toBe("You already have Socks. Edit it instead.");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add staple" }),
    );
    expect(source.staplesSnapshot()).toHaveLength(before);
    await user.click(within(alert).getByRole("button", { name: "Edit it instead" }));
    const dialog = screen.getByRole("dialog", { name: "Edit staple" });
    expect(within(dialog).getByLabelText("Item name")).toHaveProperty("value", "Socks");
  });

  it("keeps the editor open with the Error chip when saving fails", async () => {
    const { user } = setup((base) => ({
      ...base,
      upsertStaple: () => Promise.reject(new Error("down")),
    }));
    await title();
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.type(screen.getByLabelText("Item name"), "Hat");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add staple" }),
    );
    expect(await screen.findByRole("button", { name: /couldn.t save/i })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Add a staple" })).toBeTruthy();
    expect(screen.queryByText("Hat saved for future trips.")).toBeNull();
  });

  it("the × closes the editor without saving", async () => {
    const { user, source } = setup();
    await title();
    const before = source.staplesSnapshot().length;
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.staplesSnapshot()).toHaveLength(before);
  });
});

describe("editing a staple", () => {
  it("opens with the current values, keeps Pack last as it is, and saves the change", async () => {
    const { user, source } = setup();
    await title();
    await user.click(screen.getByRole("button", { name: "Edit Laptop" }));
    const dialog = screen.getByRole("dialog", { name: "Edit staple" });
    expect(within(dialog).getByLabelText("Item name")).toHaveProperty("value", "Laptop");
    expect(within(dialog).getByRole("radio", { name: /Per trip/ })).toHaveProperty("checked", true);
    expect(within(dialog).getByLabelText("Category")).toHaveProperty("value", "Tech");
    expect(within(dialog).getByRole("switch", { name: "Pack last" })).toHaveProperty(
      "checked",
      true,
    );
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "2");
    await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const laptop = source.staplesSnapshot().find((s) => s.id === "last-laptop")!;
    expect(laptop).toMatchObject({ qty: 2, packLast: true, name: "Laptop" });
    expect(source.staplesSnapshot().filter((s) => s.name === "Laptop")).toHaveLength(1);
    expect(within(rowFor("last-laptop")).getByText("2 per trip")).toBeTruthy();
  });

  it("lets a staple keep its own name while it is being edited (no false duplicate)", async () => {
    const { user } = setup();
    await title();
    await user.click(screen.getByRole("button", { name: "Edit Socks" }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("keeps a Bathroom staple in the Toiletries group and says so", async () => {
    const { user, source } = setup();
    await title();
    await user.click(screen.getByRole("button", { name: "Edit Toothbrush" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/keeps it in the Toiletries group/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(source.staplesSnapshot().find((s) => s.id === "last-toothbrush")!.groupId).toBe(
      "toiletry-bag",
    );
  });

  it("keeps a stored category such as Nice attire while the section is unchanged", async () => {
    const { user, source } = setup((base) => ({
      ...base,
      listStaples: async () => [
        ...(await base.listStaples()),
        {
          id: "nice-dress",
          name: "Dress",
          qty: 1,
          cadence: "per trip",
          category: "Nice attire",
          packLast: false,
        },
      ],
    }));
    await title();
    await user.click(screen.getByRole("button", { name: "Edit Dress" }));
    expect(screen.getByLabelText("Category")).toHaveProperty("value", "Clothing");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save staple" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(source.staplesSnapshot().find((s) => s.id === "nice-dress")!.category).toBe(
      "Nice attire",
    );
  });
});
