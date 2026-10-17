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
    await expect(page.locator("form p[role='alert']")).toContainText(
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

test.describe("auth screens stand alone", () => {
  test("sign-in and access-denied show no app chrome (no top bar, no navigation, no skip link)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(0);
    await expect(page.locator("header.topbar")).toHaveCount(0);
    await signIn(page, OTHER_EMAIL);
    await expect(page).toHaveURL(/\/access-denied$/);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.locator("header.topbar")).toHaveCount(0);
  });

  test("a client cannot hide the app chrome on a protected page by sending the marker header", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.setExtraHTTPHeaders({ "x-auth-screen": "1" });
    await page.goto("/staples");
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  });

  test("controls meet the 44px target size and keep the card within the viewport", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    for (const name of ["Show password", "Sign in"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    for (const label of ["Email", "Password"]) {
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("screenshots of the auth screens", async ({ page }, testInfo) => {
    const shot = (name: string) =>
      page.screenshot({
        path: `test-results/screenshots/${testInfo.project.name}-${name}.png`,
        fullPage: true,
      });
    await page.goto("/sign-in");
    await shot("sign-in");
    await signIn(page, OWNER_EMAIL, "wrong-password");
    await expect(page.locator("form p[role='alert']")).toBeVisible();
    await shot("sign-in-error");
    await signIn(page, OTHER_EMAIL);
    await expect(page).toHaveURL(/\/access-denied$/);
    await shot("access-denied");
  });
});
