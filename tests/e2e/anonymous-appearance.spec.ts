import { expect, test } from "@playwright/test";
import { PUBLIC_PATHS } from "../../src/server/auth/public-paths";
import {
  ANONYMOUS_COOKIE,
  PALETTES,
  anonymousCookie,
  chooseTheme,
  chooseThemeAndSignOut,
  htmlTag,
  signOutFromSettings,
} from "./helpers/appearance";
import { SECOND_EMAIL, ownerEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { ensureExistingOwner, setOwnerAppearance } from "./helpers/database";

// #283: the chosen appearance survives sign-out on every signed-out page, from the very first server response, without
// keeping any account data. The signed-out entry (`/`) and an unknown path redirect to sign-in; both come from the same
// root layout as everything else.
const ROUTES = [...PUBLIC_PATHS, "/", "/no-such-page"];
const YEAR = 31536000;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const palette of PALETTES) {
  test(`${palette.id}: choose it, sign out, and every signed-out route is that palette in the server HTML and the first frame`, async ({
    page,
    context,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    await signInAsOwner(page);
    await chooseThemeAndSignOut(page, context, palette);

    // The cookie: only the palette id, server-only, Lax, one year; the account mirror is gone.
    const cookies = await context.cookies();
    const anon = cookies.find((cookie) => cookie.name === ANONYMOUS_COOKIE);
    expect(anon?.value, "cookie value is only the palette id").toBe(palette.id);
    expect(anon?.httpOnly).toBe(true);
    expect(anon?.sameSite).toBe("Lax");
    expect(anon?.path).toBe("/");
    const lifetime = (anon?.expires ?? 0) - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(YEAR - 300);
    expect(lifetime).toBeLessThanOrEqual(YEAR + 5);
    expect(cookies.some((cookie) => cookie.name === "appearance")).toBe(false);
    console.log(
      `cookie: ${JSON.stringify({ name: anon?.name, value: anon?.value, httpOnly: anon?.httpOnly, sameSite: anon?.sameSite, secure: anon?.secure })}`,
    );

    // A reload of the sign-in page, then each route fetched directly: the server HTML carries the palette.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", palette.id);
    for (const route of ROUTES) {
      const tag = htmlTag(await (await page.request.get(route)).text());
      expect(tag, `server HTML for ${route}`).toContain(`data-appearance="${palette.id}"`);
    }

    // First painted frame: no JavaScript at all (so no hydration), same cookies. The attribute and the colours are right.
    const bare = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      javaScriptEnabled: false,
      storageState: await context.storageState(),
    });
    try {
      const plain = await bare.newPage();
      for (const route of ROUTES) {
        await plain.goto(route);
        await expect(plain.locator("html"), route).toHaveAttribute("data-appearance", palette.id);
        const accent = await plain.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
        );
        expect(accent, `--accent on ${route}`).toBe(palette.accent);
      }
    } finally {
      await bare.close();
    }

    // Direct navigation in the real browser too.
    for (const route of PUBLIC_PATHS) {
      await page.goto(route);
      await expect(page.locator("html"), route).toHaveAttribute("data-appearance", palette.id);
    }
  });
}

test("fallbacks: no cookie, an unknown, malformed or newer-build value all render Base", async ({
  page,
  context,
}, testInfo) => {
  const url = testInfo.project.use.baseURL ?? "http://localhost";
  for (const value of [undefined, "neon", "VIOLET", "violet%3Bx", "ocean-v2", "{}"]) {
    await context.clearCookies();
    if (value !== undefined) await context.addCookies([{ name: ANONYMOUS_COOKIE, value, url }]);
    for (const route of ["/sign-in", "/close-account/complete"]) {
      const tag = htmlTag(await (await page.request.get(route)).text());
      expect(tag, `${route} with ${JSON.stringify(value)}`).toContain('data-appearance="base"');
    }
  }
  // A hand-set account mirror does nothing for a signed-out visitor.
  await context.clearCookies();
  await context.addCookies([{ name: "appearance", value: "ocean", url }]);
  expect(htmlTag(await (await page.request.get("/sign-in")).text())).toContain(
    'data-appearance="base"',
  );
});

test("account A (terracotta) signs out, B (violet) signs in and gets violet at once; each account keeps its own", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const html = page.locator("html");
  const terracotta = PALETTES[2];
  const emailA = ownerEmailFor(testInfo.project.name);
  const idB = `e2e-${SECOND_EMAIL}`;
  await ensureExistingOwner(idB);
  await setOwnerAppearance(idB, "violet");

  await signInAsOwner(page);
  await chooseThemeAndSignOut(page, context, terracotta);
  await page.goto("/sign-in");
  await expect(html).toHaveAttribute("data-appearance", "terracotta");

  // B's saved violet wins at once (the very first page after sign-in), and refreshes the anonymous palette.
  await signIn(page, SECOND_EMAIL);
  await expect(page).toHaveURL(/\/$/);
  await expect(html).toHaveAttribute("data-appearance", "violet");
  await expect.poll(async () => (await anonymousCookie(context))?.value).toBe("violet");
  await signOutFromSettings(page);
  await expect(html).toHaveAttribute("data-appearance", "violet");
  const tag = htmlTag(await (await page.request.get("/forgot-password")).text());
  expect(tag).toContain('data-appearance="violet"');

  // A signs back in while the anonymous palette is violet: A's own terracotta wins and is not overwritten.
  await signIn(page, emailA);
  await expect(page).toHaveURL(/\/$/);
  await expect(html).toHaveAttribute("data-appearance", "terracotta");
  await expect.poll(async () => (await anonymousCookie(context))?.value).toBe("terracotta");
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: terracotta.radio })).toBeChecked();
  await chooseTheme(page, context, terracotta);
});
