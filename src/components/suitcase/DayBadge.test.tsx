// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DayBadge } from "./DayBadge";

describe("DayBadge", () => {
  it("says Day N of M in words", () => {
    render(<DayBadge day={3} of={11} />);
    const badge = screen.getByText(/^Day/);
    expect(badge.textContent).toBe("Day 3 of 11");
    expect(badge.getAttribute("data-day-badge")).toBe("day");
  });

  it("says Last day, not a number, on the end date", () => {
    render(<DayBadge day={11} of={11} last className="extra" />);
    const badge = screen.getByText("Last day");
    expect(badge.getAttribute("data-day-badge")).toBe("last");
    expect(badge.className).toContain("extra");
  });
});
