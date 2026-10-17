import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authScreen: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authScreen ? { "x-auth-screen": authScreen } : {}),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import RootLayout from "./layout";

beforeEach(() => {
  authScreen = null;
});

const render = async () => renderToStaticMarkup(await RootLayout({ children: <p>page body</p> }));

describe("RootLayout", () => {
  it("wraps app pages in the shell (skip link, top bar, navigation)", async () => {
    const html = await render();
    expect(html).toContain("Skip to main content");
    expect(html).toContain("Primary navigation");
    expect(html).toContain("page body");
  });

  it("renders the public auth screens on their own: no top bar, no navigation", async () => {
    authScreen = "1";
    const html = await render();
    expect(html).toContain("page body");
    expect(html).not.toContain("Skip to main content");
    expect(html).not.toContain("Primary navigation");
    expect(html).not.toContain("Carrywell");
  });

  it.each(["0", "true", "yes"])(
    "only the exact marker '1' hides the shell (got %s)",
    async (value) => {
      authScreen = value;
      expect(await render()).toContain("Primary navigation");
    },
  );
});
