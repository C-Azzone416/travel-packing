import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import {
  PENDING_EMAIL_COOKIE,
  PENDING_EMAIL_MAX_AGE_SECONDS,
  forgetPendingEmail,
  pendingEmail,
  rememberPendingEmail,
} from "./pending-email";

beforeEach(() => jar.clear());

describe("pending email", () => {
  it("remembers an address in a short-lived httpOnly cookie, and forgets it", async () => {
    expect(await pendingEmail()).toBeNull();
    await rememberPendingEmail("owner@example.test");
    expect(await pendingEmail()).toBe("owner@example.test");
    expect(jar.get(PENDING_EMAIL_COOKIE)?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: PENDING_EMAIL_MAX_AGE_SECONDS,
    });
    await forgetPendingEmail();
    expect(await pendingEmail()).toBeNull();
  });

  it("only trusts something that looks like an address", async () => {
    jar.set(PENDING_EMAIL_COOKIE, { value: "<script>alert(1)</script>" });
    expect(await pendingEmail()).toBeNull();
    jar.set(PENDING_EMAIL_COOKIE, { value: "  Owner@Example.TEST " });
    expect(await pendingEmail()).toBe("owner@example.test");
  });

  it("marks the cookie secure only in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await rememberPendingEmail("a@example.test");
    expect(jar.get(PENDING_EMAIL_COOKIE)?.options?.secure).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    await rememberPendingEmail("a@example.test");
    expect(jar.get(PENDING_EMAIL_COOKIE)?.options?.secure).toBe(false);
    vi.unstubAllEnvs();
  });

  it("is still secure in a deployed build, and not in the e2e build that runs over plain http (WebKit refuses it there)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    await rememberPendingEmail("a@example.test");
    expect(jar.get(PENDING_EMAIL_COOKIE)?.options?.secure).toBe(false);
    for (const deployed of [undefined, "", "0", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", deployed as string);
      await rememberPendingEmail("a@example.test");
      expect(jar.get(PENDING_EMAIL_COOKIE)?.options?.secure, String(deployed)).toBe(true);
    }
    vi.unstubAllEnvs();
  });
});
