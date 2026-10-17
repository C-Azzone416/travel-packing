import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "./server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "./server/auth/allowlist";

const fake = createFakeAuth();
vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({
    provider: fake,
    allowlist: parseAllowlist("owner@example.test"),
    available: true,
  }),
}));

import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("applies the guard to the request", async () => {
    fake.current = null;
    const signedOut = await proxy(new NextRequest("https://app.example.test/trips"));
    expect(signedOut.status).toBe(307);
    fake.current = { userId: "u1", email: "owner@example.test" };
    const owner = await proxy(new NextRequest("https://app.example.test/trips"));
    expect(owner.status).toBe(200);
  });
});

describe("proxy matcher", () => {
  const [apiMatcher, pageMatcher] = config.matcher;
  const pageRegex = new RegExp(`^${pageMatcher}$`);
  // `/api/:path*` matches /api and everything under it.
  const covered = (path: string) =>
    path === "/api" || path.startsWith("/api/") || pageRegex.test(path);

  it("has the API matcher first", () => {
    expect(apiMatcher).toBe("/api/:path*");
  });

  it.each([
    "/",
    "/trips",
    "/trips/abc",
    "/sign-in",
    "/access-denied",
    "/settings",
    "/api",
    "/api/trips",
  ])("covers %s", (path) => {
    expect(covered(path)).toBe(true);
  });

  it.each([
    "/api/x.js",
    "/api/export.css",
    "/api/logo.png",
    "/api/v1/report.svg",
    "/api/a/b/c.webp",
  ])(
    "never lets an API path skip the proxy, even one that looks like a static file: %s",
    (path) => {
      expect(covered(path)).toBe(true);
      expect(pageRegex.test(path)).toBe(false);
    },
  );

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.png",
    "/assets/art.webp",
    "/styles.css",
  ])("skips the static file %s", (path) => {
    expect(covered(path)).toBe(false);
  });
});
