// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { SavedListActions } from "@/features/staples/saved-list-actions";
import type { SavedListSummary } from "@/server/data/service";
import { SavedListsScreen } from "./SavedListsScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/staples/lists" }));

const beach: SavedListSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Beach week",
  itemCount: 7,
  updatedAt: "2026-10-12T15:00:00Z",
  categories: [
    { category: "Clothing", count: 4 },
    { category: "Bathroom", count: 3 },
  ],
};
const ski: SavedListSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Ski trip",
  itemCount: 1,
  updatedAt: "2026-10-10T15:00:00Z",
  categories: [{ category: "Clothing", count: 1 }],
};

function setup(
  initial: SavedListSummary[] = [beach, ski],
  overrides: Partial<SavedListActions> = {},
) {
  let lists = [...initial];
  const actions = {
    list: vi.fn(async () => ({ ok: true as const, lists })),
    rename: vi.fn(async (id: string, name: string) => {
      lists = lists.map((list) => (list.id === id ? { ...list, name } : list));
      return { ok: true as const, list: { id, name, updatedAt: "", items: [] } };
    }),
    remove: vi.fn(async (id: string) => {
      lists = lists.filter((list) => list.id !== id);
      return { ok: true as const, id };
    }),
    ...overrides,
  };
  const user = userEvent.setup();
  renderInApp(<SavedListsScreen actions={actions as unknown as SavedListActions} />);
  return { user, actions };
}

describe("SavedListsScreen", () => {
  it("shows a card per list: name, item count, last change and what it holds, with Edit, Rename and Delete", async () => {
    setup();
    const card = await screen.findByRole("article", { name: "Beach week" });
    expect(within(card).getByText("7 items · updated Oct 12")).toBeTruthy();
    expect(within(card).getByText("Clothing 4 · Bathroom 3")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Edit Beach week" }).getAttribute("href")).toBe(
      `/staples/lists/${beach.id}`,
    );
    expect(within(card).getByRole("button", { name: "Rename Beach week" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Delete Beach week" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Lists you reuse", level: 1 })).toBeTruthy();
    // The tab switcher: Saved lists is the current page, and there is no Add button.
    expect(screen.getByRole("link", { name: "Saved lists" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Staples" }).getAttribute("href")).toBe("/staples");
    expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
  });

  it("says there are no saved lists yet and where to make one", async () => {
    setup([]);
    expect(await screen.findByText("No saved lists yet.")).toBeTruthy();
    expect(screen.getByText(/choose Save as a list/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to trips" }).getAttribute("href")).toBe("/");
  });

  it("shows an error with Try again when the lists can't load, and recovers", async () => {
    let fail = true;
    const { user, actions } = setup([beach], {
      list: vi.fn(async () =>
        fail
          ? { ok: false as const, code: "INTERNAL" as const }
          : { ok: true as const, lists: [beach] },
      ) as never,
    });
    void actions;
    expect(await screen.findByText("Couldn’t load your saved lists.")).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Beach week" })).toBeTruthy();
  });

  it("renames a list: the sheet saves the new name, the card shows it, and a toast says so", async () => {
    const { user, actions } = setup();
    await screen.findByRole("article", { name: "Beach week" });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    const field = within(sheet).getByLabelText("List name") as HTMLInputElement;
    expect(field.value).toBe("Beach week");
    await user.clear(field);
    await user.type(field, "  Lake week ");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.rename).toHaveBeenCalledWith(beach.id, "Lake week");
    expect(await screen.findByRole("article", { name: "Lake week" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Rename list" })).toBeNull();
    expect(screen.getByText("Renamed to “Lake week”.")).toBeTruthy();
  });

  it("asks for a name, and says when the name is taken, keeping the sheet open", async () => {
    const { user } = setup(undefined, {
      rename: vi.fn(async () => ({
        ok: false as const,
        code: "REJECTED" as const,
        reason: "NAME_TAKEN",
      })) as never,
    });
    await screen.findByRole("article", { name: "Beach week" });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    const field = within(sheet).getByLabelText("List name");
    await user.clear(field);
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(within(sheet).getByText("Give the list a name.")).toBeTruthy();
    await user.type(field, "Ski trip");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(
      await within(sheet).findByText(
        "You already have a list called “Ski trip”. Pick another name.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Rename list" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Rename list" })).toBeNull();
  });

  it("says nothing changed when a rename fails", async () => {
    const { user } = setup(undefined, {
      rename: vi.fn(async () => ({ ok: false as const, code: "INTERNAL" as const })) as never,
    });
    await screen.findByRole("article", { name: "Beach week" });
    await user.click(screen.getByRole("button", { name: "Rename Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Rename list" });
    await user.type(within(sheet).getByLabelText("List name"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("Couldn’t save. Nothing was changed.")).toBeTruthy();
  });

  it("deletes after confirming, saying existing trips are not affected", async () => {
    const { user, actions } = setup();
    await screen.findByRole("article", { name: "Beach week" });
    await user.click(screen.getByRole("button", { name: "Delete Beach week" }));
    const sheet = screen.getByRole("dialog", { name: "Delete “Beach week”?" });
    expect(
      within(sheet).getByText(/Trips already made from this list aren't affected/),
    ).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Delete list" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Beach week" })).toBeNull());
    expect(actions.remove).toHaveBeenCalledWith(beach.id);
    expect(screen.getByText("“Beach week” deleted.")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Ski trip" })).toBeTruthy();
  });

  it("Cancel changes nothing, and a failed delete keeps the list and the sheet and says so", async () => {
    const { user, actions } = setup(undefined, {
      remove: vi.fn(async () => ({ ok: false as const, code: "INTERNAL" as const })) as never,
    });
    await screen.findByRole("article", { name: "Beach week" });
    await user.click(screen.getByRole("button", { name: "Delete Beach week" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete Beach week" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete list" }),
    );
    expect(await screen.findByText("Couldn’t delete. Nothing was changed.")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Beach week" })).toBeTruthy();
  });

  it("treats a list that is already gone as deleted", async () => {
    const { user } = setup(undefined, {
      remove: vi.fn(async () => ({ ok: false as const, code: "NOT_FOUND" as const })) as never,
    });
    await screen.findByRole("article", { name: "Ski trip" });
    await user.click(screen.getByRole("button", { name: "Delete Ski trip" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete list" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("“Ski trip” deleted.")).toBeTruthy();
    await act(async () => {});
  });
});
