// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeedbackReportHost as StubHost,
  FeedbackTabItem as StubTabItem,
  useFeedbackTab as useStubTab,
} from "@/features/feedback/feedback.disabled";
import { AppShell } from "./AppShell";
import { Nav } from "./Nav";
import { NAV_ITEMS } from "./nav-items";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const tab = vi.hoisted(() => ({
  state: { enabled: false, disabled: false, open: vi.fn() },
}));
vi.mock("@/features/feedback/FeedbackAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/feedback/FeedbackAccess")>()),
  useFeedbackTab: () => tab.state,
}));

beforeEach(() => {
  pathname = "/";
  tab.state = { enabled: false, disabled: false, open: vi.fn() };
});

const signOut = async () => undefined;
const email = "owner@example.test";

describe("nav items and icons (#300)", () => {
  it("has four entries (Stamps is the laptop-only one, with no icon), and no font glyph is left in the shell", () => {
    expect(NAV_ITEMS.map((item) => item.icon)).toEqual(["trips", "staples", undefined, "settings"]);
    expect(NAV_ITEMS.filter((item) => item.laptopOnly).map((item) => item.label)).toEqual([
      "Stamps",
    ]);
    const dir = join(process.cwd(), "src/components/shell");
    for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name))) {
      if (file.endsWith(".test.tsx")) continue;
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/[⌂◇⚙]/u);
    }
  });

  it("every icon is the same decorative 24px outline svg, sized by CSS", () => {
    tab.state = { enabled: true, disabled: false, open: vi.fn() };
    render(<Nav signOut={signOut} email={email} />);
    const icons = document.querySelectorAll("nav svg");
    // Trips, Staples, Settings, Feedback, and the laptop-only Sign out (Stamps has no icon).
    expect(icons).toHaveLength(5);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
      expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon.getAttribute("stroke-width")).toBe("2");
      expect(icon.getAttribute("fill")).toBe("none");
      expect(icon.getAttribute("class")).toBe("nav-icon");
      expect(icon.hasAttribute("width")).toBe(false);
      expect(icon.hasAttribute("height")).toBe(false);
    }
  });

  it("the link names are Trips, Staples, Stamps and Settings, in that order", () => {
    render(<Nav />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Trips",
      "Staples",
      "Stamps",
      "Settings",
    ]);
    // Only Stamps is left off the phone tab bar.
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.classList.contains("nav-laptop-only"))
        .map((link) => link.textContent),
    ).toEqual(["Stamps"]);
  });
});

describe("the 4th slot with Feedback on (#293)", () => {
  it("is a Feedback button after the links; Sign out is only the wide-screen copy", async () => {
    const open = vi.fn();
    tab.state = { enabled: true, disabled: false, open };
    render(<Nav signOut={signOut} email={email} />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const feedback = within(nav).getByRole("button", { name: "Send feedback report" });
    expect(feedback.className).toBe("nav-feedback");
    expect(feedback.getAttribute("aria-current")).toBeNull();
    expect(feedback.getAttribute("aria-haspopup")).toBeNull();
    expect(feedback).toHaveProperty("disabled", false);
    // The two labels: one is hidden from assistive tech, so nothing is read twice.
    expect(feedback.querySelector(".nav-label-long")?.textContent).toBe("Feedback");
    const short = feedback.querySelector(".nav-label-short");
    expect(short?.textContent).toBe("Report");
    expect(short?.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(feedback);
    expect(open).toHaveBeenCalledTimes(1);
    // DOM order: the four links, Feedback, then the copy of Sign out that only shows from 1024px.
    expect(
      [...nav.children].map(
        (child) =>
          child.tagName + (child.className.includes("nav-link") ? ".link" : "." + child.className),
      ),
    ).toEqual([
      "A.link",
      "A.link",
      "A.link",
      "A.link",
      "BUTTON.nav-feedback",
      "FORM.nav-signout nav-signout-wide",
    ]);
  });

  it("follows tab.disabled and keeps its place", () => {
    tab.state = { enabled: true, disabled: true, open: vi.fn() };
    render(<Nav signOut={signOut} email={email} />);
    expect(screen.getByRole("button", { name: "Send feedback report" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("is not offered to someone who is not signed in", () => {
    tab.state = { enabled: true, disabled: false, open: vi.fn() };
    render(<Nav />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelectorAll("nav svg.nav-icon")).toHaveLength(3);
    expect(document.querySelectorAll("nav a")).toHaveLength(4);
  });
});

describe("the 4th slot with Feedback off (production)", () => {
  it("is Sign out, in the same place, with no Feedback markup", () => {
    render(<Nav signOut={signOut} email={email} />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      [...nav.children].map(
        (child) =>
          child.tagName + (child.className.includes("nav-link") ? ".link" : "." + child.className),
      ),
    ).toEqual(["A.link", "A.link", "A.link", "A.link", "FORM.nav-signout"]);
    expect(screen.getByRole("button", { name: "Sign out" }).getAttribute("title")).toBe(
      `Signed in as ${email}`,
    );
    expect(nav.querySelector(".nav-feedback, .nav-label-short")).toBeNull();
    // The same new outline icons in all four slots (the old Sign out drew its own 18px svg).
    expect(nav.querySelectorAll("svg.nav-icon")).toHaveLength(4);
    expect(nav.querySelector("form svg")?.hasAttribute("width")).toBe(false);
    expect(nav.textContent).not.toMatch(/Feedback|Report/);
  });
});

describe("the shell", () => {
  it("has no Feedback button in the header (it lives in the tab bar), and mounts the report host once", () => {
    tab.state = { enabled: true, disabled: false, open: vi.fn() };
    render(
      <AppShell signOut={signOut} email={email}>
        x
      </AppShell>,
    );
    const banner = screen.getByRole("banner");
    expect(banner.querySelector(".feedback-button")).toBeNull();
    // The tab bar's item is inside the header (the nav is), the old "Send feedback" button is not.
    expect(within(banner).queryByRole("button", { name: "Send feedback" })).toBeNull();
    expect(within(banner).getAllByRole("button", { name: "Send feedback report" })).toHaveLength(1);
    expect(banner.querySelector(".topbar-end")?.querySelector("button")).toBeNull();
  });
});

describe("the hosted-build stubs", () => {
  it("the Feedback tab is always off, inert, and renders nothing", () => {
    expect(useStubTab()).toMatchObject({ enabled: false, disabled: true });
    expect(useStubTab().open()).toBeUndefined();
    expect(StubHost()).toBeNull();
    expect(StubTabItem({ disabled: false, onOpen: () => undefined })).toBeNull();
  });
});
