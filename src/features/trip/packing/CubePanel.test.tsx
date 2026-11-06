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
    expect(screen.getByPlaceholderText("+ Add an item")).toBeTruthy();
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
