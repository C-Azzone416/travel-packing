// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DestinationArt } from "./DestinationArt";

function setup(props: Parameters<typeof DestinationArt>[0]) {
  const view = render(<DestinationArt {...props} />);
  const visual = view.container.firstElementChild as HTMLElement;
  return { ...view, visual, image: () => visual.querySelector("img") };
}

describe("DestinationArt", () => {
  it("renders decorative art: hidden from assistive tech, empty alt, no text", () => {
    const { visual, image } = setup({ locationId: "pt-lisbon", variant: "card" });
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("");
    expect(image()?.getAttribute("alt")).toBe("");
    expect(image()?.getAttribute("aria-hidden")).toBe("true");
    expect(visual.dataset.artKey).toBe("lisbon");
    expect(decodeURIComponent(image()?.getAttribute("src") ?? "")).toContain(
      "destination-lisbon.jpg",
    );
  });

  it.each([
    ["us-ca-san-diego", "san-diego"],
    ["gb-eng-london", "london"],
    ["something-else", "fallback"],
    [null, "fallback"],
    [undefined, "fallback"],
  ])("location %j uses the %s art", (locationId, key) => {
    const { visual, image } = setup({ locationId, variant: "header" });
    expect(visual.dataset.artKey).toBe(key);
    expect(image()).not.toBeNull();
  });

  it("applies the variant class", () => {
    expect(setup({ locationId: null, variant: "card" }).visual.className).toMatch(/card/);
    expect(setup({ locationId: null, variant: "header" }).visual.className).toMatch(/header/);
  });

  it("loads lazily by default and eagerly (high priority) only when asked", () => {
    const lazy = setup({ locationId: "pt-lisbon", variant: "card" }).image();
    expect(lazy?.getAttribute("loading")).toBe("lazy");
    expect(lazy?.getAttribute("fetchpriority")).toBe("auto");
    const eager = setup({ locationId: "pt-lisbon", variant: "card", priority: true }).image();
    expect(eager?.getAttribute("loading")).toBe("eager");
    expect(eager?.getAttribute("fetchpriority")).toBe("high");
  });

  it("swaps to the neutral surface when the image fails, keeping the same box", () => {
    const { visual, image } = setup({ locationId: "pt-lisbon", variant: "card" });
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

  it("tries the new art again when the destination changes after a failure", () => {
    const { rerender, visual, image } = setup({ locationId: "pt-lisbon", variant: "card" });
    fireEvent.error(image() as HTMLImageElement);
    expect(image()).toBeNull();
    rerender(<DestinationArt locationId="gb-eng-london" variant="card" />);
    expect(visual.dataset.artKey).toBe("london");
    expect(visual.dataset.artFailed).toBeUndefined();
    expect(image()).not.toBeNull();
  });
});
