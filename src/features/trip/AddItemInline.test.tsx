// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripItem } from "@/domain/trip";
import { AddItemInline } from "./AddItemInline";

const items: TripItem[] = [
  { id: "socks", name: "Socks", category: "Clothing", qty: 3, packed: 1, section: "main" },
];

function setup(props: Partial<React.ComponentProps<typeof AddItemInline>> = {}) {
  const onAdd = vi.fn(async () => true);
  const onBathroom = vi.fn();
  const onEditExisting = vi.fn();
  const user = userEvent.setup();
  render(
    <AddItemInline
      items={items}
      onAdd={onAdd}
      onBathroom={onBathroom}
      onEditExisting={onEditExisting}
      {...props}
    />,
  );
  return { user, onAdd, onBathroom, onEditExisting };
}

const toggle = () => screen.getByRole("button", { name: "＋ Add item" });

describe("AddItemInline", () => {
  it("is closed until asked, announces its state, and opens on the name field", async () => {
    const { user } = setup();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Item name" }));
    expect((screen.getByRole("spinbutton", { name: "Needed" }) as HTMLInputElement).value).toBe(
      "1",
    );
    const categories = screen.getAllByRole("option").map((option) => option.textContent);
    expect(categories).toEqual([
      "Clothing",
      "Nice attire",
      "Tech",
      "Other essentials",
      "Accessories",
      "Bathroom",
    ]);
  });

  it("adds the item with its category and quantity, then folds away and returns focus to the button", async () => {
    const { user, onAdd } = setup();
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "  Camera ");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Tech");
    await user.clear(screen.getByRole("spinbutton", { name: "Needed" }));
    await user.type(screen.getByRole("spinbutton", { name: "Needed" }), "2");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith({
      name: "Camera",
      category: "Tech",
      neededQty: 2,
    });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(document.activeElement).toBe(toggle());
  });

  it("asks for a name and a sensible quantity instead of adding", async () => {
    const { user, onAdd } = setup();
    await user.click(toggle());
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect((await screen.findByText("Enter an item name.")).getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Item name" }));
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    expect(screen.queryByText("Enter an item name.")).toBeNull();
    await user.clear(screen.getByRole("spinbutton", { name: "Needed" }));
    await user.type(screen.getByRole("spinbutton", { name: "Needed" }), "0");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Enter a whole number from 1 to 999.")).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("says an item is already there, offers Edit quantity, and adds nothing", async () => {
    const { user, onAdd, onEditExisting } = setup();
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "socks");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Socks is already on your list (needed: 3).",
    );
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit quantity" }));
    expect(onEditExisting).toHaveBeenCalledExactlyOnceWith("socks");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("the same name in another category is not a duplicate", async () => {
    const { user, onAdd } = setup();
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Socks");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Accessories");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("hands Bathroom off to the Bathroom form with the name and quantity", async () => {
    const { user, onAdd, onBathroom } = setup();
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Floss");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Bathroom");
    expect(screen.getByText(/use the Bathroom form/)).toBeTruthy();
    await user.clear(screen.getByRole("spinbutton", { name: "Needed" }));
    await user.type(screen.getByRole("spinbutton", { name: "Needed" }), "2");
    await user.click(screen.getByRole("button", { name: "Continue to Bathroom item" }));
    expect(onBathroom).toHaveBeenCalledExactlyOnceWith("Floss", 2);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps what was typed and says nothing changed when the save fails; editing clears the message", async () => {
    const { user, onAdd } = setup({ onAdd: vi.fn(async () => false) });
    void onAdd;
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Couldn’t add that item. Nothing was changed.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Item name" }) as HTMLInputElement).value).toBe(
      "Camera",
    );
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "s");
    expect(screen.queryByText("Couldn’t add that item. Nothing was changed.")).toBeNull();
  });

  it("waits while another save is in flight, and Cancel folds the form away", async () => {
    const { user, onAdd } = setup({ busy: true });
    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    expect(
      (screen.getByRole("button", { name: "Add to list" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.keyboard("{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(toggle());
    await user.click(toggle());
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
