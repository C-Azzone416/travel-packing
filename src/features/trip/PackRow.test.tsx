// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripItem } from "@/domain/trip";
import { PackRow } from "./PackRow";

const item = (patch: Partial<TripItem> = {}): TripItem => ({
  id: "socks",
  name: "Socks",
  category: "Clothing",
  qty: 4,
  packed: 1,
  section: "main",
  ...patch,
});

function renderRow(patch: Partial<TripItem> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onEdit: vi.fn(),
    onRetry: vi.fn(),
  };
  const view = render(<PackRow item={item(patch)} failed={false} {...handlers} />);
  return { ...view, ...handlers };
}

describe("PackRow", () => {
  it("shows Pack all and Edit target as their own buttons, and the state mark is not a control", async () => {
    const { container, onToggle, onEdit } = renderRow();
    expect(container.querySelector(".check-state")?.getAttribute("aria-hidden")).toBe("true");
    const packAll = screen.getByRole("button", { name: "Pack all Socks" });
    expect(packAll.textContent).toBe("Pack all");
    expect(packAll.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(packAll);
    expect(onToggle).toHaveBeenCalledWith("socks");
    await userEvent.click(screen.getByRole("button", { name: "Edit target for Socks" }));
    expect(onEdit).toHaveBeenCalledWith("socks");
  });

  it("a completed row keeps the same controls: Pack all becomes Packed, which unpacks", async () => {
    const { container, onToggle } = renderRow({ packed: 4 });
    expect(container.querySelector(".pack-row")?.className).toContain("complete");
    expect(container.querySelector(".check-state")?.textContent).toBe("✓");
    const packed = screen.getByRole("button", { name: "Packed, mark Socks unpacked" });
    expect(packed.textContent).toBe("Packed");
    expect(packed.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Edit target for Socks" })).toBeTruthy();
    await userEvent.click(packed);
    expect(onToggle).toHaveBeenCalledWith("socks");
  });
});
