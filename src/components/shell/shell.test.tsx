// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { Nav } from "./Nav";
import { isActive, NAV_ITEMS } from "./nav-items";
import { PreviewBanner } from "./PreviewBanner";
import { RouteFocus } from "./RouteFocus";
import { SaveChip } from "./SaveChip";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = "/";
});

describe("nav items", () => {
  it("has exactly Trips, Staples and Settings", () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ["Trips", "/"],
      ["Staples", "/staples"],
      ["Settings", "/settings"],
    ]);
  });

  it.each([
    ["/", "Trips"],
    ["/trips/abc", "Trips"],
    ["/staples", "Staples"],
    ["/staples/new", "Staples"],
    ["/settings", "Settings"],
    ["/stapleshop", undefined],
    ["/elsewhere", undefined],
  ])("%s activates %s", (path, expected) => {
    const active = NAV_ITEMS.filter((item) => isActive(item, path)).map((i) => i.label);
    expect(active).toEqual(expected ? [expected] : []);
  });
});

describe("Nav", () => {
  it("is a labelled landmark with three links and marks the current page", () => {
    pathname = "/staples";
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav.querySelectorAll("a")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Staples/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Trips/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: /Settings/ }).getAttribute("href")).toBe("/settings");
  });

  it("hides decorative glyphs from assistive tech", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Trips" })).toBeTruthy();
  });
});

describe("Nav Sign out (#117)", () => {
  it("adds a fourth item after the links: a button named Sign out, with the address only as its tooltip", async () => {
    const signOut = vi.fn(async () => undefined);
    render(<Nav signOut={signOut} email="owner@example.test" />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav.querySelectorAll("a")).toHaveLength(3);
    const button = screen.getByRole("button", { name: "Sign out" });
    // Last in the nav, so the links come first in the tab order.
    expect(nav.lastElementChild?.contains(button)).toBe(true);
    // WebKit's phone profile only includes the submit control in sequential keyboard navigation when it is explicit.
    expect(button.getAttribute("tabindex")).toBe("0");
    expect(button.getAttribute("title")).toBe("Signed in as owner@example.test");
    expect(button.getAttribute("aria-current")).toBeNull();
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // No visible address: the rail is too narrow for one.
    expect(nav.textContent).not.toContain("owner@example.test");
    // One tap, no confirm.
    await userEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is absent without the action or without a signed-in address", () => {
    const { rerender } = render(<Nav />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    rerender(<Nav signOut={async () => undefined} email={null} />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    rerender(<Nav email="owner@example.test" />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("the shell passes it through to the nav", () => {
    render(
      <AppShell signOut={async () => undefined} email="owner@example.test">
        x
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("RouteFocus", () => {
  it("does not steal focus on the first render", () => {
    render(
      <>
        <button>Other</button>
        <main id="main" tabIndex={-1} />
        <RouteFocus />
      </>,
    );
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to main when the route changes", () => {
    const view = render(
      <>
        <main id="main" tabIndex={-1} />
        <RouteFocus />
      </>,
    );
    pathname = "/settings";
    view.rerender(
      <>
        <main id="main" tabIndex={-1} />
        <RouteFocus />
      </>,
    );
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("does nothing when there is no main element", () => {
    const view = render(<RouteFocus />);
    pathname = "/staples";
    expect(() => view.rerender(<RouteFocus />)).not.toThrow();
  });
});

describe("SaveChip", () => {
  it("renders nothing in the quiet idle state", () => {
    const { container } = render(<SaveChip />);
    expect(container.innerHTML).toBe("");
  });

  it("shows Saved as a link to Settings when confirming success", () => {
    render(<SaveChip status="saved" />);
    const chip = screen.getByRole("link", { name: "Saved" });
    expect(chip.getAttribute("href")).toBe("/settings");
    expect(chip.textContent).toContain("Saved");
    expect(chip.querySelector("[aria-hidden='true']")).toBeTruthy();
  });

  it("shows Saving… as a link to Settings", () => {
    render(<SaveChip status="saving" />);
    const chip = screen.getByRole("link", { name: "Saving" });
    expect(chip.textContent).toContain("Saving…");
    expect(chip.className).toContain("saving");
  });

  it("shows the error as a button that opens the retry sheet, not a link", async () => {
    const onRetry = vi.fn();
    render(<SaveChip status="error" onOpenError={onRetry} />);
    const chip = screen.getByRole("button", { name: "Not saved, retry" });
    expect(chip.textContent).toContain("Not saved · Retry");
    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.click(chip);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("PreviewBanner", () => {
  it("shows the preview note on preview builds", () => {
    render(<PreviewBanner env="preview" />);
    expect(screen.getByRole("note").textContent).toBe("Preview · synthetic data");
  });

  it.each(["production", "development", undefined])("shows nothing for %s", (env) => {
    const { container } = render(<PreviewBanner env={env} />);
    expect(container.innerHTML).toBe("");
  });

  it("reads VERCEL_ENV on the server by default", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(renderToStaticMarkup(<PreviewBanner />)).toContain("Preview · synthetic data");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(renderToStaticMarkup(<PreviewBanner />)).toBe("");
    vi.unstubAllEnvs();
  });
});

describe("AppShell", () => {
  it("puts the skip link first, then one banner holding the brand and primary navigation, then main", () => {
    render(
      <AppShell>
        <h1>Trips</h1>
      </AppShell>,
    );
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip.getAttribute("href")).toBe("#main");
    const focusables = [...document.querySelectorAll<HTMLElement>("a, button")];
    expect(focusables[0]).toBe(skip);
    const main = screen.getByRole("main");
    expect(main.id).toBe("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(main.textContent).toBe("Trips");
    const banner = screen.getByRole("banner");
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(banner.contains(nav)).toBe(true);
    // Brand and navigation are before main; idle does not add a meaningless status control.
    const inBar = [...banner.querySelectorAll<HTMLElement>("a, button")];
    expect(inBar[0].getAttribute("aria-label")).toBe("Packed Smart: go to trips");
    expect(inBar.slice(1, 4).map((node) => node.textContent?.trim())).toEqual([
      expect.stringContaining("Trips"),
      expect.stringContaining("Staples"),
      expect.stringContaining("Settings"),
    ]);
    expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.textContent).not.toMatch(/packing companion/i);
  });

  it("brand link goes home and the save chip is quiet until a write happens", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole("link", { name: /go to trips/i }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
  });

  it("provides toasts to its children", () => {
    render(<AppShell>x</AppShell>);
    expect(document.querySelector(".toast-region")?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector(".error-region")?.getAttribute("aria-live")).toBe("assertive");
  });

  it("moves focus to main when the route changes", () => {
    const view = render(<AppShell>x</AppShell>);
    pathname = "/staples";
    act(() => view.rerender(<AppShell>x</AppShell>));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});
