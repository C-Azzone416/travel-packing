import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  getDataContext: vi.fn(),
  requireOwner: vi.fn(),
  readWeatherSettings: vi.fn(),
  getStopWeather: vi.fn(),
  consume: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/data/runtime", () => ({ getDataContext: fakes.getDataContext }));
vi.mock("@/server/data/weather-store", () => ({ readWeatherSettings: fakes.readWeatherSettings }));
vi.mock("@/server/weather/provider-config", () => ({
  selectWeatherProvider: () => ({ getStopWeather: fakes.getStopWeather }),
}));
vi.mock("@/server/weather/rate-limit", () => ({
  createWeatherRateLimiter: () => ({ consume: fakes.consume }),
}));
vi.mock("@/server/auth/guard", () => ({
  AuthFailure: class AuthFailure extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  requireOwner: fakes.requireOwner,
}));
vi.mock("next/navigation", () => ({ redirect: fakes.redirect }));

import { previewWeatherAction } from "./weather-preview-action";

const stop = {
  stopIndex: 0,
  arrive: "2026-11-12",
  leave: "2026-11-16",
  includeLeave: true,
  latitude: 38.72,
  longitude: -9.14,
};

describe("previewWeatherAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getDataContext.mockResolvedValue({
      db: {},
      auth: { provider: {}, allowlist: {} },
    });
    fakes.requireOwner.mockResolvedValue({ userId: "owner" });
    fakes.readWeatherSettings.mockResolvedValue({ weatherOptIn: true, temperatureUnit: "F" });
    fakes.consume.mockReturnValue({ ok: true });
    fakes.getStopWeather.mockResolvedValue({
      stopIndex: 0,
      status: "ok",
      days: [],
    });
  });

  it("rejects malformed draft input before auth or provider work", async () => {
    await expect(previewWeatherAction([{ ...stop, latitude: 100 }])).resolves.toEqual({
      kind: "unavailable",
    });
    expect(fakes.getDataContext).not.toHaveBeenCalled();
    expect(fakes.getStopWeather).not.toHaveBeenCalled();
  });

  it("makes no provider call while the owner is opted out", async () => {
    fakes.readWeatherSettings.mockResolvedValue({ weatherOptIn: false, temperatureUnit: "F" });
    await expect(previewWeatherAction([stop])).resolves.toEqual({ kind: "ready", stops: [] });
    expect(fakes.getStopWeather).not.toHaveBeenCalled();
    expect(fakes.consume).not.toHaveBeenCalled();
  });

  it("sends only validated stop coordinates and dates to the provider", async () => {
    await expect(previewWeatherAction([stop])).resolves.toEqual({
      kind: "ready",
      stops: [{ stopIndex: 0, status: "ok", days: [] }],
    });
    expect(fakes.consume).toHaveBeenCalledWith("owner");
    expect(fakes.getStopWeather).toHaveBeenCalledWith(stop);
  });

  it("keeps custom stops and provider failures unavailable without failing the preview", async () => {
    fakes.getStopWeather.mockRejectedValue(new Error("provider detail must stay private"));
    await expect(
      previewWeatherAction([
        { ...stop, includeLeave: false },
        { ...stop, stopIndex: 1, latitude: undefined, longitude: undefined },
      ]),
    ).resolves.toEqual({
      kind: "ready",
      stops: [
        { stopIndex: 0, status: "unavailable", days: [] },
        { stopIndex: 1, status: "unavailable", days: [] },
      ],
    });
    expect(fakes.getStopWeather).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when rate limited", async () => {
    fakes.consume.mockReturnValue({ ok: false, retryAfterMs: 1_000 });
    await expect(previewWeatherAction([stop])).resolves.toEqual({ kind: "unavailable" });
    expect(fakes.getStopWeather).not.toHaveBeenCalled();
  });
});
