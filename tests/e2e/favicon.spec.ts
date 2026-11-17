import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// The favicon set (#492) is served signed out and signed in, and every page advertises it in <head>.
const ICONS = [
  { path: "/icon.svg", type: "image/svg+xml" },
  { path: "/favicon.ico", type: "image/x-icon" },
  { path: "/apple-icon.png", type: "image/png" },
];

for (const { path, type } of ICONS) {
  test(`${path} is served signed out with its content type`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
  });
}

test("the icons are served to a signed-in owner too", async ({ page }) => {
  await signInAsOwner(page);
  for (const { path, type } of ICONS) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
  }
});

test("the sign-in page and an app page advertise the icons in <head>", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('head link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="icon"][type="image/x-icon"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(1);

  await signInAsOwner(page);
  await expect(page.locator('head link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(1);
});
