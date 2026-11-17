// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CubePanel, type CubePanelProps } from "./CubePanel";
import type { CubeView } from "./packing-model";

const view = (cube: CubeView["cube"], label: string): CubeView => ({
  cube,
  label,
  items: [{ id: "x", name: "Thing", category: "Misc", qty: 1, packed: 0, section: "main" }],
  packed: 0,
  total: 1,
  morningOf: false,
  morningOfAvailable: true,
  note: null,
  alert: false,
});

function props(over: Partial<CubePanelProps>): CubePanelProps {
  const none = vi.fn();
  return {
    view: view("misc", "Misc"),
    cubes: [],
    filter: "all",
    onFilter: none,
    editing: true,
    onEditing: none,
    laundry: false,
    failedRows: new Set(),
    onTick: none,
    onRetry: none,
    onEditItem: none,
    onMove: none,
    onRemove: none,
    onMorningOf: none,
    onAdd: vi.fn(async () => ({ ok: true as const })),
    panelId: "panel",
    titleId: "title",
    ...over,
  };
}

describe("CubePanel Edit list add controls", () => {
  it("shows the generic add row in an ordinary cube", () => {
    render(<CubePanel {...props({})} />);
    const itemName = screen.getByPlaceholderText("+ Add an item");
    expect(itemName.getAttribute("autocomplete")).toBe("off");
    expect(itemName.getAttribute("name")).toBe("packing-item-name");
    expect(itemName.closest("form")?.getAttribute("autocomplete")).toBe("off");
  });

  it("shows only the cube-specific add control when the cube has a bag step (Toiletries)", () => {
    render(
      <CubePanel
        {...props({
          view: view("toiletries", "Toiletries"),
          extra: <button type="button">＋ Add a Bathroom item</button>,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Add a Bathroom item/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText("+ Add an item")).toBeNull();
  });
});

describe("CubePanel filter controls", () => {
  it("selects each filter and enters Edit list", async () => {
    const user = userEvent.setup();
    const onFilter = vi.fn();
    const onEditing = vi.fn();
    render(<CubePanel {...props({ editing: false, onFilter, onEditing })} />);
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByRole("button", { name: /^To pack/ }));
    await user.click(screen.getByRole("button", { name: /^Packed/ }));
    expect(onFilter.mock.calls).toEqual([["all"], ["to-pack"], ["packed"]]);
    await user.click(screen.getByRole("button", { name: "Edit list" }));
    expect(onEditing).toHaveBeenCalledWith(true);
  });
});

describe("CubePanel Morning of (#412)", () => {
  it("offers the Morning of switch on an ordinary trip", async () => {
    const user = userEvent.setup();
    const onMorningOf = vi.fn();
    render(<CubePanel {...props({ onMorningOf })} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByText("Morning of")).toBeTruthy();
    await user.click(screen.getByRole("switch"));
    expect(onMorningOf).toHaveBeenCalledWith("misc", true);
  });

  it("leaves the switch out on a day trip, where you are home the same day", () => {
    render(
      <CubePanel {...props({ view: { ...view("misc", "Misc"), morningOfAvailable: false } })} />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Morning of")).toBeNull();
  });

  it("locks Morning of when the cube contains a Pack last item", () => {
    const locked = view("misc", "Misc");
    locked.items = [{ ...locked.items[0]!, section: "packlast" }];
    render(<CubePanel {...props({ view: locked })} />);
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("A Pack last item is in this cube.")).toBeTruthy();
  });
});

describe("CubePanel quick add (#496)", () => {
  const normal = (over: Partial<CubePanelProps> = {}) => props({ editing: false, ...over });

  it("shows the Add an item button outside Edit list, named for the cube", () => {
    render(<CubePanel {...normal()} />);
    expect(screen.getByRole("button", { name: "Add an item to Misc" }).textContent).toBe(
      "＋ Add an item",
    );
    expect(screen.queryByPlaceholderText("+ Add an item")).toBeNull();
  });

  it("shows it in an empty cube and under a fully-packed To pack filter", () => {
    const empty = { ...view("misc", "Misc"), items: [], total: 0 };
    const { unmount } = render(<CubePanel {...normal({ view: empty })} />);
    expect(screen.getByRole("button", { name: "Add an item to Misc" })).toBeTruthy();
    unmount();
    const packed = view("misc", "Misc");
    packed.items = [{ ...packed.items[0]!, packed: 1 }];
    render(<CubePanel {...normal({ view: packed, filter: "to-pack" })} />);
    expect(screen.getByRole("button", { name: "Add an item to Misc" })).toBeTruthy();
  });

  it("renders no Add an item button or row in Toiletries, in either mode", () => {
    for (const editing of [false, true]) {
      const { unmount } = render(
        <CubePanel
          {...props({
            editing,
            view: view("toiletries", "Toiletries"),
            extra: <button type="button">＋ Add a Bathroom item</button>,
          })}
        />,
      );
      expect(screen.getAllByRole("button", { name: /^＋ Add/ })).toHaveLength(1);
      expect(screen.getByRole("button", { name: /Add a Bathroom item/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add an item to Toiletries" })).toBeNull();
      expect(screen.queryByPlaceholderText("+ Add an item")).toBeNull();
      unmount();
    }
  });

  it("has no second Add an item button while Edit list shows the row", () => {
    render(<CubePanel {...props({ editing: true })} />);
    expect(screen.queryByRole("button", { name: "Add an item to Misc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("opens the field with focus; Escape closes it, drops the text and refocuses the button", async () => {
    const user = userEvent.setup();
    render(<CubePanel {...normal()} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item");
    expect(document.activeElement).toBe(field);
    await user.type(field, "Hat{Escape}");
    const button = screen.getByRole("button", { name: "Add an item to Misc" });
    expect(document.activeElement).toBe(button);
    await user.click(button);
    expect((screen.getByPlaceholderText("+ Add an item") as HTMLInputElement).value).toBe("");
  });

  it("Cancel closes it the same way", async () => {
    const user = userEvent.setup();
    render(<CubePanel {...normal()} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add an item to Misc" }),
    );
  });

  it("adds through onAdd, stays open and focused, and blocks a double submit while saving", async () => {
    const user = userEvent.setup();
    let finish: (value: { ok: true }) => void = () => {};
    const onAdd = vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)));
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item");
    await user.type(field, "Hat{Enter}");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("misc", "Hat");
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(""));
    expect(document.activeElement).toBe(field);
  });

  it("scrolls the new row into view after a save", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view1 = view("misc", "Misc");
    const onAdd = vi.fn(async () => ({ ok: true as const, itemId: "y" }));
    const { rerender } = render(<CubePanel {...normal({ view: view1, onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel
        {...normal({
          onAdd,
          view: {
            ...view1,
            total: 2,
            items: [...view1.items, { ...view1.items[0]!, id: "y", name: "Hat" }],
          },
        })}
      />,
    );
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it("keeps the messages: empty, duplicate with Edit its quantity, and failure", async () => {
    const user = userEvent.setup();
    const onEditItem = vi.fn();
    const onAdd = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "EXISTS", existingId: "x" })
      .mockResolvedValueOnce({ ok: false, reason: "FAILED" });
    render(<CubePanel {...normal({ onAdd, onEditItem })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter an item name.");
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Thing{Enter}");
    await user.click(await screen.findByRole("button", { name: "Edit its quantity" }));
    expect(onEditItem).toHaveBeenCalledWith("x");
    await user.type(screen.getByPlaceholderText("+ Add an item"), "s{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t add it. Nothing was changed.",
    );
  });

  it("keeps a failed draft available for Retry, then clears it only after success", async () => {
    const user = userEvent.setup();
    const onAdd = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "FAILED" })
      .mockResolvedValueOnce({ ok: true });
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item") as HTMLInputElement;
    await user.type(field, "Hat{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t add it. Nothing was changed.",
    );
    expect(field.value).toBe("Hat");
    expect(field.readOnly).toBe(false);
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(field.value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenNthCalledWith(1, "misc", "Hat");
    expect(onAdd).toHaveBeenNthCalledWith(2, "misc", "Hat");
  });

  it("Cancel remains available after a failed add and discards its draft", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => ({ ok: false as const, reason: "FAILED" as const }));
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    await screen.findByRole("alert");
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    await user.click(cancel);
    expect(screen.getByRole("button", { name: "Add an item to Misc" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    expect((screen.getByPlaceholderText("+ Add an item") as HTMLInputElement).value).toBe("");
  });

  it("refuses an overlong name without sending it", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => ({ ok: true as const }));
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    fireEvent.change(screen.getByPlaceholderText("+ Add an item"), {
      target: { value: "x".repeat(121) },
    });
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Keep the name under 120 characters.",
    );
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("quick add while a write is pending (#496)", () => {
  const normal = (over: Partial<CubePanelProps> = {}) => props({ editing: false, ...over });

  it("cannot be dismissed: Cancel is disabled, Escape keeps the row, so a resubmit sends once", async () => {
    const user = userEvent.setup();
    let finish: (value: { ok: true }) => void = () => {};
    const onAdd = vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)));
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item");
    await user.type(field, "Hat{Enter}");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field.closest("form")!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    field.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Add an item to Misc" })).toBeNull();
    expect(screen.getByPlaceholderText("+ Add an item")).toBe(field);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it("keeps the field read-only while pending, so a newer draft is never cleared", async () => {
    const user = userEvent.setup();
    let finish: (value: { ok: true }) => void = () => {};
    const onAdd = vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)));
    render(<CubePanel {...normal({ onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item") as HTMLInputElement;
    await user.type(field, "Hat{Enter}");
    expect(field.readOnly).toBe(true);
    await user.type(field, "Gloves");
    expect(field.value).toBe("Hat");
    finish({ ok: true });
    await waitFor(() => expect(field.value).toBe(""));
    expect(field.readOnly).toBe(false);
  });
});

describe("quick add refused as already pending (#496)", () => {
  it("shows no message and keeps the typed name when the send layer says PENDING", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => ({ ok: false as const, reason: "PENDING" as const }));
    render(<CubePanel {...props({ editing: false, onAdd })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    const field = screen.getByPlaceholderText("+ Add an item") as HTMLInputElement;
    await user.type(field, "Hat{Enter}");
    await waitFor(() => expect(field.readOnly).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field.value).toBe("Hat");
  });
});

describe("quick add scrolling (#496)", () => {
  const withItems = (...rows: Array<[string, number]>) => {
    const base = view("misc", "Misc");
    return {
      ...base,
      total: rows.length,
      items: rows.map(([id, packed]) => ({ ...base.items[0]!, id, name: id, packed })),
    };
  };

  it("under Packed, adding an unpacked item scrolls nowhere", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const before = withItems(["old", 1]);
    const onAdd = vi.fn(async () => ({ ok: true as const, itemId: "Hat" }));
    const { rerender } = render(
      <CubePanel {...props({ editing: false, filter: "packed", view: before, onAdd })} />,
    );
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel
        {...props({
          editing: false,
          filter: "packed",
          view: withItems(["old", 1], ["Hat", 0]),
          onAdd,
        })}
      />,
    );
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(scroll).not.toHaveBeenCalled();
  });

  it("under All, scrolls to the saved row, not to the last one", async () => {
    const user = userEvent.setup();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-item-id") ?? "");
    };
    const onAdd = vi.fn(async () => ({ ok: true as const, itemId: "Hat" }));
    const { rerender } = render(
      <CubePanel {...props({ editing: false, view: withItems(["a", 0], ["z", 0]), onAdd })} />,
    );
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel
        {...props({ editing: false, view: withItems(["a", 0], ["Hat", 0], ["z", 0]), onAdd })}
      />,
    );
    await waitFor(() => expect(scrolled).toEqual(["Hat"]));
  });

  it("overlapping writes: another item arriving first is never scrolled to; the saved one is, when it lands", async () => {
    const user = userEvent.setup();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-item-id") ?? "");
    };
    let finish: (value: { ok: true; itemId: string }) => void = () => {};
    const onAdd = vi.fn(
      () => new Promise<{ ok: true; itemId: string }>((resolve) => (finish = resolve)),
    );
    const { rerender } = render(
      <CubePanel {...props({ editing: false, view: withItems(["a", 0]), onAdd })} />,
    );
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Sun hat{Enter}");
    // A different write (Rain hat) lands first.
    rerender(
      <CubePanel {...props({ editing: false, view: withItems(["a", 0], ["Rain", 0]), onAdd })} />,
    );
    expect(scrolled).toEqual([]);
    finish({ ok: true, itemId: "Sun" });
    rerender(
      <CubePanel
        {...props({ editing: false, view: withItems(["a", 0], ["Rain", 0], ["Sun", 0]), onAdd })}
      />,
    );
    await waitFor(() => expect(scrolled).toEqual(["Sun"]));
  });

  it("the Edit list pill is disabled while an add is pending in this cube", () => {
    render(<CubePanel {...props({ editing: false, editLocked: true })} />);
    expect((screen.getByRole("button", { name: "Edit list" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("CubePanel row branches", () => {
  it("shows and operates partial, return, laundry, and failed checklist details", async () => {
    const user = userEvent.setup();
    const item = {
      ...view("misc", "Misc").items[0]!,
      name: "Return layers",
      qty: 3,
      packed: 1,
      section: "return" as const,
      laundryHalves: true,
    };
    const onTick = vi.fn();
    const onRetry = vi.fn();
    render(
      <CubePanel
        {...props({
          editing: false,
          view: { ...view("misc", "Misc"), items: [item], total: 3, packed: 1 },
          laundry: true,
          failedRows: new Set([item.id]),
          onTick,
          onRetry,
        })}
      />,
    );
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);
    expect(screen.getByText("return outfit")).toBeTruthy();
    expect(screen.getByText("× 3")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await user.click(checkbox);
    expect(onTick).toHaveBeenCalledWith(item, true);
    await user.click(screen.getByRole("button", { name: "Not saved · Retry" }));
    expect(onRetry).toHaveBeenCalledWith(item.id);
  });

  it("operates edit, move, and remove for a return item with quantity", async () => {
    const user = userEvent.setup();
    const item = {
      ...view("misc", "Misc").items[0]!,
      name: "Return layers",
      qty: 2,
      section: "return" as const,
    };
    const onEditItem = vi.fn();
    const onMove = vi.fn();
    const onRemove = vi.fn();
    render(
      <CubePanel
        {...props({
          view: { ...view("misc", "Misc"), items: [item], total: 2 },
          cubes: [view("misc", "Misc"), view("clothing", "Clothing")],
          onEditItem,
          onMove,
          onRemove,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit Return layers/ }));
    expect(onEditItem).toHaveBeenCalledWith(item.id);
    const move = screen.getByRole("combobox", { name: /Move Return layers/ });
    fireEvent.change(move, { target: { value: "" } });
    expect(onMove).not.toHaveBeenCalled();
    await user.selectOptions(move, "clothing");
    expect(onMove).toHaveBeenCalledWith(item, "clothing");
    await user.click(screen.getByRole("button", { name: /Remove Return layers/ }));
    expect(onRemove).toHaveBeenCalledWith(item);
  });

  it("uses the compact phone count and omits the ordinary hint and filter bar", () => {
    render(<CubePanel {...props({ editing: false, layout: "phone" })} />);
    expect(screen.getByText("0 of 1")).toBeTruthy();
    expect(screen.queryByText("0 of 1 packed")).toBeNull();
    expect(screen.queryByRole("group", { name: "Packing list view" })).toBeNull();
    expect(screen.queryByText(/Tick as you pack/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add an item to Misc" })).toBeTruthy();
  });
});

describe("quick add colours (#496)", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/trip/packing/packing.module.css"),
    "utf8",
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`^${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`, "m"))![1]!;

  it("draws the button border in --muted (3:1 or better on the paper tokens), not --line2", () => {
    expect(rule(".quickAddButton")).toMatch(/border: 1px dashed var\(--muted\);/);
  });

  it("gives the phone sticky footer an opaque --paper2 with a --line top border", () => {
    const body = rule(".panelPhone .quickAdd");
    expect(body).toMatch(/background: var\(--paper2\);/);
    expect(body).toMatch(/border-top: 1px solid var\(--line\);/);
  });
});
