import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDataContext, updateAppearance, set } = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  updateAppearance: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/data/runtime", () => ({ getDataContext }));
vi.mock("@/server/data/service", () => ({ updateAppearance }));

import { updateAppearanceAction } from "./appearance-actions";

describe("updateAppearanceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataContext.mockResolvedValue({ owner: "test" });
  });

  it("saves the choice and mirrors it to a one-year Lax cookie", async () => {
    updateAppearance.mockResolvedValue({ ok: true, data: "ocean" });
    await expect(updateAppearanceAction("ocean")).resolves.toEqual({
      ok: true,
      appearance: "ocean",
    });
    expect(updateAppearance).toHaveBeenCalledWith({ owner: "test" }, { appearance: "ocean" });
    expect(set).toHaveBeenCalledWith(
      "appearance",
      "ocean",
      expect.objectContaining({ path: "/", maxAge: 31536000, sameSite: "lax" }),
    );
    // The anonymous palette cookie (#283) is refreshed too: server-only, palette id only, one year.
    expect(set).toHaveBeenCalledWith(
      "anon-appearance",
      "ocean",
      expect.objectContaining({ httpOnly: true, path: "/", maxAge: 31536000, sameSite: "lax" }),
    );
  });

  it("fails without touching the cookie when the data context or the save fails", async () => {
    getDataContext.mockResolvedValue(null);
    await expect(updateAppearanceAction("ocean")).resolves.toEqual({ ok: false, code: "INTERNAL" });
    getDataContext.mockResolvedValue({});
    updateAppearance.mockResolvedValue({ ok: false, error: { code: "INTERNAL" } });
    await expect(updateAppearanceAction("violet")).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("sends signed-out and not-allowed people to their pages", async () => {
    updateAppearance.mockResolvedValue({ ok: false, error: { code: "UNAUTHENTICATED" } });
    await expect(updateAppearanceAction("base")).rejects.toThrow("REDIRECT:/sign-in");
    updateAppearance.mockResolvedValue({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(updateAppearanceAction("base")).rejects.toThrow("REDIRECT:/access-denied");
  });
});
