import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDataContext, getAppearance, getAppDb, readAppearance } = vi.hoisted(() => ({
  getAppDb: vi.fn(),
  readAppearance: vi.fn(),
  getDataContext: vi.fn(),
  getAppearance: vi.fn(),
}));
vi.mock("@/server/data/runtime", () => ({ getDataContext }));
vi.mock("@/server/db/app-db", () => ({ getAppDb }));
vi.mock("@/server/data/appearance-store", () => ({ readAppearance }));
vi.mock("@/server/data/service", () => ({ getAppearance }));

import {
  appearanceForRequest,
  readAppearanceForUser,
  readSavedAppearance,
} from "./saved-appearance";

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

describe("readAppearanceForUser", () => {
  it("reads the account's saved theme by the session's user id", async () => {
    getAppDb.mockResolvedValue({ db: true });
    readAppearance.mockResolvedValue("violet");
    await expect(readAppearanceForUser("u1")).resolves.toBe("violet");
    expect(readAppearance).toHaveBeenCalledWith({ db: true }, "u1");
  });

  it("is undefined without a database or when the read fails", async () => {
    getAppDb.mockResolvedValue(null);
    await expect(readAppearanceForUser("u1")).resolves.toBeUndefined();
    getAppDb.mockResolvedValue({});
    readAppearance.mockRejectedValue(new Error("down"));
    await expect(readAppearanceForUser("u1")).resolves.toBeUndefined();
  });
});

describe("appearanceForRequest", () => {
  it("signed in, uses the mirror without reading the database; an unknown mirror means Base", async () => {
    await expect(appearanceForRequest("ocean", true)).resolves.toBe("ocean");
    await expect(appearanceForRequest("neon", true)).resolves.toBe("base");
    expect(getDataContext).not.toHaveBeenCalled();
  });

  it("signed in with no mirror, gets the saved theme (a new device or just after sign-in)", async () => {
    getAppearance.mockResolvedValue({ ok: true, data: "terracotta" });
    await expect(appearanceForRequest(undefined, true, "violet")).resolves.toBe("terracotta");
  });

  it("signed out, uses the anonymous palette, else Base, ignoring the mirror; nothing is read", async () => {
    await expect(appearanceForRequest(undefined, false, "violet")).resolves.toBe("violet");
    await expect(appearanceForRequest("ocean", false, undefined)).resolves.toBe("base");
    await expect(appearanceForRequest(undefined, false)).resolves.toBe("base");
    expect(getDataContext).not.toHaveBeenCalled();
  });
});
