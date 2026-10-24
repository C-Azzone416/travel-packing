import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authScreen: string | null = null;
let appearanceCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authScreen ? { "x-auth-screen": authScreen } : {}),
  cookies: async () => ({
    get: (name: string) =>
      name === "appearance" && appearanceCookie !== undefined
        ? { name, value: appearanceCookie }
        : undefined,
  }),
}));
vi.mock("./fonts", () => ({ fontClassNames: "font-body font-display font-serif" }));
let savedAppearance = "base";
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => ({}) }));
vi.mock("@/server/data/service", () => ({
  getAppearance: async () => ({ ok: true, data: savedAppearance }),
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
  appearanceCookie = undefined;
  savedAppearance = "base";
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
    expect(html).not.toContain("Packed Smart");
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

  it("sets data-appearance from the cookie before first paint; an unknown cookie is Base", async () => {
    appearanceCookie = "ocean";
    expect(await render()).toContain('data-appearance="ocean"');
    appearanceCookie = "neon";
    expect(await render()).toContain('data-appearance="base"');
  });

  it("with no cookie, uses the account's saved theme for a signed-in person and Base for everyone else", async () => {
    savedAppearance = "violet";
    session = { email: "owner@example.test" };
    expect(await render()).toContain('data-appearance="violet"');
    session = null;
    expect(await render()).toContain('data-appearance="base"');
  });

  it("themes the sign-in screens from the cookie too, and loads the three fonts", async () => {
    authScreen = "1";
    appearanceCookie = "terracotta";
    const html = await render();
    expect(html).toContain('data-appearance="terracotta"');
    expect(html).toContain("font-body font-display font-serif");
  });
});
