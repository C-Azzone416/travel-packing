import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDataContext, getAppearance } = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  getAppearance: vi.fn(),
}));
vi.mock("@/server/data/runtime", () => ({ getDataContext }));
vi.mock("@/server/data/service", () => ({ getAppearance }));

import { appearanceForRequest, readSavedAppearance } from "./saved-appearance";

beforeEach(() => {
  vi.clearAllMocks();
  getDataContext.mockResolvedValue({});
});

describe("readSavedAppearance", () => {
  it("returns the saved theme", async () => {
    getAppearance.mockResolvedValue({ ok: true, data: "violet" });
    await expect(readSavedAppearance()).resolves.toBe("violet");
  });

  it("falls back to Base without a database, on an error result or on a throw", async () => {
    getDataContext.mockResolvedValue(null);
    await expect(readSavedAppearance()).resolves.toBe("base");
    getDataContext.mockResolvedValue({});
    getAppearance.mockResolvedValue({ ok: false, error: { code: "UNAUTHENTICATED" } });
    await expect(readSavedAppearance()).resolves.toBe("base");
    getAppearance.mockRejectedValue(new Error("down"));
    await expect(readSavedAppearance()).resolves.toBe("base");
  });
});

describe("appearanceForRequest", () => {
  it("uses the cookie without reading the database; an unknown cookie means Base", async () => {
    await expect(appearanceForRequest("ocean", true)).resolves.toBe("ocean");
    await expect(appearanceForRequest("neon", true)).resolves.toBe("base");
    expect(getDataContext).not.toHaveBeenCalled();
  });

  it("with no cookie, a signed-in person gets their saved theme (a new device)", async () => {
    getAppearance.mockResolvedValue({ ok: true, data: "terracotta" });
    await expect(appearanceForRequest(undefined, true)).resolves.toBe("terracotta");
  });

  it("with no cookie and nobody signed in, it is Base and nothing is read", async () => {
    await expect(appearanceForRequest(undefined, false)).resolves.toBe("base");
    expect(getDataContext).not.toHaveBeenCalled();
  });
});
