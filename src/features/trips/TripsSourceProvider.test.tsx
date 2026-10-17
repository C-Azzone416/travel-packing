// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import { TripsSourceProvider, useTripsSource } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const actions = vi.hoisted(() => ({ loadTripsAction: vi.fn() }));
vi.mock("./actions", () => ({
  loadTripsAction: actions.loadTripsAction,
  archiveTripAction: vi.fn(),
  restoreTripAction: vi.fn(),
  removeTripAction: vi.fn(),
  undoRemoveTripAction: vi.fn(),
  createTripAction: vi.fn(),
}));
actions.loadTripsAction.mockResolvedValue({
  ok: true,
  state: { trips: [{ id: "from-the-server" }], deletedTrips: [], draft: null },
});

function Probe({ expected }: { expected?: TripsSource }) {
  const source = useTripsSource();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    void source.load().then((state) => setIds(state.trips.map((trip) => trip.id)));
  }, [source]);
  return (
    <>
      <p>{source === expected ? "injected" : "default"}</p>
      <p aria-label="loaded">{ids.join(",")}</p>
    </>
  );
}

describe("TripsSourceProvider", () => {
  it("throws outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/TripsSourceProvider/);
    spy.mockRestore();
  });

  it("provides the injected source", () => {
    const source = createMemoryTripsSource(sampleLifecycleState(), { now: () => 1 });
    render(
      <TripsSourceProvider source={source}>
        <Probe expected={source} />
      </TripsSourceProvider>,
    );
    expect(screen.getByText("injected")).toBeTruthy();
  });

  it("falls back to a source that reads and writes through the server actions", async () => {
    render(
      <TripsSourceProvider>
        <Probe />
      </TripsSourceProvider>,
    );
    expect(screen.getByText("default")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("loaded").textContent).toBe("from-the-server"),
    );
    expect(actions.loadTripsAction).toHaveBeenCalledTimes(1);
  });
});
