// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stamps } from "./Stamp";

describe("Stamps", () => {
  it("is one image named for the route, with the stamp text hidden from assistive tech", () => {
    const { container } = render(
      <Stamps
        stamps={[
          { kind: "country", label: "PRT", fullName: "PRT" },
          { kind: "country", label: "ESP", fullName: "ESP" },
        ]}
        departure="2026-11-03"
      />,
    );
    expect(screen.getByRole("img", { name: "PRT, ESP route stamps" })).toBeTruthy();
    const stamps = container.querySelectorAll('[aria-hidden="true"]');
    expect(stamps).toHaveLength(2);
    expect(stamps[0].textContent).toBe("PRT03 NOV2026");
    expect(stamps[1].textContent).toBe("ESP03 NOV2026");
  });

  it("names a city stamp as a departure and uses the full name", () => {
    render(
      <Stamps
        stamps={[{ kind: "city", label: "JOHANNESB…", fullName: "JOHANNESBURG" }]}
        departure="2026-01-09"
      />,
    );
    const stamp = screen.getByRole("img", { name: "JOHANNESBURG departure stamp" });
    expect(stamp.querySelector("[data-size]")?.getAttribute("data-size")).toBe("small");
  });

  it("shows at most two stamps", () => {
    const spec = (label: string) => ({ kind: "country" as const, label, fullName: label });
    const { container } = render(
      <Stamps stamps={[spec("PRT"), spec("ESP"), spec("FRA")]} departure="2026-11-03" />,
    );
    expect(container.querySelectorAll("[data-size]")).toHaveLength(2);
  });

  it("tolerates a malformed departure without throwing", () => {
    render(<Stamps stamps={[{ kind: "city", label: "OSLO", fullName: "OSLO" }]} departure="" />);
    expect(screen.getByRole("img", { name: "OSLO departure stamp" })).toBeTruthy();
  });

  it("marks an airport stamp with a plane before the year and names it an airport", () => {
    const { container } = render(
      <Stamps
        stamps={[{ kind: "airport", label: "FRA", fullName: "FRANKFURT", cityName: "Frankfurt" }]}
        departure="2026-11-03"
      />,
    );
    const stamp = screen.getByRole("img", { name: "FRA airport, Frankfurt, departure stamp" });
    expect(stamp.querySelector("[data-size]")?.getAttribute("data-size")).toBe("large");
    const year = [...container.querySelectorAll("span")].find(
      (node) => node.textContent === "✈ 2026" && node.children.length === 1,
    ) as HTMLElement;
    expect(year.textContent).toBe("✈ 2026");
    expect(year.querySelector('[aria-hidden="true"]')?.textContent).toBe("✈ ");
  });

  it("shows a country stamp's year with no plane", () => {
    const { container } = render(
      <Stamps
        stamps={[{ kind: "country", label: "FRA", fullName: "FRA" }]}
        departure="2026-11-03"
      />,
    );
    expect(container.textContent).not.toContain("✈");
  });
});
