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
    getAppearance.mockResolvedValue({ ok: true, data: "dusk" });
    await expect(readSavedAppearance()).resolves.toBe("dusk");
  });

  it("falls back to Ocean without a database, on an error result or on a throw", async () => {
    getDataContext.mockResolvedValue(null);
    await expect(readSavedAppearance()).resolves.toBe("ocean");
    getDataContext.mockResolvedValue({});
    getAppearance.mockResolvedValue({ ok: false, error: { code: "UNAUTHENTICATED" } });
    await expect(readSavedAppearance()).resolves.toBe("ocean");
    getAppearance.mockRejectedValue(new Error("down"));
    await expect(readSavedAppearance()).resolves.toBe("ocean");
  });
});

describe("readAppearanceForUser", () => {
  it("reads the account's saved theme by the session's user id", async () => {
    getAppDb.mockResolvedValue({ db: true });
    readAppearance.mockResolvedValue("dusk");
    await expect(readAppearanceForUser("u1")).resolves.toBe("dusk");
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
  it("signed in, uses the mirror without reading the database; an unknown mirror means Ocean, an old id is mapped", async () => {
    await expect(appearanceForRequest("ocean", true)).resolves.toBe("ocean");
    await expect(appearanceForRequest("neon", true)).resolves.toBe("ocean");
    await expect(appearanceForRequest("terracotta", true)).resolves.toBe("evergreen");
    expect(getDataContext).not.toHaveBeenCalled();
  });

  it("signed in with no mirror, gets the saved theme (a new device or just after sign-in)", async () => {
    getAppearance.mockResolvedValue({ ok: true, data: "evergreen" });
    await expect(appearanceForRequest(undefined, true, "dusk")).resolves.toBe("evergreen");
  });

  it("signed out, uses the anonymous palette, else Ocean, ignoring the mirror; nothing is read", async () => {
    await expect(appearanceForRequest(undefined, false, "dusk")).resolves.toBe("dusk");
    await expect(appearanceForRequest("evergreen", false, undefined)).resolves.toBe("ocean");
    await expect(appearanceForRequest(undefined, false)).resolves.toBe("ocean");
    expect(getDataContext).not.toHaveBeenCalled();
  });
});
