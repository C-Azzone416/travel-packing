import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(
  () => new Map<string, { value: string; options?: Record<string, unknown> }>(),
);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import {
  forgetAnonymousAppearance,
  readAnonymousAppearance,
  rememberAnonymousAppearance,
} from "./anonymous-appearance";

beforeEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

describe("the anonymous palette cookie", () => {
  it.each(["base", "ocean", "terracotta", "violet"] as const)("round-trips %s", async (id) => {
    await rememberAnonymousAppearance(id);
    await expect(readAnonymousAppearance()).resolves.toBe(id);
    expect(jar.get("anon-appearance")?.value).toBe(id);
  });

  it("is httpOnly, Lax, site-wide and lasts one year (31536000 seconds)", async () => {
    await rememberAnonymousAppearance("violet");
    expect(jar.get("anon-appearance")?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31536000,
      secure: false,
    });
  });

  it("is Secure in a hosted (production) build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
    await rememberAnonymousAppearance("ocean");
    expect(jar.get("anon-appearance")?.options).toMatchObject({ secure: true });
  });

  it.each([undefined, "", "neon", "OCEAN", "ocean ", "ocean-2", "violet;x=1", "{}"])(
    "reads %j as no palette (Base)",
    async (value) => {
      if (value !== undefined) jar.set("anon-appearance", { value });
      await expect(readAnonymousAppearance()).resolves.toBeUndefined();
    },
  );

  it("never writes a value that is not a palette id", async () => {
    await rememberAnonymousAppearance("neon" as never);
    expect(jar.has("anon-appearance")).toBe(false);
  });

  it("is cleared by forget", async () => {
    await rememberAnonymousAppearance("ocean");
    await forgetAnonymousAppearance();
    expect(jar.has("anon-appearance")).toBe(false);
  });
});
