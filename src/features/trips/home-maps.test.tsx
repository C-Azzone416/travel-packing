import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredTrip } from "@/server/data/trip-store";
import { sampleLifecycleState } from "./fixtures";
import { homeMaps } from "./home-maps";

const getDataContext = vi.fn();
const listTrips = vi.fn();
vi.mock("@/server/data/runtime", () => ({ getDataContext: () => getDataContext() }));
vi.mock("@/server/data/service", () => ({ listTrips: (c: unknown) => listTrips(c) }));

const base = sampleLifecycleState().trips[0];
const stored = (id: string, start: string, end: string, extra: Partial<StoredTrip> = {}) =>
  ({
    ...base,
    id,
    start,
    end,
    stops: [],
    archived: false,
    locationId: "pt-lisbon",
    locationLabel: "Lisbon, Lisbon District, Portugal",
    destination: "Lisbon",
    deletedAt: null,
    ...extra,
  }) as unknown as StoredTrip;

const NOW = new Date("2026-10-16T12:00:00Z");

beforeEach(() => {
  getDataContext.mockReset().mockResolvedValue({});
  listTrips.mockReset();
});

describe("homeMaps", () => {
  it("draws a map for each of the earliest two trips that are not over, with the route it drew", async () => {
    listTrips.mockResolvedValue({
      ok: true,
      data: [
        stored("c", "2027-03-01", "2027-03-05"),
        stored("past", "2026-09-01", "2026-09-05"),
        stored("a", "2026-10-20", "2026-10-25"),
        stored("b", "2026-11-20", "2026-11-25"),
        stored("gone", "2026-10-18", "2026-10-19", { archived: true }),
      ],
    });
    const maps = await homeMaps(NOW);
    expect(Object.keys(maps).sort()).toEqual(["a", "b"]);
    expect(maps.a.signature).toContain('"other"');
    expect(renderToStaticMarkup(<>{maps.a.node}</>)).toContain('aria-label="Route map: Lisbon"');
  });

  it("keeps a trip that ended yesterday by the server's clock (the browser may be a day behind)", async () => {
    listTrips.mockResolvedValue({ ok: true, data: [stored("a", "2026-10-10", "2026-10-15")] });
    expect(Object.keys(await homeMaps(NOW))).toEqual(["a"]);
  });

  it("skips a trip with no place that can be put on the map", async () => {
    listTrips.mockResolvedValue({
      ok: true,
      data: [stored("x", "2026-10-20", "2026-10-25", { locationId: "unknown-place" })],
    });
    expect(await homeMaps(NOW)).toEqual({});
  });

  it("gives no maps, and no error, when the database is not configured, the read fails or it throws", async () => {
    getDataContext.mockResolvedValueOnce(null);
    expect(await homeMaps(NOW)).toEqual({});
    listTrips.mockResolvedValueOnce({ ok: false, error: { code: "INTERNAL" } });
    expect(await homeMaps(NOW)).toEqual({});
    listTrips.mockRejectedValueOnce(new Error("boom"));
    expect(await homeMaps(NOW)).toEqual({});
  });

  it("uses the real clock when none is given", async () => {
    listTrips.mockResolvedValue({ ok: true, data: [] });
    expect(await homeMaps()).toEqual({});
  });
});
