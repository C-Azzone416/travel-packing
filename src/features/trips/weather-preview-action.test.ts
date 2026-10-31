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

  it("accepts a stop at the span cap and refuses one day more, before any auth or provider work", async () => {
    const atCap = { ...stop, arrive: "2026-01-01", leave: "2027-02-05" };
    await expect(previewWeatherAction([atCap])).resolves.toMatchObject({ kind: "ready" });
    fakes.getDataContext.mockClear();
    const over = { ...stop, arrive: "2026-01-01", leave: "2027-02-06" };
    await expect(previewWeatherAction([over])).resolves.toEqual({ kind: "unavailable" });
    await expect(
      previewWeatherAction([{ ...stop, arrive: "2026-01-01", leave: "9999-12-31" }]),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(fakes.getDataContext).not.toHaveBeenCalled();
  });

  describe("input bounds", () => {
    const rejected = async (stops: unknown[]) => {
      vi.clearAllMocks();
      await expect(previewWeatherAction(stops as never)).resolves.toEqual({ kind: "unavailable" });
      // Nothing past the schema ran: no context, no auth, no settings read, no rate-limit use, no provider call.
      expect(fakes.getDataContext).not.toHaveBeenCalled();
      expect(fakes.requireOwner).not.toHaveBeenCalled();
      expect(fakes.readWeatherSettings).not.toHaveBeenCalled();
      expect(fakes.consume).not.toHaveBeenCalled();
      expect(fakes.getStopWeather).not.toHaveBeenCalled();
    };
    const accepted = async (stops: unknown[]) => {
      vi.clearAllMocks();
      fakes.getDataContext.mockResolvedValue({ db: {}, auth: { provider: {}, allowlist: {} } });
      fakes.requireOwner.mockResolvedValue({ userId: "owner" });
      fakes.readWeatherSettings.mockResolvedValue({ weatherOptIn: true, temperatureUnit: "F" });
      fakes.consume.mockReturnValue({ ok: true });
      fakes.getStopWeather.mockResolvedValue({ stopIndex: 0, status: "ok", days: [] });
      await expect(previewWeatherAction(stops as never)).resolves.toMatchObject({ kind: "ready" });
      expect(fakes.getStopWeather).toHaveBeenCalledTimes(stops.length);
    };
    const withIndex = (stopIndex: number) => ({ ...stop, stopIndex });

    it("takes 1 to 6 stops and refuses none and seven", async () => {
      await accepted([stop]);
      await accepted([0, 1, 2, 3, 4, 5].map(withIndex));
      await rejected([]);
      await rejected([0, 1, 2, 3, 4, 5, 5].map(withIndex));
    });

    it("takes a latitude of exactly ±90 and refuses anything past it", async () => {
      await accepted([{ ...stop, latitude: 90 }]);
      await accepted([{ ...stop, latitude: -90 }]);
      await rejected([{ ...stop, latitude: 90.01 }]);
      await rejected([{ ...stop, latitude: -90.01 }]);
    });

    it("takes a longitude of exactly ±180 and refuses anything past it", async () => {
      await accepted([{ ...stop, longitude: 180 }]);
      await accepted([{ ...stop, longitude: -180 }]);
      await rejected([{ ...stop, longitude: 180.01 }]);
      await rejected([{ ...stop, longitude: -180.01 }]);
    });

    it("refuses a stop index below 0 or above 5, and a fractional one, and takes 0 and 5", async () => {
      await accepted([withIndex(0)]);
      await accepted([withIndex(5)]);
      await rejected([withIndex(-1)]);
      await rejected([withIndex(6)]);
      await rejected([withIndex(1.5)]);
    });

    it("refuses a non-finite coordinate and a malformed date", async () => {
      await rejected([{ ...stop, latitude: Number.NaN }]);
      await rejected([{ ...stop, longitude: Number.POSITIVE_INFINITY }]);
      await rejected([{ ...stop, arrive: "2026-1-2" }]);
    });
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
    expect(fakes.getStopWeather).toHaveBeenCalledWith(stop, {
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("passes only a device date within a day of the server's, else the server's date (#361)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    try {
      await previewWeatherAction([stop], "2026-11-13");
      await previewWeatherAction([stop], "2026-11-20");
      await previewWeatherAction([stop], "not a date");
      await previewWeatherAction([stop]);
    } finally {
      vi.useRealTimers();
    }
    expect(fakes.getStopWeather.mock.calls.map(([, options]) => options)).toEqual([
      { today: "2026-11-13" },
      { today: "2026-11-12" },
      { today: "2026-11-12" },
      { today: "2026-11-12" },
    ]);
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

  it("no context at all is unavailable", async () => {
    fakes.getDataContext.mockResolvedValue(null);
    await expect(previewWeatherAction([stop])).resolves.toEqual({ kind: "unavailable" });
  });

  it("sends a signed-out or unlisted person away, and calls no provider", async () => {
    const { AuthFailure } = await import("@/server/auth/guard");
    fakes.requireOwner.mockRejectedValue(new AuthFailure("UNAUTHENTICATED" as never));
    await previewWeatherAction([stop]);
    expect(fakes.redirect).toHaveBeenCalledWith(expect.stringContaining("sign-in"));
    fakes.requireOwner.mockRejectedValue(new AuthFailure("FORBIDDEN" as never));
    await previewWeatherAction([stop]);
    expect(fakes.redirect).toHaveBeenLastCalledWith(expect.stringContaining("access-denied"));
    expect(fakes.getStopWeather).not.toHaveBeenCalled();
  });

  it("an unexpected failure is unavailable, with nothing leaked", async () => {
    fakes.readWeatherSettings.mockRejectedValue(new Error("database detail"));
    await expect(previewWeatherAction([stop])).resolves.toEqual({ kind: "unavailable" });
    expect(fakes.redirect).not.toHaveBeenCalled();
  });

  it("returns unavailable when rate limited", async () => {
    fakes.consume.mockReturnValue({ ok: false, retryAfterMs: 1_000 });
    await expect(previewWeatherAction([stop])).resolves.toEqual({ kind: "unavailable" });
    expect(fakes.getStopWeather).not.toHaveBeenCalled();
  });
});
