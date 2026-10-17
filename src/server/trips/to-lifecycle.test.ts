import { describe, expect, it } from "vitest";
import { makeStoredTrip } from "../data/__fixtures__/seed";
import { locationFromStored, toLifecycleState, toLifecycleTrip } from "./to-lifecycle";

const stored = (over: Parameters<typeof makeStoredTrip>[0] = {}) => makeStoredTrip(over);

describe("locationFromStored", () => {
  it.each([
    [
      "San Diego",
      "San Diego, California, United States",
      { region: "California", country: "United States" },
    ],
    [
      "Lisbon",
      "Lisbon, Lisbon District, Portugal",
      { region: "Lisbon District", country: "Portugal" },
    ],
    ["London", "London, England, United Kingdom", { region: "England", country: "United Kingdom" }],
    [
      "Springfield",
      "Springfield, Sangamon County, Illinois, United States",
      { region: "Sangamon County, Illinois", country: "United States" },
    ],
    ["Paris", "Paris, France", { region: "France", country: "" }],
    ["Paris", "Paris", { region: "", country: "" }],
  ])("%s <- %s", (city, label, expected) => {
    const location = locationFromStored({
      destination: city,
      locationId: "id-1",
      locationLabel: label,
    });
    expect(location).toMatchObject({ id: "id-1", city, label, ...expected });
  });

  it("is null for a trip with no confirmed location", () => {
    expect(
      locationFromStored({ destination: "Custom", locationId: null, locationLabel: null }),
    ).toBeNull();
  });

  it("falls back to the destination when there is an id but no label", () => {
    expect(
      locationFromStored({ destination: "Lisbon", locationId: "pt-lisbon", locationLabel: null }),
    ).toMatchObject({
      label: "Lisbon",
      region: "",
      country: "",
    });
  });

  it("a label that does not start with the destination is kept whole, with no region or country guessed", () => {
    expect(
      locationFromStored({
        destination: "Home",
        locationId: "x",
        locationLabel: "Somewhere else entirely",
      }),
    ).toMatchObject({ label: "Somewhere else entirely", region: "", country: "" });
  });
});

describe("toLifecycleTrip", () => {
  it("keeps the domain fields and drops the storage-only ones", () => {
    const trip = stored({
      destination: "San Diego",
      locationId: "us-ca-san-diego",
      locationLabel: "San Diego, California, United States",
      archived: true,
      copiedFrom: "src-1",
    });
    const lifecycle = toLifecycleTrip(trip);
    expect(lifecycle).toMatchObject({
      id: trip.id,
      destination: "San Diego",
      archived: true,
      copiedFrom: "src-1",
      start: trip.start,
      end: trip.end,
      ready: false,
      location: { id: "us-ca-san-diego", region: "California", country: "United States" },
    });
    expect(lifecycle).not.toHaveProperty("locationId");
    expect(lifecycle).not.toHaveProperty("locationLabel");
    expect(lifecycle).not.toHaveProperty("deletedAt");
    expect(lifecycle.items).toBe(trip.items);
  });
});

describe("toLifecycleState", () => {
  it("builds the dashboard state: live trips, recently deleted with a numeric deletedAt, no draft", () => {
    const live = stored({ destination: "Live" });
    const gone = stored({ destination: "Gone", deletedAt: new Date("2030-03-10T12:00:00Z") });
    const state = toLifecycleState([live], [gone]);
    expect(state.draft).toBeNull();
    expect(state.trips.map((trip) => trip.destination)).toEqual(["Live"]);
    expect(state.deletedTrips).toEqual([
      {
        trip: expect.objectContaining({ destination: "Gone" }),
        deletedAt: Date.parse("2030-03-10T12:00:00Z"),
      },
    ]);
  });

  it("is empty for an owner with nothing", () => {
    expect(toLifecycleState([], [])).toEqual({ trips: [], deletedTrips: [], draft: null });
  });

  it("a deleted trip with no timestamp gets 0 rather than crashing", () => {
    const state = toLifecycleState([], [stored({ deletedAt: null })]);
    expect(state.deletedTrips[0].deletedAt).toBe(0);
  });
});
