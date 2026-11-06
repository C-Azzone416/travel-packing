import { beforeEach, describe, expect, it, vi } from "vitest";
import { locationById } from "@/domain/locations";

const { getDataContext, getHomeCity, setHomeCity } = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  getHomeCity: vi.fn(),
  setHomeCity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/data/runtime", () => ({ getDataContext }));
vi.mock("@/server/data/service", () => ({ getHomeCity, setHomeCity }));

import { getHomeCityAction, updateHomeCityAction } from "./home-actions";

const context = { owner: "test" };
const seattle = locationById("us-wa-seattle")!;

describe("home city settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataContext.mockResolvedValue(context);
  });

  it("reads the owner city and saves only a canonical place id", async () => {
    getHomeCity.mockResolvedValue({ ok: true, data: { location: seattle } });
    await expect(getHomeCityAction()).resolves.toEqual({
      ok: true,
      home: { location: seattle },
    });
    expect(getHomeCity).toHaveBeenCalledWith(context);

    setHomeCity.mockResolvedValue({ ok: true, data: { location: seattle } });
    await expect(updateHomeCityAction(seattle)).resolves.toMatchObject({ ok: true });
    expect(setHomeCity).toHaveBeenCalledWith(context, { location: { id: seattle.id } });
  });

  it("clears with null and returns a safe failure when the runtime is unavailable", async () => {
    setHomeCity.mockResolvedValue({ ok: true, data: null });
    await expect(updateHomeCityAction(null)).resolves.toEqual({ ok: true, home: null });
    expect(setHomeCity).toHaveBeenCalledWith(context, { location: null });

    getDataContext.mockResolvedValue(null);
    await expect(getHomeCityAction()).resolves.toEqual({ ok: false, code: "INTERNAL" });
  });

  it.each([
    ["UNAUTHENTICATED", "/sign-in"],
    ["FORBIDDEN", "/access-denied"],
  ] as const)("redirects %s results", async (code, path) => {
    getHomeCity.mockResolvedValue({ ok: false, error: { code } });
    await expect(getHomeCityAction()).rejects.toThrow(`REDIRECT:${path}`);
  });

  it("returns non-auth service failures without leaking details", async () => {
    setHomeCity.mockResolvedValue({ ok: false, error: { code: "INTERNAL" } });
    await expect(updateHomeCityAction(seattle)).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
    });
  });
});
