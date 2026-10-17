// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { locationById } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { ALLOW_CUSTOM_DESTINATION, LocationPicker } from "./LocationPicker";

function Harness({
  allowCustom,
  onSubmit = () => {},
  onSelectSpy = () => {},
  onClearSpy = () => {},
  initial = null,
}: {
  allowCustom?: boolean;
  onSubmit?: () => void;
  onSelectSpy?: (l: SampleLocation) => void;
  onClearSpy?: () => void;
  initial?: SampleLocation | null;
}) {
  const [query, setQuery] = useState(initial ? initial.label : "");
  const [selected, setSelected] = useState<SampleLocation | null>(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <LocationPicker
        query={query}
        onQueryChange={setQuery}
        selected={selected}
        onSelect={(location) => {
          onSelectSpy(location);
          setSelected(location);
        }}
        onClear={() => {
          onClearSpy();
          setSelected(null);
        }}
        allowCustom={allowCustom}
      />
    </form>
  );
}

const box = () => screen.getByRole("combobox", { name: "Destination search" });
const list = () => screen.getByRole("listbox", { hidden: true });
const announce = () => screen.getByRole("status", { name: "Destination results" });

describe("LocationPicker", () => {
  it("is a labelled combobox, collapsed and invalid until something is confirmed", () => {
    render(<Harness />);
    expect(box().getAttribute("aria-autocomplete")).toBe("list");
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(box().getAttribute("aria-controls")).toBe(list().id);
    expect(list().hidden).toBe(true);
    expect(screen.getByText(/Free text alone is never a confirmed location/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sample/i);
    expect(announce().textContent).toBe("");
    expect(ALLOW_CUSTOM_DESTINATION).toBe(false);
  });

  it("lists matches with city, region and country, so the two Londons are told apart", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    expect(box().getAttribute("aria-expanded")).toBe("true");
    const options = within(list()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "LondonEngland, United Kingdom",
      "LondonOntario, Canada",
    ]);
    expect(announce().textContent).toBe("2 destinations found");
  });

  it("announces a single result in the singular, and no matches plainly", async () => {
    render(<Harness />);
    await userEvent.type(box(), "lisbon");
    expect(announce().textContent).toBe("1 destination found");
    await userEvent.clear(box());
    await userEvent.type(box(), "zzzz");
    expect(announce().textContent).toBe("No matches");
    expect(screen.getByText("No matches. Try a city name.")).toBeTruthy();
    expect(list().hidden).toBe(true);
    expect(screen.queryByText(/as typed/)).toBeNull();
  });

  it("moves through options with the arrow keys (wrapping) and exposes the active one", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    const [first, second] = within(list()).getAllByRole("option");
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(second.id);
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(first.id);
    await userEvent.keyboard("{ArrowUp}");
    expect(box().getAttribute("aria-activedescendant")).toBe(second.id);
  });

  it("Enter picks the highlighted option; with nothing highlighted it picks nothing and never submits the form", async () => {
    const onSubmit = vi.fn();
    const onSelectSpy = vi.fn();
    render(<Harness onSubmit={onSubmit} onSelectSpy={onSelectSpy} />);
    await userEvent.type(box(), "london");
    await userEvent.keyboard("{Enter}");
    expect(onSelectSpy).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelectSpy).toHaveBeenCalledWith(locationById("ca-on-london"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
  });

  it("Escape closes the list, and typing opens it again", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
    expect(list().hidden).toBe(true);
    await userEvent.type(box(), "{Backspace}n");
    expect(box().getAttribute("aria-expanded")).toBe("true");
  });

  it("arrow keys reopen a closed list; ignored with no options or other keys", async () => {
    render(<Harness />);
    await userEvent.keyboard("{Tab}{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
    await userEvent.type(box(), "london");
    await userEvent.keyboard("{Escape}{ArrowDown}");
    expect(box().getAttribute("aria-expanded")).toBe("true");
    // A second Escape on an already-closed list, and unrelated keys, change nothing.
    await userEvent.keyboard("{Escape}{Escape}{Home}");
    expect(box().getAttribute("aria-expanded")).toBe("false");
  });

  it("picking with the mouse confirms the destination", async () => {
    const onSelectSpy = vi.fn();
    render(<Harness onSelectSpy={onSelectSpy} />);
    await userEvent.type(box(), "lisbon");
    await userEvent.click(within(list()).getByRole("option", { name: /Lisbon/ }));
    expect(onSelectSpy).toHaveBeenCalledWith(locationById("pt-lisbon"));
    const confirmed = screen.getByRole("status", { name: "" });
    expect(confirmed.textContent).toContain("Destination confirmed");
    expect(confirmed.textContent).toContain("Lisbon · Lisbon District · Portugal");
    expect(box().getAttribute("aria-invalid")).toBe("false");
    expect(list().hidden).toBe(true);
  });

  it("Change clears the confirmation and returns focus to the search box", async () => {
    const onClearSpy = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onClearSpy={onClearSpy} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onClearSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it("editing the text after confirming clears the confirmation", async () => {
    const onClearSpy = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onClearSpy={onClearSpy} />);
    await userEvent.type(box(), "x");
    expect(onClearSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Destination confirmed")).toBeNull();
  });

  it("ignores navigation keys while a destination is confirmed", async () => {
    const onSubmit = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onSubmit={onSubmit} />);
    box().focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(announce().textContent).toBe("");
  });

  describe("Custom destination row (flag, off by default)", () => {
    it("is not offered by default", async () => {
      render(<Harness />);
      await userEvent.type(box(), "Grandma's cabin");
      expect(screen.queryByText(/as typed/)).toBeNull();
    });

    it("when enabled, appears only when nothing matches, tagged Custom, and must be picked explicitly", async () => {
      const onSelectSpy = vi.fn();
      render(<Harness allowCustom onSelectSpy={onSelectSpy} />);
      await userEvent.type(box(), "Grandma's cabin");
      const row = within(list()).getByRole("option");
      expect(row.textContent).toContain("Use “Grandma's cabin” as typed");
      expect(row.textContent).toContain("Custom");
      expect(onSelectSpy).not.toHaveBeenCalled();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(onSelectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "custom", city: "Grandma's cabin" }),
      );
      expect(screen.getByRole("status", { name: "" }).textContent).toContain(
        "Grandma's cabin · Custom",
      );
    });

    it("is not offered when the list has matches", async () => {
      render(<Harness allowCustom />);
      await userEvent.type(box(), "paris");
      expect(screen.queryByText(/as typed/)).toBeNull();
    });
  });
});
