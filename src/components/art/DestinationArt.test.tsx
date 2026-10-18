// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "@/domain/themes";
import { DestinationArt } from "./DestinationArt";

function setup(props: Parameters<typeof DestinationArt>[0]) {
  const view = render(<DestinationArt {...props} />);
  const visual = view.container.firstElementChild as HTMLElement;
  return { ...view, visual, image: () => visual.querySelector("img") };
}

describe("DestinationArt", () => {
  it("renders decorative art: hidden from assistive tech, empty alt, no text", () => {
    const { visual, image } = setup({ theme: "beach", variant: "card" });
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("");
    expect(image()?.getAttribute("alt")).toBe("");
    expect(image()?.getAttribute("aria-hidden")).toBe("true");
    expect(visual.dataset.artKey).toBe("beach");
    expect(image()?.getAttribute("src")).toBe("/themes/beach.svg");
  });

  it.each(THEME_IDS)("the %s theme shows its own illustration", (theme) => {
    const { visual, image } = setup({ theme, variant: "header" });
    expect(visual.dataset.artKey).toBe(theme);
    expect(image()?.getAttribute("src")).toBe(`/themes/${theme}.svg`);
  });

  it.each([[null], [undefined]])("a trip with no theme (%s) shows Travel", (theme) => {
    const { visual, image } = setup({ theme, variant: "card" });
    expect(visual.dataset.artKey).toBe("travel");
    expect(image()?.getAttribute("src")).toBe("/themes/travel.svg");
  });

  it("applies the variant class", () => {
    expect(setup({ theme: null, variant: "card" }).visual.className).toMatch(/card/);
    expect(setup({ theme: null, variant: "header" }).visual.className).toMatch(/header/);
  });

  it("loads lazily by default and eagerly (high priority) only when asked", () => {
    const lazy = setup({ theme: "city", variant: "card" }).image();
    expect(lazy?.getAttribute("loading")).toBe("lazy");
    expect(lazy?.getAttribute("fetchpriority")).toBe("auto");
    const eager = setup({ theme: "city", variant: "card", priority: true }).image();
    expect(eager?.getAttribute("loading")).toBe("eager");
    expect(eager?.getAttribute("fetchpriority")).toBe("high");
  });

  it("swaps to the neutral surface when the image fails, keeping the same box", () => {
    const { visual, image } = setup({ theme: "city", variant: "card" });
    const before = visual.className;
    expect(visual.dataset.artFailed).toBeUndefined();
    fireEvent.error(image() as HTMLImageElement);
    expect(image()).toBeNull();
    expect(visual.dataset.artFailed).toBe("true");
    expect(visual.className).toContain("failed");
    expect(visual.className).toContain(before);
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("");
  });

  it("tries the new art again when the theme changes after a failure", () => {
    const { rerender, visual, image } = setup({ theme: "city", variant: "card" });
    fireEvent.error(image() as HTMLImageElement);
    expect(image()).toBeNull();
    rerender(<DestinationArt theme="outdoors" variant="card" />);
    expect(visual.dataset.artKey).toBe("outdoors");
    expect(visual.dataset.artFailed).toBeUndefined();
    expect(image()).not.toBeNull();
  });
});
