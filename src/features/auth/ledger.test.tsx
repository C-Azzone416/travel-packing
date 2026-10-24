import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";

// Field Ledger on the signed-out screens (#204): every one sits under the same brand-only bar, with a screen-name eyebrow
// instead of the app name, in a flat card, and "Show password" is an in-field text toggle.
const fake = createFakeAuth();
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist("owner@example.test"),
    available: true,
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/app/sign-up/actions", () => ({ signUpAction: vi.fn() }));
vi.mock("@/app/verify/actions", () => ({ verifyAction: vi.fn(), resendVerifyAction: vi.fn() }));
vi.mock("@/app/forgot-password/actions", () => ({
  forgotAction: vi.fn(),
  resendResetAction: vi.fn(),
}));
vi.mock("@/app/reset-password/actions", () => ({ resetAction: vi.fn() }));
vi.mock("@/app/finish-setup/actions", () => ({ resendSetupAction: vi.fn() }));

import AccessDeniedPage from "@/app/access-denied/page";
import FinishSetupPage from "@/app/finish-setup/page";
import ForgotPasswordPage from "@/app/forgot-password/page";
import ResetPasswordPage from "@/app/reset-password/page";
import { SignInView } from "@/app/sign-in/SignInView";
import SignUpPage from "@/app/sign-up/page";
import VerifyPage from "@/app/verify/page";

beforeEach(() => {
  fake.current = null;
});

const render = async (element: React.ReactElement | Promise<React.ReactElement>) =>
  renderToStaticMarkup(await element);
const reset = (search: Record<string, string>) =>
  ResetPasswordPage({ searchParams: Promise.resolve(search) });

const SCREENS: [string, () => Promise<string>, string][] = [
  [
    "sign-in",
    () =>
      render(
        <SignInView
          action={() => undefined}
          error={null}
          pending={false}
          showPassword={false}
          onTogglePassword={() => undefined}
        />,
      ),
    "Sign in",
  ],
  ["sign-up", () => render(SignUpPage()), "Create account"],
  ["verify", () => render(VerifyPage()), "Verify email"],
  ["forgot-password", () => render(ForgotPasswordPage()), "Reset password"],
  ["finish-setup", () => render(FinishSetupPage()), "Finish setup"],
  ["reset-password", () => render(reset({ token: "a".repeat(16) })), "Reset password"],
  [
    "reset-password (setup)",
    () => render(reset({ token: "a".repeat(16), setup: "1" })),
    "Finish setup",
  ],
  ["invalid link", () => render(reset({})), "Link problem"],
  ["access-denied", () => render(AccessDeniedPage()), "Private"],
];

describe.each(SCREENS)("the %s screen", (_name, markup, eyebrow) => {
  it("sits under the brand-only bar: the circle and wordmark, no links, no navigation, no status chip", async () => {
    const html = await markup();
    const bar = /<header class="auth-brandbar">(.*?)<\/header>/.exec(html)?.[1] ?? "";
    expect(bar).toContain('class="brand-mark"');
    expect(bar).toContain("<strong>Packed Smart</strong>");
    expect(bar).not.toMatch(/<a[\s>]|<nav|<button|sync-chip/);
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.indexOf("auth-brandbar")).toBeLessThan(html.indexOf('class="auth-screen"'));
    // The app's own navigation header is never used here.
    expect(html).not.toContain('class="topbar');
  });

  it(`names itself in the eyebrow ("${eyebrow}"), not the app, and the card is the flat Ledger card`, async () => {
    const html = await markup();
    expect(html).toContain(`<p class="eyebrow">${eyebrow}</p>`);
    expect(html).not.toContain('<p class="eyebrow">Packed Smart</p>');
    expect(html).toContain('class="card padded auth-card"');
  });
});

describe("Show password", () => {
  it.each([
    ["sign-in", SCREENS[0][1]],
    ["reset-password", SCREENS[5][1]],
    ["finish-setup password", SCREENS[6][1]],
  ])(
    "on %s is one text toggle inside the field: a plain button, pressed state in aria-pressed, no boxed Button",
    async (_name, markup) => {
      const html = await markup();
      const toggles = html.match(/<button[^>]*class="password-toggle"[^>]*>/g) ?? [];
      expect(toggles).toHaveLength(1);
      expect(toggles[0]).toContain('aria-pressed="false"');
      expect(toggles[0]).toContain('type="button"');
      expect(html).toMatch(/<div class="password-row"><input[^>]*>\s*<button[^>]*password-toggle/);
      expect(html).not.toMatch(/class="button[^"]*password-toggle/);
      expect(html.match(/Show password/g)).toHaveLength(1);
    },
  );
});
