import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";

const fake = createFakeAuth();
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist("owner@example.test"),
    available: true,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import SignInPage from "./page";
import { SignInForm } from "./SignInForm";
import { SignInView } from "./SignInView";

const noop = () => {};
const view = (overrides: Partial<Parameters<typeof SignInView>[0]> = {}) =>
  renderToStaticMarkup(
    <SignInView
      action={noop}
      error={null}
      pending={false}
      showPassword={false}
      onTogglePassword={noop}
      {...overrides}
    />,
  );

describe("SignInView (design spec #31)", () => {
  it("is a titled card with email and password fields and no sign-up link", () => {
    const html = view();
    expect(html).toContain("<h1");
    expect(html).toContain("Welcome back");
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>Password<\/label>/);
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain(">Sign in<");
    expect(html.toLowerCase()).not.toContain("sign up");
    expect(html.toLowerCase()).not.toContain("forgot");
    expect(html).not.toContain('role="alert"');
  });

  it("toggles password visibility", () => {
    expect(view()).toContain('type="password"');
    expect(view()).toContain("Show password");
    const shown = view({ showPassword: true });
    expect(shown).toMatch(/<input id="password" type="text"/);
    // One fixed label; aria-pressed carries the state.
    expect(shown).not.toContain("Hide password");
    expect(shown).toContain("Show password");
    expect(shown).toContain('aria-pressed="true"');
    expect(view()).toContain('aria-pressed="false"');
  });

  it("shows the error inline, above the submit button, as an alert", () => {
    const html = view({ error: "Email or password is incorrect." });
    expect(html).toContain('role="alert"');
    expect(html.indexOf("Email or password is incorrect.")).toBeLessThan(html.indexOf(">Sign in<"));
  });

  it("shows progress, disables only the submit button, and keeps the fields read-only (focus is not lost)", () => {
    const html = view({ pending: true });
    expect(html).toContain("Signing in…");
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/readOnly=""/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("renders an optional decorative banner above the card", () => {
    const html = view({ banner: <div data-testid="banner" /> });
    expect(html.indexOf("banner")).toBeLessThan(html.indexOf("Welcome back"));
  });
});

describe("SignInForm", () => {
  it("renders the view in its initial state", () => {
    const html = renderToStaticMarkup(<SignInForm />);
    expect(html).toContain("Welcome back");
    expect(html).toContain("Show password");
    expect(html).not.toContain('role="alert"');
  });
});

describe("SignInPage", () => {
  it("shows the form to a signed-out visitor", async () => {
    fake.current = null;
    expect(renderToStaticMarkup(await SignInPage())).toContain("Welcome back");
  });

  it("sends an already signed-in owner to the app", async () => {
    fake.current = { userId: "u1", email: "owner@example.test" };
    await expect(SignInPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("still shows the form to a non-allowlisted session (which the check ends)", async () => {
    fake.current = { userId: "u2", email: "intruder@example.test" };
    expect(renderToStaticMarkup(await SignInPage())).toContain("Welcome back");
    expect(fake.current).toBeNull();
  });
});
