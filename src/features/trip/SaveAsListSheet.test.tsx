// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { TripItem } from "@/domain/trip";
import { SaveAsListSheet, type SaveOutcome } from "./SaveAsListSheet";

const items: TripItem[] = [
  { id: "tops", name: "Everyday tops", category: "Clothing", qty: 3, packed: 2, section: "main" },
  { id: "socks", name: "Socks", category: "Clothing", qty: 4, packed: 0, section: "main" },
  {
    id: "brush",
    name: "Toothbrush",
    category: "Bathroom",
    qty: 1,
    packed: 0,
    section: "packlast",
    groupId: "toiletry-bag",
  },
  {
    id: "top-r",
    name: "Fresh top",
    category: "Return outfit",
    qty: 1,
    packed: 0,
    section: "return",
  },
  { id: "laptop", name: "Laptop", category: "Tech", qty: 1, packed: 0, section: "packlast" },
];
const twins: TripItem[] = [
  ...items,
  { id: "socks-2", name: " socks ", category: "Clothing", qty: 2, packed: 0, section: "packlast" },
];

function setup(
  props: {
    items?: TripItem[];
    onSave?: (name: string, ids: string[]) => Promise<SaveOutcome>;
  } = {},
) {
  const onSave = vi.fn(props.onSave ?? (async () => ({ ok: true }) as SaveOutcome));
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderInApp(
    <SaveAsListSheet
      tripName="Lisbon, Porto"
      items={props.items ?? items}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { user, onSave, onClose };
}

const dialog = () => screen.getByRole("dialog", { name: "Save as a list" });

describe("SaveAsListSheet", () => {
  it("starts with the trip's name selected, every item ticked and grouped like the packing screen", () => {
    setup();
    const field = within(dialog()).getByLabelText("List name") as HTMLInputElement;
    expect(field.value).toBe("Lisbon, Porto");
    expect(within(dialog()).getByText("5 of 5 items")).toBeTruthy();
    expect(
      within(dialog())
        .getAllByRole("group")
        .map((group) => group.querySelector("legend")?.textContent),
    ).toEqual(["Everyday & occasion", "Toiletries", "Return outfit", "Pack last"]);
    for (const box of within(dialog()).getAllByRole("checkbox"))
      expect((box as HTMLInputElement).checked).toBe(true);
    expect(within(dialog()).getByText("Clothing · qty 3")).toBeTruthy();
    // No packed state anywhere in the dialog.
    expect(dialog().textContent).not.toMatch(/\d+ of \d+ packed/i);
  });

  it("unticks and re-ticks, Untick all / Tick all, and disables Save list with nothing ticked", async () => {
    const { user, onSave } = setup();
    await user.click(within(dialog()).getByRole("checkbox", { name: /Laptop/ }));
    expect(within(dialog()).getByText("4 of 5 items")).toBeTruthy();
    // One unticked: the toggle now offers Tick all; ticked again it offers Untick all.
    await user.click(within(dialog()).getByRole("button", { name: "Tick all" }));
    expect(within(dialog()).getByText("5 of 5 items")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Untick all" }));
    expect(within(dialog()).getByText("0 of 5 items")).toBeTruthy();
    expect(
      (within(dialog()).getByRole("button", { name: "Save list" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(within(dialog()).getByRole("button", { name: "Tick all" }));
    expect(within(dialog()).getByText("5 of 5 items")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the ticked items, in the displayed order, under the trimmed name", async () => {
    const { user, onSave } = setup();
    const field = within(dialog()).getByLabelText("List name");
    await user.clear(field);
    await user.type(field, "  Beach week ");
    await user.click(within(dialog()).getByRole("checkbox", { name: /Laptop/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Beach week", [
      "tops",
      "socks",
      "brush",
      "top-r",
    ]);
  });

  it("asks for a name instead of saving", async () => {
    const { user, onSave } = setup();
    await user.clear(within(dialog()).getByLabelText("List name"));
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(within(dialog()).getByText("Give the list a name.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says when the name is taken, keeps the choices, and says nothing changed when a save fails", async () => {
    let outcome: SaveOutcome = { ok: false, reason: "NAME_TAKEN" };
    const { user } = setup({ onSave: async () => outcome });
    await user.click(within(dialog()).getByRole("checkbox", { name: /Laptop/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(
      await within(dialog()).findByText(
        "You already have a list called “Lisbon, Porto”. Pick another name.",
      ),
    ).toBeTruthy();
    expect(within(dialog()).getByText("4 of 5 items")).toBeTruthy();
    outcome = { ok: false, reason: "FAILED" };
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(await within(dialog()).findByText("Couldn’t save. Nothing was changed.")).toBeTruthy();
  });

  it("with duplicates among the ticked items, goes to the resolver, with no default, and saves only what is kept", async () => {
    const { user, onSave } = setup({ items: twins });
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(onSave).not.toHaveBeenCalled();
    const step = screen.getByRole("dialog", { name: "Some items appear twice" });
    expect(within(step).getByText(/Nothing is combined or added together/)).toBeTruthy();
    expect(within(step).getByRole("group", { name: /Socks/ })).toBeTruthy();
    for (const radio of within(step).getAllByRole("radio"))
      expect((radio as HTMLInputElement).checked).toBe(false);
    const save = within(step).getByRole("button", { name: "Save list" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(step).getByText("Choose one for each duplicate (1 left)")).toBeTruthy();
    await user.click(within(step).getByRole("radio", { name: /qty 4/ }));
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Lisbon, Porto", [
      "tops",
      "socks",
      "brush",
      "top-r",
      "laptop",
    ]);
  });

  it("keep both saves both rows, and Back returns to the checklist with the choices kept", async () => {
    const { user, onSave } = setup({ items: twins });
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    let step = screen.getByRole("dialog", { name: "Some items appear twice" });
    await user.click(within(step).getByRole("button", { name: "Back" }));
    expect(
      within(screen.getByRole("dialog", { name: "Save as a list" })).getByText("6 of 6 items"),
    ).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    step = screen.getByRole("dialog", { name: "Some items appear twice" });
    await user.click(within(step).getByRole("radio", { name: /Keep both/ }));
    await user.click(within(step).getByRole("button", { name: "Save list" }));
    expect(onSave.mock.calls[0][1]).toEqual([
      "tops",
      "socks",
      "brush",
      "top-r",
      "laptop",
      "socks-2",
    ]);
  });

  it("unticking one of a pair removes the duplicate prompt", async () => {
    const { user, onSave } = setup({ items: twins });
    await user.click(within(dialog()).getByRole("checkbox", { name: /qty 2/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    expect(screen.queryByRole("dialog", { name: "Some items appear twice" })).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("returns to the name step when the name turns out to be taken after the duplicates were decided", async () => {
    const { user } = setup({
      items: twins,
      onSave: async () => ({ ok: false, reason: "NAME_TAKEN" }),
    });
    await user.click(within(dialog()).getByRole("button", { name: "Save list" }));
    const step = screen.getByRole("dialog", { name: "Some items appear twice" });
    await user.click(within(step).getByRole("radio", { name: /Keep both/ }));
    await user.click(within(step).getByRole("button", { name: "Save list" }));
    expect(await screen.findByText(/You already have a list called/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Save as a list" })).toBeTruthy();
  });

  it("Cancel closes without saving", async () => {
    const { user, onSave, onClose } = setup();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
