import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import {
  E2E_PASSWORD,
  STRANGER_EMAIL,
  newcomerEmailFor,
  signIn,
  signInAsOwner,
} from "./helpers/auth";
import {
  createVerifiedAccount,
  nextNewcomerSlot,
  preRegisterAccount,
  resetAccount,
  resetLinkPath,
  resetToken,
  verificationCode,
  wrongCodeFor,
} from "./helpers/inbox";
import { DEVICE } from "./helpers/device";

// Sign-up, verification code, resend, forgot and reset password (#27) against the real server with the e2e-only fake
// provider. Codes and links come from the fake "inbox" (tests/e2e/helpers/inbox.ts); none is in source or a log.
const NEW_PASSWORD = "a-new-password-1";
/** Chosen through the "finish setting up" link. */
const SET_PASSWORD = "my-chosen-password";

let email: string;
test.beforeEach(({}, testInfo) => {
  email = newcomerEmailFor(testInfo.project.name, nextNewcomerSlot());
  resetAccount(email);
  resetAccount(STRANGER_EMAIL);
});

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });

async function signUp(page: Page, address = email) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify$/);
}

/**
 * Types the code and presses Verify, and waits for the server's answer so the next try never races the form reset.
 * The form ignores a submit while the previous answer is still being applied (a deliberate double-submit guard), and on a slow
 * runner a click can land in that window and do nothing. CI showed it: one of five wrong tries was swallowed, so the lock never came
 * and the right code was accepted. So the code is typed and Verify pressed again until a request really goes out.
 */
async function enterCode(page: Page, code: string) {
  const answered = page.waitForResponse((response) => response.request().method() === "POST");
  await expect(async () => {
    await page.getByLabel("6-digit code").fill(code);
    const sent = page.waitForRequest((request) => request.method() === "POST", { timeout: 1500 });
    await page.getByRole("button", { name: "Verify" }).click();
    await sent;
  }).toPass({ timeout: 15_000 });
  await answered;
}

const WRONG = /That code isn't right or has expired/;

/** Opens the link emailed to this address and chooses a password with it (the "Set your password" screen). */
async function finishSetup(page: Page, address = email, password = SET_PASSWORD) {
  const link = resetLinkPath(address);
  expect(link, "a setup link was emailed").not.toBeNull();
  await page.goto(link ?? "/");
  await expect(heading(page, "Set your password")).toBeFocused();
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=password-set$/);
}

test.describe("sign-up and verification", () => {
  test("a new person signs up, confirms the code, chooses a password through the emailed link, signs in, and reaches the app", async ({
    page,
  }) => {
    await signUp(page);
    await expect(heading(page, "Check your email")).toBeFocused();
    // The heading takes focus on arrival but is not a control, so it shows no focus ring.
    await expect(heading(page, "Check your email")).toHaveCSS("outline-style", "none");
    await expect(page.getByText(`If ${email} can be used to sign up`)).toBeVisible();

    // Unverified: nothing in the app is reachable yet, and signing in is not possible.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/verify");

    const code = verificationCode(email);
    expect(code).toMatch(/^\d{6}$/);
    await enterCode(page, code ?? "");
    // A right code starts no session. The person is told to check their email for the link that sets the password.
    await expect(page).toHaveURL(/\/finish-setup$/);
    await expect(heading(page, "Check your email to finish setting up")).toBeFocused();
    await expect(page.getByText(`We've sent a link to ${email}.`)).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);

    await finishSetup(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Password set. Sign in with your new password." }),
    ).toBeVisible();
    // Setting the password does not sign anyone in; the person signs in with it.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await signIn(page, email, SET_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: /go to trips/i })).toBeVisible();
  });

  test("a password chosen by someone else BEFORE the owner verified can never sign in", async ({
    page,
  }) => {
    const ATTACKER_PASSWORD = "the-attackers-password";
    // 1. Someone who knows the address calls the auth service's public sign-up directly, with their own password (the app's
    //    own form takes no password since #102, so this is the only way to choose one).
    preRegisterAccount(email, ATTACKER_PASSWORD);
    // 2. The real owner signs up with the same address: the screen looks the same, nothing is applied.
    await signUp(page, email);
    // 3. The owner enters the mailed code, so the address is now verified, with the attacker's password on the account.
    await enterCode(page, verificationCode(email) ?? "");
    await expect(page).toHaveURL(/\/finish-setup$/);

    // 4. The attacker's password opens nothing: not sign-in, not the app, not a session cookie.
    await signIn(page, email, ATTACKER_PASSWORD);
    await expect(page).toHaveURL(/\/finish-setup$/);
    await expect(heading(page, "Check your email to finish setting up")).toBeVisible();
    expect(await page.context().cookies()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ name: "e2e-auth-session" })]),
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    // ...and the password the owner chooses later is not on the account yet, so it does not work either.
    await signIn(page, email, SET_PASSWORD);
    await expect(page.locator("form p[role='alert']")).toContainText(
      "Email or password is incorrect.",
    );

    // 5. The owner uses the emailed link and chooses a password. The attacker's is gone for good.
    await finishSetup(page, email, NEW_PASSWORD);
    await signIn(page, email, ATTACKER_PASSWORD);
    await expect(page.locator("form p[role='alert']")).toContainText(
      "Email or password is incorrect.",
    );
    await signIn(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
  });

  test(
    "the code step: a wrong code, then the right one; the field is one input with a numeric keypad",
    DEVICE,
    async ({ page }) => {
      await signUp(page);
      const code = page.getByLabel("6-digit code");
      await expect(code).toHaveAttribute("autocomplete", "one-time-code");
      await expect(code).toHaveAttribute("inputmode", "numeric");
      await expect(code).toHaveAttribute("maxlength", "6");
      await expect(page.getByRole("textbox")).toHaveCount(1);

      // A pasted code with spaces or dashes is cleaned before the length limit can cut a digit off it.
      await code.focus();
      await code.evaluate((input) => {
        const data = new DataTransfer();
        data.setData("text", "123 456");
        input.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      });
      await expect(code).toHaveValue("123456");
      await code.fill("");
      await code.pressSequentially("12a3-4x56");
      await expect(code).toHaveValue("123456");
      await enterCode(page, wrongCodeFor(email));
      await expect(page.locator("#code-error")).toContainText(
        "That code isn't right or has expired",
      );
      await expect(code).toBeFocused();
      await expect(code).toHaveAttribute("aria-invalid", "true");
      await expect(code).toHaveAttribute("aria-describedby", /code-error/);
      await expect(page).toHaveURL(/\/verify$/);

      await enterCode(page, verificationCode(email) ?? "");
      await expect(page).toHaveURL(/\/finish-setup$/);
    },
  );

  test("an empty code asks for the code and counts nothing", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("#code-error")).toHaveText(/Enter the 6-digit code\./);
  });

  test("resend: the gap shows as quiet text, the button returns when it ends, and asking early is held", async ({
    page,
  }) => {
    await page.clock.install();
    await signUp(page);
    // The first send started the 30-second gap.
    await expect(page.getByText(/You can request another code in \d+s/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new code" })).toHaveCount(0);
    const live = page.getByRole("status").filter({ hasText: /^$/ });
    await expect(live).toHaveCount(1);

    await page.clock.runFor(31_000);
    await expect(page.getByRole("button", { name: "Send a new code" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("You can request a new code now.");

    // The server's own clock has not moved: asking now is held, with the time that is left.
    await page.getByRole("button", { name: "Send a new code" }).click();
    await expect(page.getByText(/You can request another code in \d+s/)).toBeVisible();
    expect(verificationCode(email)).toMatch(/^\d{6}$/);
  });

  test("an abandoned sign-up is retried by signing up again, which shows the code screen and the code that was already sent", async ({
    page,
  }) => {
    await signUp(page);
    const first = verificationCode(email);
    // The person closes the tab and comes back later: no cookie, no password to sign in with.
    await page.context().clearCookies();
    await signUp(page);
    await expect(heading(page, "Check your email")).toBeVisible();
    // Nothing new was mailed for the taken address (as with the real provider); the code from before still works.
    expect(verificationCode(email)).toBe(first);
    await enterCode(page, first ?? "");
    await expect(page).toHaveURL(/\/finish-setup$/);
  });

  test("an address that is not allowed gets the same screens and its code never works", async ({
    page,
  }) => {
    await signUp(page, STRANGER_EMAIL);
    await expect(heading(page, "Check your email")).toBeVisible();
    await expect(page.getByText(`If ${STRANGER_EMAIL} can be used to sign up`)).toBeVisible();
    await expect(page.getByText(/not allowed|not invited|invite|private/i)).toHaveCount(0);
    expect(verificationCode(STRANGER_EMAIL)).toBeNull();

    await enterCode(page, "123456");
    await expect(page.locator("#code-error")).toContainText("That code isn't right or has expired");
    await expect(page).toHaveURL(/\/verify$/);
  });

  test("a bad address is named under the field and nothing is sent; the form has no password field", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("#email-error")).toContainText("Enter a valid email address.");
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
    await expect(page).toHaveURL(/\/sign-up$/);
  });
});

test.describe("forgot and reset password", () => {
  // An existing, verified account whose password was chosen earlier; forgot-password is what these tests are about.
  const ownAccount = async () => createVerifiedAccount(email, SET_PASSWORD);

  async function forgot(page: Page, address: string) {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(heading(page, "Check your email")).toBeFocused();
  }

  test(
    "Didn't get it? sits under the resend control, closed, and reads the same for an address with an account and one without",
    DEVICE,
    async ({ page }) => {
      await ownAccount();
      await forgot(page, email);
      const note = page.locator("details.didnt-get-it");
      await expect(note).toBeVisible();
      await expect(note).not.toHaveAttribute("open", "");
      const summary = note.getByText("Didn’t get it?");
      expect(Math.round((await summary.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
      await summary.click();
      await expect(note.getByText("Check your spam or junk folder.")).toBeVisible();
      const own = await note.innerText();
      await expectAccessible(page, "forgot-password confirmation with the note open");
      await forgot(page, STRANGER_EMAIL);
      await page.locator("details.didnt-get-it summary").click();
      expect(await page.locator("details.didnt-get-it").innerText()).toBe(own);
    },
  );

  test("the same answer for an address with an account and one without", async ({ page }) => {
    await ownAccount();
    await forgot(page, email);
    await expect(
      page.getByText(
        `If there's an account for ${email}, we've sent a link to reset your password.`,
      ),
    ).toBeVisible();
    // Everything but the ticking seconds must match.
    const readable = async () =>
      (await page.locator("main").innerText()).replace(/in \d+s/, "in Ns");
    const withAccount = await readable();
    expect(resetToken(email)).not.toBeNull();

    await forgot(page, "nobody-here@example.test");
    const without = await readable();
    expect(without).toBe(withAccount.replaceAll(email, "nobody-here@example.test"));
    expect(resetToken("nobody-here@example.test")).toBeNull();
    await expect(page.getByText(/You can send it again in \d+s/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  });

  test("a reset link sets a new password once; the old one stops working; the link cannot be reused", async ({
    page,
  }) => {
    await ownAccount();
    await forgot(page, email);
    const link = resetLinkPath(email) ?? "";
    const token = resetToken(email) ?? "";
    await page.goto(link);
    await expect(heading(page, "Choose a new password")).toBeFocused();
    await expect(page.getByText("At least 8 characters.")).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.locator("#password-error")).toContainText("at least 8 characters");

    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?notice=password-updated$/);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Password updated. Sign in with your new password." }),
    ).toBeVisible();
    // Resetting does not sign anyone in.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);

    await signIn(page, email, SET_PASSWORD);
    await expect(page.locator("form p[role='alert']")).toContainText(
      "Email or password is incorrect.",
    );
    await signIn(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    await page.context().clearCookies();
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill("another-password-2");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/reset-password\?error=invalid$/);
    await expect(heading(page, "This link isn’t valid")).toBeVisible();
    expect(page.url()).not.toContain(token);
  });

  test.describe("a link that is not valid", () => {
    for (const [name, path] of [
      ["no token", "/reset-password"],
      ["a made-up token", `/reset-password?token=${"0".repeat(48)}`],
      ["the provider's own error", "/reset-password?error=INVALID_TOKEN"],
    ] as const) {
      test(`${name}: no form, a way to get a new link`, async ({ page }) => {
        await page.goto(path);
        if (path.includes("0000")) {
          await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
          await page.getByRole("button", { name: "Update password" }).click();
          await expect(page).toHaveURL(/\/reset-password\?error=invalid$/);
        }
        await expect(heading(page, "This link isn’t valid")).toBeFocused();
        await expect(page.getByText("It may have expired or already been used.")).toBeVisible();
        await expect(page.locator("form")).toHaveCount(0);
        await page.getByRole("link", { name: "Send a new reset link" }).click();
        await expect(page).toHaveURL(/\/forgot-password$/);
      });
    }
  });
});

test.describe("the account screens", () => {
  test(
    "every one is reachable signed out and sits outside the app shell",
    DEVICE,
    async ({ page }) => {
      for (const path of [
        "/sign-up",
        "/verify",
        "/forgot-password",
        "/reset-password",
        "/finish-setup",
      ]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: /go to trips/i })).toHaveCount(0);
      }
    },
  );

  test("a signed-in owner is sent to the app from the sign-up, verify and forgot screens", async ({
    page,
  }) => {
    await signInAsOwner(page);
    for (const path of ["/sign-up", "/verify", "/forgot-password", "/finish-setup"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("the reset page does not pass its address on to other sites", async ({ page }) => {
    await page.goto(`/reset-password?token=${"a".repeat(48)}`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });

  test(
    "controls are 44px targets on phone and nothing scrolls sideways",
    DEVICE,
    async ({ page }, testInfo) => {
      const visit = async (path: string, controls: (() => ReturnType<Page["locator"]>)[]) => {
        await page.goto(path);
        for (const control of controls) {
          const box = await control().boundingBox();
          if (testInfo.project.name === "phone") {
            expect(
              Math.round(box?.height ?? 0),
              `${path} ${await control().innerText()}`,
            ).toBeGreaterThanOrEqual(44);
          }
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      };
      await visit("/sign-in", [
        () => page.getByRole("link", { name: "Forgot password?" }),
        () => page.getByRole("link", { name: "Create an account" }),
        () => page.getByRole("button", { name: "Show password" }),
      ]);
      await visit("/sign-up", [
        () => page.getByRole("button", { name: "Create account" }),
        () => page.getByRole("link", { name: "Sign in" }),
      ]);
      await visit("/verify", [
        () => page.getByRole("button", { name: "Verify" }),
        () => page.getByRole("link", { name: "Use a different email" }),
      ]);
      await visit("/forgot-password", [
        () => page.getByRole("button", { name: "Send reset link" }),
        () => page.getByRole("link", { name: "Back to sign in" }),
      ]);
      await visit(`/reset-password?token=${"a".repeat(48)}`, [
        () => page.getByRole("button", { name: "Update password" }),
      ]);
      await visit("/reset-password", [
        () => page.getByRole("link", { name: "Send a new reset link" }),
      ]);
      await visit("/finish-setup", [() => page.getByRole("link", { name: "Send me a link" })]);
    },
  );
});

test.describe("accessibility and screenshots", DEVICE, () => {
  test("axe finds nothing on any account screen or state, and the screens are captured", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const shot = (name: string) =>
      page.screenshot({
        path: `test-results/screenshots/${testInfo.project.name}-auth-${name}.png`,
        fullPage: true,
      });
    const check = async (name: string, label = name) => {
      await expectAccessible(page, `account screen: ${label}`);
      await shot(name);
    };

    await page.goto("/sign-in?notice=password-updated");
    await check("sign-in-notice", "sign-in with the success banner");

    await page.goto("/sign-up");
    await check("sign-up");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("#email-error")).toBeVisible();
    await check("sign-up-errors");

    await signUp(page);
    await check("verify-cooldown", "verify while the resend gap runs");
    await enterCode(page, wrongCodeFor(email));
    await expect(page.locator("#code-error")).toContainText(WRONG);
    await check("verify-error-wrong", "verify with a wrong code");

    await page.goto("/forgot-password");
    await check("forgot");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.locator("#email-error")).toBeVisible();
    await check("forgot-error", "forgot with a bad address");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(heading(page, "Check your email")).toBeVisible();
    await check("forgot-sent", "forgot after submit");

    await page.goto(`/reset-password?token=${"a".repeat(48)}`);
    await check("reset", "reset password form");
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.locator("#password-error")).toBeVisible();
    await check("reset-error", "reset with a short password");

    await page.goto("/reset-password");
    await check("reset-invalid", "reset link not valid");

    // A fresh address with no remembered one: the code screen asks for the address too.
    await page.context().clearCookies();
    await page.goto("/verify");
    await check("verify-no-address", "verify without a remembered address");
  });

  test("the finish-setup and set-password screens are captured (#83)", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const check = async (name: string, label: string) => {
      await expectAccessible(page, `account screen: ${label}`);
      await page.screenshot({
        path: `test-results/screenshots/${testInfo.project.name}-auth-${name}.png`,
        fullPage: true,
      });
    };

    await page.clock.install();
    await signUp(page);
    await enterCode(page, verificationCode(email) ?? "");
    await expect(page).toHaveURL(/\/finish-setup$/);
    await expect(page.getByText(/You can request another link in \d+s/)).toBeVisible();
    await check("finish-setup-cooldown", "finish setup while the resend gap runs");
    await page.clock.runFor(31_000);
    await expect(page.getByRole("button", { name: "Send the link again" })).toBeVisible();
    await check("finish-setup", "finish setup, idle");

    // The link's setup variant: the first password after signing up.
    const link = resetLinkPath(email) ?? "";
    expect(link).toContain("setup=1");
    await page.goto(link);
    await check("set-password", "set password form");
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.locator("#password-error")).toBeVisible();
    await check("set-password-error", "set password with a short password");

    await page.goto("/reset-password?setup=1&error=INVALID_TOKEN");
    await check("link-invalid", "setup link not valid");

    await signIn(page, "nobody@example.test", "not-the-password");
    await expect(page.locator("form p[role='alert']")).toContainText(
      "If you just signed up, check your email for a link to finish setting up",
    );
    await expect(
      page.locator("form p[role='alert']").getByRole("link", { name: "reset your password" }),
    ).toHaveAttribute("href", "/forgot-password");
    await check("sign-in-error-hint", "sign-in with the generic error and its hint");

    await page.goto("/sign-in?notice=password-set");
    await check("sign-in-password-set", "sign-in with the Password set banner");
  });

  test("the locked and expired states are captured too", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signUp(page);
    for (let i = 0; i < 5; i += 1) await enterCode(page, wrongCodeFor(email));
    await enterCode(page, verificationCode(email) ?? "");
    await expect(page.locator("#code-error")).toContainText(
      "Too many attempts. Send a new code to try again.",
    );
    await expectAccessible(page, "account screen: verify locked");
    await page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-auth-verify-error-locked.png`,
      fullPage: true,
    });
  });
});

test("the shared synthetic password still signs the seeded owners in", async ({ page }) => {
  await signIn(page, "owner@example.test", E2E_PASSWORD);
  await expect(page).toHaveURL(/\/$/);
});
