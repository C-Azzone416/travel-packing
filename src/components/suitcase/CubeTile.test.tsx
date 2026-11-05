// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CubeChip, CubeRailItem, CubeTile, isComplete, percentPacked } from "./CubeTile";

const css = readFileSync(
  join(process.cwd(), "src/components/suitcase/CubeTile.module.css"),
  "utf8",
);

describe("percentPacked / isComplete", () => {
  it.each([
    [9, 14, 64],
    [0, 14, 0],
    [14, 14, 100],
    [20, 14, 100],
    [-2, 14, 0],
    [3, 0, 0],
    [0, 0, 0],
  ])("%s of %s is %s%%", (packed, total, percent) => {
    expect(percentPacked(packed, total)).toBe(percent);
  });

  it("an empty cube is never complete", () => {
    expect(isComplete(0, 0)).toBe(false);
    expect(isComplete(13, 14)).toBe(false);
    expect(isComplete(14, 14)).toBe(true);
    expect(isComplete(15, 14)).toBe(true);
  });
});

describe("CubeTile", () => {
  it("shows the name, the n/m quantity count and a bar filled to the packed share", () => {
    const { container } = render(<CubeTile name="Clothing" packed={9} total={14} />);
    expect(screen.getByText("Clothing")).toBeTruthy();
    expect(container.querySelector("[data-count]")?.textContent).toBe("9/14");
    expect((container.querySelector("[data-fill]") as HTMLElement).style.width).toBe("64%");
    expect(container.querySelector("[data-bar]")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toContain("9 of 14 packed");
    expect(container.querySelector("[data-cube-state]")?.getAttribute("data-cube-state")).toBe(
      "normal",
    );
  });

  it("joins the note and the Morning-of marker, and reserves the note line when there is none", () => {
    const { container, rerender } = render(
      <CubeTile name="Toiletries" packed={2} total={6} note="under 3.4 oz" morningOf />,
    );
    const note = container.querySelector("[data-note]") as HTMLElement;
    expect(note.textContent).toBe("under 3.4 oz · Morning of");
    expect(note.querySelector("[data-morning-of]")?.textContent).toBe("Morning of");
    rerender(<CubeTile name="Toiletries" packed={2} total={6} morningOf />);
    expect(container.querySelector("[data-note]")?.textContent).toBe("Morning of");
    rerender(<CubeTile name="Clothing" packed={2} total={6} />);
    expect(container.querySelector("[data-note]")).toBeTruthy();
    expect(container.querySelector("[data-note]")?.textContent).toBe("");
    expect(css).toMatch(/\.note \{[^}]*min-height: 1\.3em/);
  });

  it("the alert state is outlined, says it needs attention in words, and is marked for the bar and note", () => {
    const { container } = render(
      <CubeTile name="Rain gear" packed={1} total={4} note="Rain · 2 added" alert />,
    );
    expect(container.querySelector("[data-cube-state]")?.getAttribute("data-cube-state")).toBe(
      "alert",
    );
    expect(container.textContent).toContain("1 of 4 packed, needs attention");
    expect(container.firstElementChild?.className).toContain("alert");
    expect(css).toMatch(/\.alert \{\s*border-color: var\(--accent\)/);
    expect(css).toMatch(/\.alert \.fill \{\s*background: var\(--accent\)/);
    expect(css).toMatch(/\.alert \.note \{\s*color: var\(--accent\)/);
    expect(css).toMatch(/border: 2px solid transparent/);
  });

  it("a complete cube turns the bar good and adds a check after the count", () => {
    const { container } = render(<CubeTile name="Tech" packed={5} total={5} />);
    expect(container.querySelector("[data-cube-state]")?.getAttribute("data-cube-state")).toBe(
      "complete",
    );
    expect(container.querySelector("[data-count] [data-icon='check']")).toBeTruthy();
    expect(container.textContent).toContain("5 of 5 packed, complete");
    expect(css).toMatch(/\.complete \.fill \{\s*background: var\(--good\)/);
  });

  it("an alert wins over complete, and an incomplete cube has no check", () => {
    const alert = render(<CubeTile name="Rain gear" packed={4} total={4} alert />);
    expect(
      alert.container.querySelector("[data-cube-state]")?.getAttribute("data-cube-state"),
    ).toBe("alert");
    alert.unmount();
    const partial = render(<CubeTile name="Tech" packed={4} total={5} />);
    expect(partial.container.querySelector("[data-icon='check']")).toBeNull();
  });

  it("is a link to the cube when it has an href, and a plain block otherwise", () => {
    const linked = render(<CubeTile name="Clothing" packed={1} total={2} href="/trips/1?cube=c" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/trips/1?cube=c");
    linked.unmount();
    render(<CubeTile name="Clothing" packed={1} total={2} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the phone tile without a visible note but the note stays readable", () => {
    expect(css).toMatch(/\.noteLaptopOnly \{[^}]*clip: rect\(0, 0, 0, 0\)/);
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*\.noteLaptopOnly \{\s*position: static/,
    );
  });

  it("the phone tile name is 15px so Documents fits the 80px inner width at 390", () => {
    expect(css).toMatch(/\.tile \.name \{[^}]*font-size: 15px/);
    expect(css).toMatch(/min-width: 1024px\)[\s\S]*\.tile \.name \{\s*font-size: 16px/);
  });

  it("a tile name breaks mid-word only as a last resort: break-word on phones, anywhere only at 239px and below", () => {
    expect(css).toMatch(/\.tile \.name \{[^}]*overflow-wrap: break-word/);
    expect(css).toMatch(/max-width: 239px\) \{\s*\.tile \.name \{\s*overflow-wrap: anywhere/);
  });

  it("keeps the spec tile measurements: laptop padding 16 radius 16 bar 8, phone padding 10 8 radius 12 bar 6", () => {
    expect(css).toMatch(/\.tile \{[^}]*padding: 10px 8px;[^}]*border-radius: 12px/);
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*padding: 16px;\s*border-radius: 16px/);
    expect(css).toMatch(/\.bar \{[^}]*height: 6px/);
    expect(css).toMatch(/\.tile \.bar \{\s*height: 8px/);
  });
});

describe("CubeRailItem", () => {
  it("is a button pressed when selected, and selecting reports it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <CubeRailItem name="Clothing" packed={9} total={14} onSelect={onSelect} />,
    );
    const button = screen.getByRole("button", { name: /Clothing/ });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
    rerender(<CubeRailItem name="Clothing" packed={9} total={14} selected />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button").className).toContain("railSelected");
  });

  it("is named with its quantity count and shows the note and Morning-of marker", () => {
    render(<CubeRailItem name="Toiletries" packed={2} total={6} note="under 3.4 oz" morningOf />);
    expect(screen.getByRole("button").textContent).toContain("2 of 6 packed");
    expect(screen.getByText("Morning of")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toContain("under 3.4 oz · Morning of");
  });

  it("an alert rail item has an accent bar and note but no outline", () => {
    render(<CubeRailItem name="Rain gear" packed={1} total={4} alert />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("railAlert");
    expect(button.getAttribute("data-cube-state")).toBe("alert");
    expect(button.textContent).toContain("needs attention");
    expect(css).toMatch(/\.railAlert \.fill \{\s*background: var\(--accent\)/);
    expect(css).toMatch(/\.rail \{[^}]*border: 0/);
  });

  it("a complete rail item gets the good bar", () => {
    render(<CubeRailItem name="Tech" packed={3} total={3} />);
    expect(screen.getByRole("button").className).toContain("railComplete");
    expect(css).toMatch(/\.railComplete \.fill \{\s*background: var\(--good\)/);
  });

  it("uses the dark-suitcase colours, and a selected item is a paper card", () => {
    expect(css).toMatch(/\.rail \{[^}]*color: var\(--onDark\)/);
    expect(css).toMatch(/\.rail \.bar \{\s*background: var\(--dark2\)/);
    expect(css).toMatch(/\.railSelected \{\s*background: var\(--paper\)/);
  });
});

describe("hidden text stays inside its control", () => {
  it("chips and rail items are positioned, so a scroll container clips their visually hidden text (195px overflow)", () => {
    expect(css).toMatch(/\.rail \{\s*position: relative/);
    expect(css).toMatch(/\.chip \{\s*position: relative/);
    expect(css).toMatch(/\.tile \{\s*position: relative/);
    expect(
      readFileSync(join(process.cwd(), "src/components/suitcase/Markers.module.css"), "utf8"),
    ).toMatch(/\.laundry \{\s*position: relative/);
  });
});

describe("CubeChip", () => {
  it("shows the name, 9/14, and the Morning-of marker after the count", async () => {
    const onSelect = vi.fn();
    render(<CubeChip name="Toiletries" packed={6} total={9} morningOf onSelect={onSelect} />);
    const chip = screen.getByRole("button", { name: /Toiletries/ });
    expect(chip.textContent).toContain("6/96 of 9 packedMorning of");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("the selected chip is dark and has no marker when the cube is not flagged", () => {
    render(<CubeChip name="Clothing" packed={1} total={2} selected />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain("chipSelected");
    expect(screen.queryByText("Morning of")).toBeNull();
    expect(css).toMatch(
      /\.chipSelected \{[^}]*background: var\(--dark\)[^}]*color: var\(--onDark\)/,
    );
    expect(css).toMatch(/\.chip \{[^}]*border: 2px solid var\(--tint\)/);
  });
});
