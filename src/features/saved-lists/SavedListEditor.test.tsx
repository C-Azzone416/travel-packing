// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { SavedListActions, SavedListResult } from "@/features/staples/saved-list-actions";
import type { SavedListDetail } from "@/server/data/service";
import { SavedListEditor } from "./SavedListEditor";

vi.mock("next/navigation", () => ({ usePathname: () => "/staples/lists/1" }));

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const base: SavedListDetail = {
  id: LIST_ID,
  name: "Beach week",
  updatedAt: "2026-10-12T15:00:00Z",
  items: [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "shorts", name: "Shorts", category: "Clothing", qty: 3 },
    { id: "brush", name: "Toothbrush", category: "Bathroom", qty: 1 },
  ],
};

function setup(overrides: Partial<SavedListActions> = {}, initial: SavedListDetail = base) {
  let list = { ...initial, items: [...initial.items] };
  const ok = (): SavedListResult => ({ ok: true, list: { ...list, items: [...list.items] } });
  const actions = {
    get: vi.fn(async () => ok()),
    rename: vi.fn(async (_id: string, name: string) => {
      list = { ...list, name };
      return ok();
    }),
    addItem: vi.fn(async (_id: string, item: { name: string; category: string; qty: number }) => {
      list = { ...list, items: [...list.items, { id: `new-${list.items.length}`, ...item }] };
      return ok();
    }),
    updateItem: vi.fn(
      async (
        _id: string,
        itemId: string,
        item: { name: string; category: string; qty: number },
      ) => {
        list = {
          ...list,
          items: list.items.map((entry) => (entry.id === itemId ? { id: itemId, ...item } : entry)),
        };
        return ok();
      },
    ),
    removeItem: vi.fn(async (_id: string, itemId: string) => {
      list = { ...list, items: list.items.filter((entry) => entry.id !== itemId) };
      return ok();
    }),
    ...overrides,
  };
  const user = userEvent.setup();
  renderInApp(
    <SavedListEditor listId={LIST_ID} actions={actions as unknown as SavedListActions} />,
  );
  return { user, actions };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("SavedListEditor", () => {
  it("shows the list's name and its items grouped by category in the standard order, with a way back", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Beach week", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Saved lists/ }).getAttribute("href")).toBe(
      "/staples/lists",
    );
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Clothing", "Bathroom", "Other essentials"]);
    expect(within(section("Clothing")).getByText("Shorts")).toBeTruthy();
    expect(within(section("Clothing")).getByText("Needed 3")).toBeTruthy();
    expect(screen.getByText("3 items")).toBeTruthy();
    expect(screen.getByText(/Trips already made from it keep their own copy/)).toBeTruthy();
  });

  it("says so when the list isn't available, and when it can't load", async () => {
    setup({
      get: vi.fn(async () => ({ ok: false as const, code: "NOT_FOUND" as const })) as never,
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "That list isn’t available." }),
    ).toBeTruthy();
  });

  it("offers Try again when the load fails, then shows the list", async () => {
    let fail = true;
    const { user } = setup({
      get: vi.fn(async () =>
        fail
          ? { ok: false as const, code: "INTERNAL" as const }
          : { ok: true as const, list: base },
      ) as never,
    });
    expect(await screen.findByText("Couldn’t load this list.")).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Beach week", level: 1 })).toBeTruthy();
  });

  it("says an empty list is empty", async () => {
    setup({}, { ...base, items: [] });
    expect(await screen.findByText("This list is empty.")).toBeTruthy();
    expect(screen.getByText("Add an item, or delete the list.")).toBeTruthy();
  });

  it("adds an item: name, category and quantity, with no packed state, then shows it", async () => {
    const { user, actions } = setup();
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
    const sheet = screen.getByRole("dialog", { name: "Add an item" });
    expect(within(sheet).queryByText(/packed/i)).toBeNull();
    await user.type(within(sheet).getByLabelText("Item name"), "Camera");
    await user.selectOptions(within(sheet).getByLabelText("Category"), "Tech");
    await user.clear(within(sheet).getByLabelText("Needed quantity"));
    await user.type(within(sheet).getByLabelText("Needed quantity"), "2");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.addItem).toHaveBeenCalledWith(LIST_ID, {
      name: "Camera",
      category: "Tech",
      qty: 2,
    });
    expect(await screen.findByText("Camera added.")).toBeTruthy();
    expect(within(section("Tech")).getByText("Camera")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for a name and a whole quantity from 1 to 999 instead of saving", async () => {
    const { user, actions } = setup();
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByText("Enter an item name.")).toBeTruthy();
    await user.type(within(sheet).getByLabelText("Item name"), "Camera");
    await user.clear(within(sheet).getByLabelText("Needed quantity"));
    await user.type(within(sheet).getByLabelText("Needed quantity"), "1000");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByText("Enter a whole number from 1 to 999.")).toBeTruthy();
    expect(actions.addItem).not.toHaveBeenCalled();
  });

  it("never adds an item the list already has: says so, names it, and Edit that item opens it", async () => {
    const { user } = setup({
      addItem: vi.fn(async () => ({
        ok: false as const,
        code: "REJECTED" as const,
        reason: "EXISTS",
      })) as never,
    });
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
    const sheet = screen.getByRole("dialog");
    await user.type(within(sheet).getByLabelText("Item name"), "shorts");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(
      await within(sheet).findByText(/Shorts is already in this list \(needed: 3\)/),
    ).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Edit that item" }));
    const editor = await screen.findByRole("dialog", { name: "Edit item" });
    expect((within(editor).getByLabelText("Item name") as HTMLInputElement).value).toBe("Shorts");
  });

  it("edits an item in place, including its category", async () => {
    const { user, actions } = setup();
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit Shorts" }));
    const sheet = screen.getByRole("dialog", { name: "Edit item" });
    expect((within(sheet).getByLabelText("Item name") as HTMLInputElement).value).toBe("Shorts");
    expect((within(sheet).getByLabelText("Needed quantity") as HTMLInputElement).value).toBe("3");
    await user.clear(within(sheet).getByLabelText("Needed quantity"));
    await user.type(within(sheet).getByLabelText("Needed quantity"), "4");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.updateItem).toHaveBeenCalledWith(LIST_ID, "shorts", {
      name: "Shorts",
      category: "Clothing",
      qty: 4,
    });
    expect(await screen.findByText("Shorts saved.")).toBeTruthy();
    expect(within(section("Clothing")).getByText("Needed 4")).toBeTruthy();
  });

  it("keeps an item's own category in the select when it isn't one of the standard ones", async () => {
    const { user } = setup(
      {},
      { ...base, items: [{ id: "x", name: "Mystery", category: "Pack last", qty: 1 }] },
    );
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit Mystery" }));
    const options = within(screen.getByRole("dialog"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toContain("Pack last");
  });

  it("says nothing changed, and keeps the sheet, when a save fails", async () => {
    const { user } = setup({
      addItem: vi.fn(async () => ({ ok: false as const, code: "INTERNAL" as const })) as never,
    });
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
    const sheet = screen.getByRole("dialog");
    await user.type(within(sheet).getByLabelText("Item name"), "Camera");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("Couldn’t save. Nothing was changed.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("removes an item at once with a toast, and Undo puts it back", async () => {
    const { user, actions } = setup();
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Remove Toothbrush" }));
    expect(actions.removeItem).toHaveBeenCalledWith(LIST_ID, "brush");
    await waitFor(() => expect(screen.queryByText("Toothbrush")).toBeNull());
    expect(await screen.findByText("“Toothbrush” removed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.addItem).toHaveBeenCalledWith(LIST_ID, {
      name: "Toothbrush",
      category: "Bathroom",
      qty: 1,
    });
    expect(await screen.findByText("Toothbrush")).toBeTruthy();
  });

  it("renames the list from the header, and says when the name is taken", async () => {
    const { user, actions } = setup();
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    await user.clear(within(sheet).getByLabelText("List name"));
    await user.type(within(sheet).getByLabelText("List name"), "Lake week");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.rename).toHaveBeenCalledWith(LIST_ID, "Lake week");
    expect(await screen.findByRole("heading", { name: "Lake week", level: 1 })).toBeTruthy();
  });

  it("keeps the rename sheet open and says the name is taken", async () => {
    const { user } = setup({
      rename: vi.fn(async () => ({
        ok: false as const,
        code: "REJECTED" as const,
        reason: "NAME_TAKEN",
      })) as never,
    });
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    await user.type(within(sheet).getByLabelText("List name"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText(/You already have a list called/)).toBeTruthy();
  });

  it("says nothing changed when a rename fails", async () => {
    const { user } = setup({
      rename: vi.fn(async () => ({ ok: false as const, code: "INTERNAL" as const })) as never,
    });
    await screen.findByRole("heading", { name: "Beach week", level: 1 });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    await user.type(within(sheet).getByLabelText("List name"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("Couldn’t save. Nothing was changed.")).toBeTruthy();
  });
});
