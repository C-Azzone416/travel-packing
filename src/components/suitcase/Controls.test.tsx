// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Icon, ICON_SHAPES } from "@/components/ui/Icon";
import { Chip } from "./Chip";
import { LaundryMarker, MorningOfMarker } from "./Markers";
import { NavPill, Pill, PillGroup, PillTabs, type PillTabItem } from "./Pill";
import { Stepper } from "./Stepper";

const css = (file: string) =>
  readFileSync(join(process.cwd(), "src/components/suitcase", file), "utf8");

describe("Icon", () => {
  it("draws every registry shape on the 24px outline grid, hidden from assistive tech", () => {
    for (const name of Object.keys(ICON_SHAPES) as Array<keyof typeof ICON_SHAPES>) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg") as SVGElement;
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("stroke-width")).toBe("2");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("data-icon")).toBe(name);
      unmount();
    }
  });

  it("takes a size and a class", () => {
    const { container } = render(<Icon name="sun" size={22} className="x" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("22");
    expect(svg.getAttribute("height")).toBe("22");
    expect(svg.getAttribute("class")).toBe("x");
  });

  it("has the icons the spec lists", () => {
    for (const name of [
      "sun",
      "cloud",
      "rain",
      "umbrella",
      "refresh",
      "check",
      "plus",
      "minus",
      "pencil",
    ])
      expect(name in ICON_SHAPES).toBe(true);
  });
});

describe("Pill", () => {
  it("is a button, pressed when active, and a count is part of its name", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Pill count={5} onClick={onClick}>
        To pack
      </Pill>,
    );
    const pill = screen.getByRole("button", { name: "To pack 5" });
    expect(pill.getAttribute("type")).toBe("button");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <Pill count={5} active>
        To pack
      </Pill>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button").className).toContain("active");
  });

  it("omits the count when there is none, and a count of 0 still shows", () => {
    const { rerender } = render(<Pill>All</Pill>);
    expect(screen.getByRole("button").textContent).toBe("All");
    rerender(<Pill count={0}>Packed</Pill>);
    expect(screen.getByRole("button").textContent).toBe("Packed 0");
  });

  it("the stamps size is taller, and the icon-only pill keeps its name", () => {
    const { rerender } = render(<Pill size="stamps">Last 12 months</Pill>);
    expect(screen.getByRole("button").className).toContain("stamps");
    rerender(
      <Pill icon="pencil" iconOnlyOnPhone>
        Edit list
      </Pill>,
    );
    const pill = screen.getByRole("button", { name: "Edit list" });
    expect(pill.querySelector("[data-icon='pencil']")).toBeTruthy();
    expect(pill.className).toContain("iconOnly");
  });

  it("keeps the spec sizes (36 / 34, stamps 40 / 38) and a 44px tap area on a phone", () => {
    const text = css("Pill.module.css");
    expect(text).toMatch(/\.pill \{[^}]*--hit-pad: 5px[^}]*height: 34px[^}]*padding: 0 14px/);
    expect(text).toMatch(/\.pill \{\s*height: 36px;\s*padding: 0 16px/);
    expect(text).toMatch(/\.stamps \{[^}]*height: 38px[^}]*padding: 0 22px/);
    expect(text).toMatch(/\.stamps \{\s*height: 40px/);
    expect(text).toMatch(/\.active \{[^}]*background: var\(--dark\)[^}]*color: var\(--onDark\)/);
    expect(css("shared.module.css")).toMatch(/inset: calc\(-1 \* var\(--hit-pad, 0px\)\) 0/);
  });
});

describe("PillGroup and NavPill", () => {
  it("names the group", () => {
    render(
      <PillGroup label="Filter">
        <Pill>All</Pill>
      </PillGroup>,
    );
    expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
  });

  it("the nav pill is a link, current when active", () => {
    const { rerender } = render(<NavPill href="/stamps">Stamps</NavPill>);
    const link = screen.getByRole("link", { name: "Stamps" });
    expect(link.getAttribute("href")).toBe("/stamps");
    expect(link.getAttribute("aria-current")).toBeNull();
    rerender(
      <NavPill href="/stamps" active>
        Stamps
      </NavPill>,
    );
    expect(screen.getByRole("link").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link").className).toContain("navActive");
    expect(css("Pill.module.css")).toMatch(/\.nav \{[^}]*height: 40px[^}]*padding: 0 16px/);
  });
});

const TABS: PillTabItem[] = [
  { id: "pack", label: "Pack", sub: "41/60" },
  { id: "weather", label: "Weather", sub: "ALERT", alert: true },
  { id: "future", label: "Future", sub: "2 trips" },
  { id: "stamps", label: "Stamps", sub: "6" },
];

function Tabs({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState("pack");
  return (
    <PillTabs
      label="Home sections"
      items={TABS}
      value={value}
      idBase="home"
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

describe("PillTabs (Home four-pill row)", () => {
  it("is a tab list of four tabs with a sub-label, one selected and one in the tab order", () => {
    render(<Tabs />);
    expect(screen.getByRole("tablist", { name: "Home sections" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Pack41/60",
      "WeatherALERT",
      "Future2 trips",
      "Stamps6",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    expect(tabs[1].id).toBe("home-tab-weather");
    expect(tabs[1].getAttribute("aria-controls")).toBe("home-panel-weather");
  });

  it("the ALERT sub-label is words in the accent colour, and gold on the active tab", () => {
    render(<Tabs />);
    const text = css("Pill.module.css");
    expect(screen.getByText("ALERT").className).toContain("tabAlert");
    expect(text).toMatch(/\.tabAlert \{[^}]*color: var\(--accent\)[^}]*letter-spacing: 0\.04em/);
    expect(text).toMatch(/\.tabActive \.tabAlert \{\s*color: var\(--gold\)/);
  });

  it("clicking selects", async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /Future/ }));
    expect(onChange).toHaveBeenCalledWith("future");
    expect(screen.getByRole("tab", { name: /Future/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("arrow keys move and select, wrapping at both ends; Home and End jump", async () => {
    render(<Tabs />);
    const [pack, weather] = screen.getAllByRole("tab");
    pack.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(weather);
    expect(weather.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Stamps/ }));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(pack);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Stamps/ }));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(pack);
  });

  it("other keys do nothing", async () => {
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} />);
    screen.getAllByRole("tab")[0].focus();
    await userEvent.keyboard("a{Enter}");
    expect(onChange).not.toHaveBeenCalledWith("weather");
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[0]);
  });

  it("falls back to a generated id base", () => {
    render(<PillTabs label="x" items={TABS} value="pack" onChange={() => undefined} />);
    expect(screen.getAllByRole("tab")[0].id).toMatch(/-tab-pack$/);
  });

  it("is four columns, two at 359px and below, with a 48px minimum height and 24px radius", () => {
    const text = css("Pill.module.css");
    expect(text).toMatch(
      /\.tabs \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)[^}]*gap: 8px/,
    );
    expect(text).toMatch(/max-width: 359px\) \{\s*\.tabs \{\s*grid-template-columns: repeat\(2/);
    expect(text).toMatch(/\.tab \{[^}]*min-height: 48px[^}]*border-radius: 24px/);
  });
});

describe("Chip", () => {
  it("is a button; a row chip has no pressed state", async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>per trip</Chip>);
    const chip = screen.getByRole("button", { name: "per trip" });
    expect(chip.getAttribute("aria-pressed")).toBeNull();
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("the scaled tone (per day, per night) is its own style, in words", () => {
    render(<Chip tone="scaled">per night</Chip>);
    expect(screen.getByRole("button").className).toContain("scaled");
    const text = css("Chip.module.css");
    expect(text).toMatch(
      /\.scaled \{[^}]*border-color: var\(--dark\)[^}]*border-width: 1\.5px[^}]*background: var\(--tint\)/,
    );
    expect(text).toMatch(/\.chip \{[^}]*height: 30px[^}]*padding: 0 14px/);
  });

  it("an editor chip reports its chosen state and is the larger size", () => {
    const { rerender } = render(
      <Chip size="editor" selected={false}>
        per day
      </Chip>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button").className).toContain("editor");
    rerender(
      <Chip size="editor" selected>
        per day
      </Chip>,
    );
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button").className).toContain("selected");
    const text = css("Chip.module.css");
    expect(text).toMatch(/\.editor \{[^}]*height: 37px[^}]*padding: 0 20px[^}]*font-size: 17px/);
    expect(text).toMatch(/\.selected \{[^}]*background: var\(--dark\)[^}]*color: var\(--onDark\)/);
  });
});

describe("Stepper", () => {
  function Controlled({ start = 3, ...rest }: { start?: number; min?: number; max?: number }) {
    const [value, setValue] = useState(start);
    return <Stepper value={value} onChange={setValue} {...rest} />;
  }

  it("steps up and down, named Fewer and More, inside a Quantity group", async () => {
    render(<Controlled />);
    expect(screen.getByRole("group", { name: "Quantity" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("3");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("status").textContent).toBe("4");
    await userEvent.click(screen.getByRole("button", { name: "Fewer" }));
    await userEvent.click(screen.getByRole("button", { name: "Fewer" }));
    expect(screen.getByRole("status").textContent).toBe("2");
  });

  it("stops at 1 and 99 by default and disables the button at the end", async () => {
    const { unmount } = render(<Controlled start={1} />);
    expect((screen.getByRole("button", { name: "Fewer" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "More" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    unmount();
    render(<Controlled start={99} />);
    expect((screen.getByRole("button", { name: "More" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Fewer" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("honours its own bounds, clamping what it reports", async () => {
    const onChange = vi.fn();
    render(<Stepper value={5} min={4} max={6} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    await userEvent.click(screen.getByRole("button", { name: "Fewer" }));
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("takes a label and the sheet size", () => {
    render(
      <Stepper value={2} onChange={() => undefined} label="Underwear quantity" size="sheet" />,
    );
    expect(screen.getByRole("group", { name: "Underwear quantity" }).className).toContain("sheet");
  });

  it("keeps the spec sizes: sheet 103x40, laptop inline 77x31", () => {
    const text = css("Stepper.module.css");
    expect(text).toMatch(
      /\.stepper \{[^}]*width: 103px[^}]*height: 40px[^}]*border: 2px solid var\(--tint\)/,
    );
    expect(text).toMatch(/\.stepper:not\(\.sheet\) \{\s*width: 77px;\s*height: 31px/);
  });
});

describe("LaundryMarker", () => {
  it("is the refresh icon with words for assistive tech, and it is not text that a strike could cross", () => {
    const { container } = render(<LaundryMarker />);
    expect(container.querySelector("[data-icon='refresh']")?.getAttribute("width")).toBe("16");
    expect(screen.getByText("Fewer with laundry").className).toBe("sr-only");
    expect(
      container.querySelector("[data-laundry-marker]")?.getAttribute("data-laundry-marker"),
    ).toBe("row");
  });

  it("the Staples variant is a 22px tint circle with a 14px icon; on dark it is muted-on-dark", () => {
    const { container } = render(<LaundryMarker variant="staples" onDark />);
    expect(container.querySelector("[data-icon='refresh']")?.getAttribute("width")).toBe("14");
    const marker = container.querySelector("[data-laundry-marker]") as HTMLElement;
    expect(marker.className).toContain("staples");
    expect(marker.className).toContain("onDark");
    const text = css("Markers.module.css");
    expect(text).toMatch(
      /\.staples \{[^}]*width: 22px[^}]*height: 22px[^}]*background: var\(--tint\)/,
    );
    expect(text).toMatch(/\.onDark \{\s*color: var\(--onDarkMuted\)/);
    expect(text).toMatch(/\.laundry \{[^}]*color: var\(--muted\)/);
  });
});

describe("MorningOfMarker", () => {
  it("is plain text, no icon, and takes its colour from where it sits", () => {
    const { container } = render(<MorningOfMarker />);
    expect(container.textContent).toBe("Morning of");
    expect(container.querySelector("svg")).toBeNull();
    const text = css("Markers.module.css");
    expect(text).toMatch(/\.morning \{[^}]*font-weight: 600[^}]*color: inherit/);
  });
});
