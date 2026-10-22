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

  it("Escape from a focused menu item closes the menu and returns focus to the button", async () => {
    const { user } = setup();
    await user.click(button());
    await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items()[1]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button());
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

describe("MoreMenu placement", () => {
  function place({ buttonTop, buttonBottom, tabBarTop, panelHeight }: Record<string, number>) {
    vi.stubGlobal("innerHeight", 844);
    const bar = document.createElement("nav");
    bar.className = "bottom-nav";
    bar.style.position = "fixed";
    bar.getBoundingClientRect = () => ({ top: tabBarTop }) as DOMRect;
    document.body.appendChild(bar);
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.getAttribute("aria-haspopup")
        ? ({ top: buttonTop, bottom: buttonBottom } as DOMRect)
        : rect.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.getAttribute("role") === "menu" ? panelHeight : 0;
      },
    });
    return () => {
      bar.remove();
      HTMLElement.prototype.getBoundingClientRect = rect;
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      vi.unstubAllGlobals();
    };
  }

  it("opens downward when the whole menu fits above the tab bar", async () => {
    const undo = place({ buttonTop: 100, buttonBottom: 144, tabBarTop: 788, panelHeight: 220 });
    const { user } = setup();
    await user.click(button());
    expect(screen.getByRole("menu").className).not.toContain("up");
    undo();
  });

  it("flips upward when the space below ends at the tab bar, not at the window edge", async () => {
    // 748 + 44 = 792 > tab bar top: the window edge (844) would have left room, the tab bar does not.
    const undo = place({ buttonTop: 704, buttonBottom: 748, tabBarTop: 788, panelHeight: 220 });
    const { user } = setup();
    await user.click(button());
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("up");
    expect(menu.style.maxHeight).toBe("696px");
    undo();
  });

  it("scrolls inside the available space when neither side fits", async () => {
    const undo = place({ buttonTop: 200, buttonBottom: 244, tabBarTop: 400, panelHeight: 500 });
    const { user } = setup();
    await user.click(button());
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("up");
    expect(menu.style.maxHeight).toBe("192px");
    undo();
  });
});
