// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is named by its label and described by its description", () => {
    render(
      <Switch label="Laundry" description="Fewer clothes." checked={false} onChange={() => {}} />,
    );
    const input = screen.getByRole("switch", { name: "Laundry" });
    expect(
      document.getElementById(input.getAttribute("aria-describedby") as string)?.textContent,
    ).toBe("Fewer clothes.");
  });

  it("is also described by another element when it is given (why it is disabled), after its own description", () => {
    render(
      <>
        <p id="why">Turn on Nice outfits first.</p>
        <Switch
          label="Reuse"
          description="Repeat."
          checked
          disabled
          describedBy="why"
          onChange={() => {}}
        />
        <Switch label="Bare" checked={false} disabled describedBy="why" onChange={() => {}} />
        <Switch label="Plain" checked={false} onChange={() => {}} />
      </>,
    );
    const reuse = screen.getByRole("switch", { name: "Reuse" });
    const own = reuse.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(own).toHaveLength(2);
    expect(own[1]).toBe("why");
    expect(document.getElementById(own[0])?.textContent).toBe("Repeat.");
    expect(screen.getByRole("switch", { name: "Bare" }).getAttribute("aria-describedby")).toBe(
      "why",
    );
    expect(
      screen.getByRole("switch", { name: "Plain" }).getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
