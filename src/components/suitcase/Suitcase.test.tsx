// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Suitcase } from "./Suitcase";
import { LuggageTag } from "./LuggageTag";
import { CountdownBadge, countdownLabel } from "./CountdownBadge";
import { cx } from "./cx";

const css = (file: string) =>
  readFileSync(join(process.cwd(), "src/components/suitcase", file), "utf8");

describe("Suitcase", () => {
  it("is a paper suitcase with the Home padding by default, and its handle is decoration", () => {
    const { container } = render(<Suitcase>content</Suitcase>);
    const interior = container.querySelector("[data-interior]") as HTMLElement;
    expect(interior.getAttribute("data-interior")).toBe("paper");
    expect(interior.getAttribute("data-inset")).toBe("home");
    expect(interior.textContent).toBe("content");
    expect(container.querySelector("[data-suitcase-handle]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("a dark interior touches the rim unless an inset is asked for", () => {
    const dark = render(<Suitcase interior="dark">a</Suitcase>);
    expect(dark.container.querySelector("[data-interior]")?.getAttribute("data-inset")).toBe(
      "none",
    );
    expect(dark.container.querySelector("[data-interior]")?.className).toContain("dark");
    dark.unmount();
    const staples = render(
      <Suitcase interior="dark" inset="staples">
        a
      </Suitcase>,
    );
    expect(staples.container.querySelector("[data-interior]")?.getAttribute("data-inset")).toBe(
      "staples",
    );
  });

  it("passes attributes and a class to the outer element", () => {
    render(
      <Suitcase data-testid="case" className="mine" aria-label="Trips">
        x
      </Suitcase>,
    );
    const outer = screen.getByTestId("case");
    expect(outer.className).toContain("mine");
    expect(outer.getAttribute("aria-label")).toBe("Trips");
  });

  it("keeps the spec measurements: rim 14/9, radii 32/22 and 20/14, handle 120x22 / 80x16", () => {
    const text = css("Suitcase.module.css");
    const phone = text.slice(0, text.indexOf("@media"));
    const laptop = text.slice(text.indexOf("@media (min-width: 1024px)"));
    for (const [block, values] of [
      [
        phone,
        [
          "--rim: 9px",
          "--radius-out: 22px",
          "--radius-in: 14px",
          "min(80px, 40%)",
          "--handle-h: 16px",
          "--handle-stroke: 6px",
        ],
      ],
      [
        laptop,
        [
          "--rim: 14px",
          "--radius-out: 32px",
          "--radius-in: 20px",
          "min(120px, 40%)",
          "--handle-h: 22px",
          "--handle-stroke: 8px",
        ],
      ],
    ] as const)
      for (const value of values) expect(block).toContain(value);
    expect(text).toContain("border-bottom: 0");
    expect(text).toContain("var(--paper2)");
  });
});

describe("LuggageTag", () => {
  it("draws a card with a decorative hole and the trip content", () => {
    const { container } = render(
      <LuggageTag data-testid="tag">
        <p>Lisbon</p>
      </LuggageTag>,
    );
    expect(container.querySelector("[data-luggage-tag]")?.getAttribute("data-luggage-tag")).toBe(
      "card",
    );
    expect(container.querySelector("[data-luggage-hole]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.getByText("Lisbon")).toBeTruthy();
    expect(screen.getByTestId("tag").className).not.toContain("mini");
  });

  it("the mini variant is the upcoming-trip row", () => {
    const { container } = render(<LuggageTag variant="mini">02 APR</LuggageTag>);
    expect(container.querySelector("[data-luggage-tag]")?.getAttribute("data-luggage-tag")).toBe(
      "mini",
    );
    expect((container.firstChild as HTMLElement).className).toContain("mini");
  });

  it("keeps the spec notch, hole and padding, and shadows the wrapper so the shadow follows the notch", () => {
    const text = css("LuggageTag.module.css");
    for (const value of [
      "--notch: 19px",
      "--notch: 30px",
      "--hole: 12px",
      "--hole: 18px",
      "--pad: 16px 14px 16px 34px",
      "--pad: 28px 30px 28px 56px",
      "--pad: 14px 10px 14px 28px",
      "clip-path: polygon(",
      "filter: drop-shadow(",
      "box-shadow: 0 0 0 3px var(--tint)",
      "background: var(--page)",
    ])
      expect(text).toContain(value);
    expect(text.indexOf("filter: drop-shadow(")).toBeLessThan(text.indexOf(".tag {"));
  });
});

describe("CountdownBadge", () => {
  it.each([
    [12, "12 days"],
    [1, "1 day"],
    [0, "Today"],
    [-3, "Today"],
    [2.9, "2 days"],
    [Number.NaN, "Today"],
  ])("%s becomes %s", (days, label) => {
    expect(countdownLabel(days)).toBe(label);
  });

  it("shows the label as text", () => {
    render(<CountdownBadge days={12} />);
    expect(screen.getByText("12 days")).toBeTruthy();
  });

  it("the toGo form is a Fraunces numeral plus 'days to go' (singular for 1, Leaves today for 0)", () => {
    const { container, rerender } = render(<CountdownBadge days={12} toGo />);
    expect(container.textContent).toBe("12 days to go");
    expect(container.querySelector("[data-countdown]")?.getAttribute("data-countdown")).toBe(
      "to-go",
    );
    expect(container.querySelector("[class*=numeral]")?.textContent).toBe("12");
    rerender(<CountdownBadge days={1} toGo />);
    expect(container.textContent).toBe("1 day to go");
    rerender(<CountdownBadge days={0} toGo />);
    expect(container.textContent).toBe("Leaves today");
    const text = css("CountdownBadge.module.css");
    expect(text).toMatch(
      /\.numeral \{[^}]*font-family: var\(--font-display\)[^}]*font-weight: 800/,
    );
  });

  it("never runs past its tag: it wraps at 239px and below", () => {
    const text = css("CountdownBadge.module.css");
    expect(text).toMatch(/max-width: 100%/);
    expect(text).toMatch(/max-width: 239px\) \{\s*\.badge \{\s*white-space: normal/);
  });

  it("uses the accent fill and --onDark text", () => {
    const text = css("CountdownBadge.module.css");
    expect(text).toContain("background: var(--accent)");
    expect(text).toContain("color: var(--onDark)");
  });
});

describe("cx", () => {
  it("drops everything that is not a class name", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });
});
