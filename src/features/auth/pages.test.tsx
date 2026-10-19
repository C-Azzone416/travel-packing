import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
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

import FinishSetupPage from "@/app/finish-setup/page";
import ForgotPasswordPage from "@/app/forgot-password/page";
import ResetPasswordPage, { metadata as resetMetadata } from "@/app/reset-password/page";
import SignUpPage from "@/app/sign-up/page";
import VerifyPage from "@/app/verify/page";
import { createFlowLimits, flowLimits, resetFlowLimits } from "@/server/auth/flow-limits";

beforeEach(() => {
  jar.clear();
  resetFlowLimits();
  fake.current = null;
});

const OWNER = { userId: "u1", email: "owner@example.test" };
const html = async (page: Promise<React.ReactElement>) => renderToStaticMarkup(await page);

describe.each([
  ["sign-up", () => SignUpPage(), "Create your account"],
  ["verify", () => VerifyPage(), "Confirm your email"],
  ["forgot-password", () => ForgotPasswordPage(), "Reset your password"],
  ["finish-setup", () => FinishSetupPage(), "Check your email to finish setting up"],
])("the %s page", (_name, page, title) => {
  it("is shown to a signed-out visitor", async () => {
    expect(await html(page())).toContain(title);
  });

  it("sends an already signed-in owner to the app", async () => {
    fake.current = OWNER;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("still shows the screen to a non-allowlisted session, which the check ends", async () => {
    fake.current = { userId: "u2", email: "intruder@example.test" };
    expect(await html(page())).toContain(title);
    expect(fake.current).toBeNull();
  });
});

describe("the verify page", () => {
  it("shows the remembered address and the time left on the resend gap", async () => {
    jar.set("cw-pending-email", "owner@example.test");
    flowLimits().send("verify", "owner@example.test", "1.1.1.1");
    const markup = await html(VerifyPage());
    expect(markup).toContain("Check your email");
    expect(markup).toContain("If owner@example.test can be used to sign up");
    expect(markup).toMatch(/You can request another code in (29|30)s/);
    expect(markup).not.toContain('for="email"');
  });

  it("ignores a remembered value that is not an address", async () => {
    jar.set("cw-pending-email", "<script>x</script>");
    const markup = await html(VerifyPage());
    expect(markup).toContain("Confirm your email");
    expect(markup).not.toContain("<script>x");
  });

  it("starts with no gap when nothing was just sent", async () => {
    jar.set("cw-pending-email", "owner@example.test");
    expect(await html(VerifyPage())).toContain(">Send a new code<");
    expect(createFlowLimits().cooldownRemaining("verify", "owner@example.test")).toBe(0);
  });
});

describe("the finish-setup page", () => {
  it("names the address the link went to and shows the time left on the resend gap", async () => {
    jar.set("cw-pending-email", "owner@example.test");
    flowLimits().send("reset", "owner@example.test", "1.1.1.1");
    const markup = await html(FinishSetupPage());
    expect(markup).toContain(
      "We&#x27;ve sent a link to owner@example.test. Open it to choose your password.",
    );
    expect(markup).toMatch(/You can request another link in (29|30)s/);
  });

  it("without a remembered address says so in general terms and offers a new link", async () => {
    const markup = await html(FinishSetupPage());
    expect(markup).toContain("Open the link we emailed");
    expect(markup).toContain('href="/forgot-password"');
    expect(markup).not.toContain("Send the link again");
  });
});

describe("the reset-password page", () => {
  const page = (params: Record<string, string | string[]>) =>
    html(ResetPasswordPage({ searchParams: Promise.resolve(params) }));

  it("shows the form for a link with a usable token", async () => {
    const markup = await page({ token: "fake-token-one" });
    expect(markup).toContain("Choose a new password");
    expect(markup).toContain('value="fake-token-one"');
  });

  it.each([
    ["no token", {}],
    ["an empty token", { token: "" }],
    ["a token with odd characters", { token: "<b>nope</b>" }],
    ["a repeated token", { token: ["fake-token-one", "fake-token-two"] }],
    ["an error from the provider", { token: "fake-token-one", error: "INVALID_TOKEN" }],
    ["our own invalid marker", { error: "invalid" }],
  ])("shows 'This link isn't valid' and no form for %s", async (_name, params) => {
    const markup = await page(params);
    expect(markup).toContain("This link isn’t valid");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("nope");
  });

  it("shows 'Set your password' for the link that finishes sign-up, and 'Choose a new password' otherwise", async () => {
    const setupMarkup = await page({ token: "fake-token-one", for: "seal.value.mac", setup: "1" });
    expect(setupMarkup).toContain("Set your password");
    expect(setupMarkup).toContain(">Set password<");
    expect(setupMarkup).toContain('name="variant" value="setup"');
    expect(setupMarkup).toContain('name="for" value="seal.value.mac"');
    const resetMarkup = await page({ token: "fake-token-one", for: "seal.value.mac" });
    expect(resetMarkup).toContain("Choose a new password");
    expect(resetMarkup).toContain(">Update password<");
  });

  it("shows the same 'not valid' screen for the setup variant", async () => {
    const markup = await page({ setup: "1", error: "INVALID_TOKEN" });
    expect(markup).toContain("This link isn’t valid");
    expect(markup).not.toContain("<form");
  });

  it("recovers a token the provider glued onto the seal", async () => {
    const markup = await page({ for: "seal.value.mac?token=fake-token-one" });
    expect(markup).toContain('name="token" value="fake-token-one"');
    expect(markup).toContain('name="for" value="seal.value.mac"');
  });

  it("keeps the one-time token from being passed on to other sites", () => {
    expect(resetMetadata.referrer).toBe("no-referrer");
  });
});
