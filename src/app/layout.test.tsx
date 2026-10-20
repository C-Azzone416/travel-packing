import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authScreen: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authScreen ? { "x-auth-screen": authScreen } : {}),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// Who is signed in, as the shell asks the auth runtime. "throws" plays an auth runtime that fails.
let session: { email: string } | null | "throws" = null;
const getSession = vi.fn(async () => {
  if (session === "throws") throw new Error("auth down");
  return session;
});
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({ provider: { getSession } }),
}));
vi.mock("@/app/sign-in/actions", () => ({ signOutAction: async () => undefined }));

import RootLayout from "./layout";

beforeEach(() => {
  authScreen = null;
  session = null;
  getSession.mockClear();
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

  it("puts Sign out in the nav for a signed-in person, with their address as its tooltip only", async () => {
    session = { email: "owner@example.test" };
    const html = await render();
    expect(html).toContain("Sign out");
    expect(html).toContain('title="Signed in as owner@example.test"');
  });

  it("has no Sign out item when nobody is signed in, or when the auth runtime fails, and the shell still renders", async () => {
    for (const value of [null, "throws" as const]) {
      session = value;
      const html = await render();
      expect(html).toContain("Primary navigation");
      expect(html).not.toContain("Sign out");
    }
  });

  it("does not ask who is signed in on the public auth screens", async () => {
    authScreen = "1";
    session = { email: "owner@example.test" };
    await render();
    expect(getSession).not.toHaveBeenCalled();
  });
});
