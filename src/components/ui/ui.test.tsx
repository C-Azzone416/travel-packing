// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonClassName } from "./Button";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

describe("buttonClassName", () => {
  it.each([
    [undefined, "button"],
    [{ variant: "primary" as const }, "button"],
    [{ variant: "secondary" as const }, "button secondary"],
    [{ variant: "danger" as const, small: true }, "button danger small"],
    [{ variant: "ghost" as const, block: true }, "button ghost block"],
  ])("%j → %s", (style, expected) => {
    expect(buttonClassName(style)).toBe(expected);
  });
});

describe("Button", () => {
  it("defaults to type=button and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveProperty("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies variant classes plus a custom className, and allows type=submit", () => {
    render(
      <Button variant="danger" small block className="extra" type="submit">
        Remove
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Remove" });
    expect(button.className).toBe("button danger small block extra");
    expect(button).toHaveProperty("type", "submit");
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Nope" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("StatusBadge", () => {
  it("shows a glyph with the label for ready and remaining, none for draft", () => {
    const { container } = render(
      <>
        <StatusBadge status="ready">Ready</StatusBadge>
        <StatusBadge status="remaining">3 items left</StatusBadge>
        <StatusBadge status="draft">Draft</StatusBadge>
      </>,
    );
    const pills = container.querySelectorAll(".status-pill");
    expect([...pills].map((p) => p.className)).toEqual([
      "status-pill ready",
      "status-pill remaining",
      "status-pill draft",
    ]);
    expect(pills[0].querySelector("[aria-hidden='true']")?.textContent).toBe("✓");
    expect(pills[1].querySelector("[aria-hidden='true']")?.textContent).toBe("○");
    expect(pills[2].querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("3 items left")).toBeTruthy();
  });
});

describe("Card", () => {
  it("renders a div card by default and passes props through", () => {
    render(<Card data-testid="card">Body</Card>);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    expect(card.className).toBe("card");
  });

  it("supports padding, a custom element and extra classes", () => {
    render(
      <Card as="section" padded className="wide" aria-label="Panel">
        Body
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Panel" });
    expect(card.tagName).toBe("SECTION");
    expect(card.className).toBe("card padded wide");
  });
});
