// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ThemeId } from "@/domain/themes";
import { ThemePicker } from "./ThemePicker";

function Harness({
  start = "travel",
  onChange = () => {},
}: {
  start?: ThemeId;
  onChange?: (t: ThemeId) => void;
}) {
  const [value, setValue] = useState<ThemeId>(start);
  return (
    <ThemePicker
      value={value}
      onChange={(theme) => {
        onChange(theme);
        setValue(theme);
      }}
    />
  );
}

const ORDER = ["Travel", "City", "Beach", "Mountain / outdoors", "Theme park", "Home / family"];

describe("ThemePicker", () => {
  it("is a labelled radio group of six themes in design's order, with the helper text", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Trip theme" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(ORDER.map((label) => `${label}✓`));
    expect(
      within(group).getByText("Pick a picture for your trip. You can change it later."),
    ).toBeTruthy();
  });

  it("starts on the given theme (Travel by default), with exactly one selected", () => {
    render(<Harness />);
    expect((screen.getByRole("radio", { name: "Travel" }) as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);
  });

  it("selecting a tile reports the theme and moves the selection", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByText("Beach"));
    expect(onChange).toHaveBeenCalledWith("beach");
    expect((screen.getByRole("radio", { name: "Beach" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Travel" }) as HTMLInputElement).checked).toBe(false);
  });

  it("works from the keyboard: Tab enters the group once, arrows move and select", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Travel" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("city");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "City" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("beach");
  });

  it("each tile has decorative art and a visible name; a failed thumbnail leaves the name and a neutral box", () => {
    const { container } = render(<Harness />);
    const tile = container.querySelector('[data-theme-id="city"]') as HTMLElement;
    const image = tile.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("src")).toBe("/themes/city.svg");
    fireEvent.error(image);
    expect(tile.querySelector("img")).toBeNull();
    expect(tile.querySelector(".theme-thumb")).not.toBeNull();
    expect(within(tile).getByText("City")).toBeTruthy();
    // The other tiles keep their art.
    expect(
      (container.querySelector('[data-theme-id="beach"]') as HTMLElement).querySelector("img"),
    ).not.toBeNull();
  });

  it("takes custom helper text", () => {
    render(<ThemePicker value="travel" onChange={() => {}} help="Choose one." />);
    expect(screen.getByText("Choose one.")).toBeTruthy();
  });
});
