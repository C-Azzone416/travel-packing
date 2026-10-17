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
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/", "/trips", "/trips/abc", "/api/trips", "/sign-in", "/access-denied", "/settings"])(
    "covers %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.png",
    "/assets/art.webp",
    "/styles.css",
  ])("skips %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
