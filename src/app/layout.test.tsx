import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authScreen: string | null = null;
let appearanceCookie: string | undefined;
let anonymousCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authScreen ? { "x-auth-screen": authScreen } : {}),
  cookies: async () => ({
    get: (name: string) => {
      const value =
        name === "appearance"
          ? appearanceCookie
          : name === "anon-appearance"
            ? anonymousCookie
            : undefined;
      return value !== undefined ? { name, value } : undefined;
    },
  }),
}));
vi.mock("./fonts", () => ({ fontClassNames: "font-body font-display" }));
let savedAppearance = "ocean";
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

import RootLayout, { metadata } from "./layout";

beforeEach(() => {
  authScreen = null;
  appearanceCookie = undefined;
  anonymousCookie = undefined;
  savedAppearance = "ocean";
  session = null;
  getSession.mockClear();
});

const render = async () => renderToStaticMarkup(await RootLayout({ children: <p>page body</p> }));

describe("RootLayout metadata (#492)", () => {
  it("sets no metadata.icons or manifest, so the Next.js file conventions (icon.svg, favicon.ico, apple-icon.png) serve the icons", () => {
    expect(metadata).not.toHaveProperty("icons");
    expect(metadata).not.toHaveProperty("manifest");
  });
});

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

  it("signed in: the account mirror sets data-scheme before first paint; an unknown mirror is Ocean, an old id is mapped", async () => {
    session = { email: "owner@example.test" };
    appearanceCookie = "evergreen";
    expect(await render()).toContain('data-scheme="evergreen"');
    appearanceCookie = "neon";
    expect(await render()).toContain('data-scheme="ocean"');
    for (const [old, now] of [
      ["base", "ocean"],
      ["terracotta", "evergreen"],
      ["violet", "dusk"],
    ]) {
      appearanceCookie = old;
      expect(await render()).toContain(`data-scheme="${now}"`);
    }
  });

  it("signed out: the anonymous palette cookie themes the page; missing, unknown or newer-build values are Ocean", async () => {
    anonymousCookie = "dusk";
    expect(await render()).toContain('data-scheme="dusk"');
    for (const bad of [undefined, "neon", "DUSK", "dusk; x=1", "ocean-v2", ""]) {
      anonymousCookie = bad;
      expect(await render()).toContain('data-scheme="ocean"');
    }
  });

  it("signed out: an old anonymous cookie keeps its look under the new name", async () => {
    anonymousCookie = "violet";
    expect(await render()).toContain('data-scheme="dusk"');
    anonymousCookie = "terracotta";
    expect(await render()).toContain('data-scheme="evergreen"');
    anonymousCookie = "base";
    expect(await render()).toContain('data-scheme="ocean"');
  });

  it("signed out: the account mirror is ignored, and signed in the anonymous cookie is ignored", async () => {
    appearanceCookie = "ocean";
    anonymousCookie = "evergreen";
    expect(await render()).toContain('data-scheme="evergreen"');
    session = { email: "owner@example.test" };
    expect(await render()).toContain('data-scheme="ocean"');
    appearanceCookie = undefined;
    savedAppearance = "dusk";
    expect(await render()).toContain('data-scheme="dusk"');
  });

  it("with no cookie, uses the account's saved theme (an old stored id is mapped) for a signed-in person and Ocean for everyone else", async () => {
    savedAppearance = "dusk";
    session = { email: "owner@example.test" };
    expect(await render()).toContain('data-scheme="dusk"');
    session = null;
    expect(await render()).toContain('data-scheme="ocean"');
  });

  it("themes the sign-in screens from the cookie too, and loads the fonts", async () => {
    authScreen = "1";
    anonymousCookie = "evergreen";
    const html = await render();
    expect(html).toContain('data-scheme="evergreen"');
    expect(html).toContain("font-body font-display");
  });
});
