import { expect, test } from "@playwright/test";
import { SAMPLE_TODAY } from "../../src/server/seed/sample-data";

// The real responses carry the security headers (#22), on a page, on a redirect target and on an API route.
for (const path of ["/sign-in", "/api/locations/search?q=lon", "/"]) {
  test(`${path} carries the security headers`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });
}

test("the CSP does not break the app: no violations while the sign-in page and dashboard load", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.clock.install({ time: new Date(`${SAMPLE_TODAY}T12:00:00`) });
  const { signInAsOwner } = await import("./helpers/auth");
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  expect(violations).toEqual([]);
});
