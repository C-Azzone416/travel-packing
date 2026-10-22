// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./MoreMenu";

function setup(props: Partial<React.ComponentProps<typeof MoreMenu>> = {}) {
  const quick = vi.fn();
  const archive = vi.fn();
  const remove = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <button type="button">before</button>
      <MoreMenu
        subject="San Diego"
        items={[
          { key: "quick", label: "Quick view", onSelect: quick },
          { key: "copy", label: "Copy trip", href: "/trips/new?copy=x" },
          { key: "archive", label: "Archive", onSelect: archive },
          { key: "remove", label: "Remove", danger: true, onSelect: remove },
        ]}
        {...props}
      />
      <button type="button">after</button>
    </>,
  );
  return { user, quick, archive, remove };
}

const button = () => screen.getByRole("button", { name: "More actions for San Diego" });
const items = () => screen.getAllByRole("menuitem");

describe("MoreMenu", () => {
  it("is a named disclosure button that opens a named menu, in the order given, Remove after a divider", async () => {
    const { user } = setup();
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Actions for San Diego" });
    expect(button().getAttribute("aria-controls")).toBe(menu.id);
    expect(items().map((item) => item.textContent)).toEqual([
      "Quick view",
      "Copy trip",
      "Archive",
      "Remove",
    ]);
    const children = [...menu.children].map((node) => node.getAttribute("role"));
    expect(children).toEqual(["menuitem", "menuitem", "menuitem", "separator", "menuitem"]);
    expect(items()[3].className).toContain("danger");
    expect(items()[1].getAttribute("href")).toBe("/trips/new?copy=x");
  });

  it("opens on the first item with Enter, Space or ArrowDown, and on the last with ArrowUp", async () => {
    const { user } = setup();
    for (const key of ["{Enter}", " ", "{ArrowDown}"]) {
      button().focus();
      await user.keyboard(key);
      await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
      await user.keyboard("{Escape}");
    }
    button().focus();
    await user.keyboard("{ArrowUp}");
    await vi.waitFor(() => expect(document.activeElement).toBe(items()[3]));
  });

  it("moves with the arrow keys (wrapping) and jumps with Home and End", async () => {
    const { user } = setup();
    button().focus();
    await user.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(items()[2]);
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(items()[3]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items()[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(items()[3]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("Escape closes it and returns focus to the button; Tab closes it and moves on", async () => {
    const { user } = setup();
    await user.click(button());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button());
    await user.click(button());
    await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
    // Tab straight from the button (before focus has moved into the menu) closes it too.
    button().focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a click outside closes it", async () => {
    const { user } = setup();
    await user.click(button());
    await user.click(screen.getByRole("button", { name: "after" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("choosing an item closes the menu, puts focus on the button, then acts", async () => {
    const { user, archive, remove, quick } = setup();
    await user.click(button());
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(archive).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button());
    await user.click(button());
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(remove).toHaveBeenCalledOnce();
    await user.click(button());
    await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
    await user.keyboard("{Enter}");
    expect(quick).toHaveBeenCalledOnce();
  });

  it("closes when its own button is clicked again, and a link item just closes it", async () => {
    const { user } = setup();
    await user.click(button());
    await user.click(button());
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button());
    await user.click(screen.getByRole("menuitem", { name: "Copy trip" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("can be disabled while a save is in flight", async () => {
    setup({ disabled: true });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no divider when there is no danger item", async () => {
    const { user } = setup({ items: [{ key: "quick", label: "Quick view", onSelect: () => {} }] });
    await user.click(button());
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
