// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stamps } from "./Stamp";

describe("Stamps", () => {
  it("is one image named for the route, with the stamp text hidden from assistive tech", () => {
    const { container } = render(
      <Stamps
        stamps={[
          { kind: "country", label: "PRT" },
          { kind: "country", label: "ESP" },
        ]}
        departure="2026-11-03"
      />,
    );
    expect(screen.getByRole("img", { name: "PRT, ESP route stamps" })).toBeTruthy();
    const stamps = container.querySelectorAll("[data-stamp]");
    expect(stamps).toHaveLength(2);
    expect(stamps[0].getAttribute("aria-hidden")).toBe("true");
    expect(stamps[0].textContent).toBe("PRT03 NOV2026");
    expect(stamps[1].textContent).toBe("ESP03 NOV2026");
  });

  it("a place stamp (no airport) renders like a country stamp and names the city", () => {
    const { container } = render(
      <Stamps
        stamps={[{ kind: "place", label: "CHE", cityName: "Zermatt" }]}
        departure="2026-01-09"
      />,
    );
    expect(screen.getByRole("img", { name: "CHE, Zermatt, departure stamp" })).toBeTruthy();
    expect(container.textContent).toBe("CHE09 JAN2026");
    expect(container.textContent).not.toContain("✈");
  });

  it("shows at most two stamps", () => {
    const spec = (label: string) => ({ kind: "country" as const, label });
    const { container } = render(
      <Stamps stamps={[spec("PRT"), spec("ESP"), spec("FRA")]} departure="2026-11-03" />,
    );
    expect(container.querySelectorAll("[data-stamp]")).toHaveLength(2);
  });

  it("renders nothing for no stamps", () => {
    const { container } = render(<Stamps stamps={[]} departure="2026-11-03" />);
    expect(container.firstChild).toBeNull();
  });

  it("tolerates a malformed departure without throwing", () => {
    render(<Stamps stamps={[{ kind: "place", label: "NOR", cityName: "Oslo" }]} departure="" />);
    expect(screen.getByRole("img", { name: "NOR, Oslo, departure stamp" })).toBeTruthy();
  });

  it("marks an airport stamp with a plane before the year and names it an airport", () => {
    const { container } = render(
      <Stamps
        stamps={[{ kind: "airport", label: "FRA", cityName: "Frankfurt" }]}
        departure="2026-11-03"
      />,
    );
    expect(
      screen.getByRole("img", { name: "FRA airport, Frankfurt, departure stamp" }),
    ).toBeTruthy();
    const year = [...container.querySelectorAll("span")].find(
      (node) => node.textContent === "✈ 2026" && node.children.length === 1,
    ) as HTMLElement;
    expect(year.querySelector('[aria-hidden="true"]')?.textContent).toBe("✈ ");
  });

  it("has no backing disc by default, and adds one on every stamp only when it sits on a picture", () => {
    const two = [
      { kind: "country" as const, label: "PRT" },
      { kind: "country" as const, label: "ESP" },
    ];
    const clean = render(<Stamps stamps={two} departure="2026-11-03" />);
    expect(clean.container.querySelectorAll("[data-on-picture]")).toHaveLength(0);
    clean.unmount();
    const onPicture = render(<Stamps stamps={two} departure="2026-11-03" onPicture />);
    expect(onPicture.container.querySelectorAll('[data-on-picture="true"]')).toHaveLength(2);
  });
});

describe("the stamp stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src/components/stamp/Stamp.module.css"), "utf8");
  const rule = (selector: string) =>
    css.match(new RegExp(`(?:^|\\n)\\${selector} \\{([^}]*)\\}`))?.[1] ?? "";

  it("leaves the stamp transparent so the ledger rules show through, and puts the disc on the picture modifier only", () => {
    expect(rule(".stamp")).toMatch(/border-radius/);
    expect(rule(".stamp")).not.toMatch(/background/);
    expect(rule(".first")).not.toMatch(/background/);
    expect(rule(".second")).not.toMatch(/background/);
    expect(rule(".onPicture")).toMatch(
      /background: color-mix\(in srgb, var\(--surface\) 92%, transparent\)/,
    );
  });
});
