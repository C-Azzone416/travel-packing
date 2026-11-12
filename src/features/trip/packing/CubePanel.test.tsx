// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("CubePanel Morning of (#412)", () => {
  it("offers the Morning of switch on an ordinary trip", () => {
    render(<CubePanel {...props({})} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByText("Morning of")).toBeTruthy();
  });

  it("leaves the switch out on a day trip, where you are home the same day", () => {
    render(
      <CubePanel {...props({ view: { ...view("misc", "Misc"), morningOfAvailable: false } })} />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Morning of")).toBeNull();
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
    const { rerender } = render(<CubePanel {...normal({ view: view1 })} />);
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel
        {...normal({
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
    const { rerender } = render(
      <CubePanel {...props({ editing: false, filter: "packed", view: before })} />,
    );
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel
        {...props({ editing: false, filter: "packed", view: withItems(["old", 1], ["Hat", 0]) })}
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
    const { rerender } = render(
      <CubePanel {...props({ editing: false, view: withItems(["a", 0], ["z", 0]) })} />,
    );
    await user.click(screen.getByRole("button", { name: "Add an item to Misc" }));
    await user.type(screen.getByPlaceholderText("+ Add an item"), "Hat{Enter}");
    rerender(
      <CubePanel {...props({ editing: false, view: withItems(["a", 0], ["Hat", 0], ["z", 0]) })} />,
    );
    await waitFor(() => expect(scrolled).toEqual(["Hat"]));
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
