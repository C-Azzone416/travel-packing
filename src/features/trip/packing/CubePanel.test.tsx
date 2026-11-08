// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
