// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import { StapleEditor } from "./StapleEditor";

// The modal editor now serves the first-time Staples setup (the Staples screen edits in place).
const socks: Staple = {
  id: "socks",
  name: "Socks",
  qty: 1,
  cadence: "per day",
  category: "Clothing",
  packLast: false,
};
const brush: Staple = {
  id: "toothbrush",
  name: "Toothbrush",
  qty: 1,
  cadence: "per trip",
  category: "Bathroom",
  packLast: true,
  groupId: TOILETRY_GROUP_ID,
};

function open(staple: Staple | null, extra: Partial<Parameters<typeof StapleEditor>[0]> = {}) {
  const props = {
    staple,
    staples: [socks, brush],
    saving: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    onEditOther: vi.fn(),
    ...extra,
  };
  render(<StapleEditor {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe("StapleEditor", () => {
  it("adds a staple with the chosen quantity, cadence, category and placement", async () => {
    const { user, onSave } = open(null);
    const dialog = screen.getByRole("dialog", { name: "Add a staple" });
    const itemName = within(dialog).getByLabelText("Item name");
    expect(itemName.getAttribute("autocomplete")).toBe("off");
    expect(itemName.getAttribute("name")).toBe("packing-item-name");
    expect(itemName.closest("form")?.getAttribute("autocomplete")).toBe("off");
    await user.type(itemName, " Hat ");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "2");
    await user.click(within(dialog).getByRole("radio", { name: /Per night/ }));
    await user.selectOptions(within(dialog).getByLabelText("Category"), "Tech");
    await user.click(within(dialog).getByRole("radio", { name: /Toiletry bag/ }));
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Hat",
        qty: 2,
        cadence: "per night",
        category: "Tech",
        packLast: true,
        groupId: TOILETRY_GROUP_ID,
      }),
    );
  });

  it("asks for a name and a quantity from 1 to 30, and refuses a duplicate", async () => {
    const { user, onSave, onEditOther } = open(null);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name.");
    await user.type(within(dialog).getByLabelText("Item name"), "Hat");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "31");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a quantity from 1 to 30.");
    await user.clear(within(dialog).getByLabelText("Item name"));
    await user.type(within(dialog).getByLabelText("Item name"), "socks");
    await user.click(within(dialog).getByRole("button", { name: "Edit it instead" }));
    expect(onEditOther).toHaveBeenCalledWith("socks");
    await user.click(within(dialog).getByRole("button", { name: "Add staple" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits a staple, keeping its cube and laundry flag, and changes Smart back when the section changes", async () => {
    const tees: Staple = {
      ...socks,
      id: "tops",
      name: "Tees",
      cadence: "per day",
      laundryHalves: true,
      cube: "misc",
    };
    const { user, onSave } = open(tees, { staples: [tees] });
    const dialog = screen.getByRole("dialog", { name: "Edit staple" });
    await user.click(within(dialog).getByRole("button", { name: "Save staple" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ laundryHalves: true, cube: "misc", id: "tops" }),
    );
    expect(within(dialog).getByRole("radio", { name: /Smart/ })).toHaveProperty("disabled", false);
    await user.click(within(dialog).getByRole("radio", { name: /Smart/ }));
    await user.selectOptions(within(dialog).getByLabelText("Category"), "Tech");
    expect(within(dialog).getByRole("radio", { name: /Fixed per trip/ })).toHaveProperty(
      "checked",
      true,
    );
  });

  it("confirms before removing, and can keep the item", async () => {
    const { user, onRemove } = open(brush);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("dialog", { name: "Remove Toothbrush?" });
    await user.click(within(confirm).getByRole("button", { name: "Keep item" }));
    expect(screen.getByRole("dialog", { name: "Edit staple" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove staple" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("saves nothing while a save is already in flight", async () => {
    const { onSave } = open(socks, { saving: true });
    const form = screen.getByRole("dialog").querySelector("form") as HTMLFormElement;
    form.requestSubmit();
    expect(onSave).not.toHaveBeenCalled();
  });
});
