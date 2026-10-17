import { describe, expect, it } from "vitest";
import { classifyTrip } from "@/domain/trip-lifecycle";
import { packedTotals } from "@/domain/readiness";
import { sampleLifecycleState, SAMPLE_LOCATIONS } from "./fixtures";

describe("sample fixtures", () => {
  const state = sampleLifecycleState();
  const byId = (id: string) => state.trips.find((trip) => trip.id === id)!;

  it("has San Diego (upcoming, partly packed) and Lisbon (past, fully packed and Ready)", () => {
    expect(state.trips.map((trip) => trip.id)).toEqual(["san-diego", "lisbon"]);
    expect(classifyTrip(byId("san-diego"), "2026-10-16")).toBe("upcoming");
    expect(classifyTrip(byId("lisbon"), "2026-10-16")).toBe("past");
    const lisbon = byId("lisbon");
    expect(lisbon.ready).toBe(true);
    expect(lisbon.toiletryBagPacked).toBe(true);
    expect(packedTotals(lisbon).packed).toBe(packedTotals(lisbon).total);
  });

  it("packs a few San Diego items, with two of three underwear done and the rest untouched", () => {
    const sanDiego = byId("san-diego");
    expect(sanDiego.ready).toBe(false);
    expect(sanDiego.items.find((item) => item.id === "underwear")?.packed).toBe(2);
    expect(sanDiego.items.find((item) => item.id === "socks")?.packed).toBe(1);
    expect(sanDiego.items.find((item) => item.id === "nice-top")?.packed).toBe(0);
  });

  it("starts with no deleted trips and no draft", () => {
    expect(state.deletedTrips).toEqual([]);
    expect(state.draft).toBeNull();
  });

  it("returns a fresh state each time so callers cannot share mutations", () => {
    expect(sampleLifecycleState()).not.toBe(state);
    expect(sampleLifecycleState()).toEqual(state);
  });

  it("uses only the curated location shape", () => {
    expect(Object.keys(SAMPLE_LOCATIONS)).toEqual(["us-ca-san-diego", "pt-lisbon"]);
    expect(byId("san-diego").location).toEqual(SAMPLE_LOCATIONS["us-ca-san-diego"]);
  });
});
