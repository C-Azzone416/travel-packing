import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDataContext, getWeatherSettings, updateWeatherSettings } = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  getWeatherSettings: vi.fn(),
  updateWeatherSettings: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/data/runtime", () => ({ getDataContext }));
vi.mock("@/server/data/service", () => ({ getWeatherSettings, updateWeatherSettings }));

import { getWeatherSettingsAction, updateWeatherSettingsAction } from "./weather-actions";

const context = { owner: "test" };

describe("weather settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataContext.mockResolvedValue(context);
  });

  it("returns safe defaults when the data context is unavailable", async () => {
    getDataContext.mockResolvedValue(null);
    await expect(getWeatherSettingsAction()).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
      settings: { weatherOptIn: false, temperatureUnit: "F" },
    });
  });

  it("reads and updates the owner's settings through the service", async () => {
    getWeatherSettings.mockResolvedValue({
      ok: true,
      data: { weatherOptIn: false, temperatureUnit: "F" },
    });
    await expect(getWeatherSettingsAction()).resolves.toMatchObject({ ok: true });
    expect(getWeatherSettings).toHaveBeenCalledWith(context);

    updateWeatherSettings.mockResolvedValue({
      ok: true,
      data: { weatherOptIn: true, temperatureUnit: "C" },
    });
    await expect(updateWeatherSettingsAction({ weatherOptIn: true })).resolves.toEqual({
      ok: true,
      settings: { weatherOptIn: true, temperatureUnit: "C" },
    });
    expect(updateWeatherSettings).toHaveBeenCalledWith(context, { weatherOptIn: true });
  });

  it.each([
    ["UNAUTHENTICATED", "/sign-in"],
    ["FORBIDDEN", "/access-denied"],
  ] as const)("redirects %s results", async (code, path) => {
    getWeatherSettings.mockResolvedValue({ ok: false, error: { code } });
    await expect(getWeatherSettingsAction()).rejects.toThrow(`REDIRECT:${path}`);
  });

  it("returns a non-auth service failure without leaking details", async () => {
    getWeatherSettings.mockResolvedValue({ ok: false, error: { code: "INTERNAL" } });
    await expect(getWeatherSettingsAction()).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
      settings: { weatherOptIn: false, temperatureUnit: "F" },
    });
  });
});
