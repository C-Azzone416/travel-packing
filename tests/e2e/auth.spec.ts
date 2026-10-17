import { expect, test } from "@playwright/test";
import { OTHER_EMAIL, OWNER_EMAIL, signIn, signInAsOwner } from "./helpers/auth";

test.describe("signed out", () => {
  test("a protected page redirects to sign-in", async ({ page }) => {
    for (const path of ["/", "/settings", "/trips/anything"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    }
  });

  test("an API call is refused with a generic 401", async ({ request }) => {
    const response = await request.get("/api/anything");
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("the sign-in screen has no sign-up link and a working show/hide toggle", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("link", { name: /sign up|create account/i })).toHaveCount(0);
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("a wrong password shows one generic error and stays on sign-in", async ({ page }) => {
    await signIn(page, OWNER_EMAIL, "wrong-password");
    // Scoped to the form: Next.js also has its own role="alert" route announcer.
    await expect(page.locator("form p[role='alert']")).toHaveText(
      "Email or password is incorrect.",
    );
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe("allowlist", () => {
  test("the allowlisted owner signs in and reaches the app", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("a valid account that is not allowlisted is denied and signed out", async ({ page }) => {
    await signIn(page, OTHER_EMAIL);
    await expect(page).toHaveURL(/\/access-denied$/);
    await expect(page.getByRole("heading", { name: "This app is private" })).toBeVisible();
    await expect(page.getByText(OTHER_EMAIL)).toHaveCount(0);

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
