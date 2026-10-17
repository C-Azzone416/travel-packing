import { describe, expect, it, vi } from "vitest";
import { emptyLifecycleState } from "@/domain/trip-lifecycle";
import type { LifecycleTrip, TripDraft } from "@/domain/trip-lifecycle";
import type { CreateTripActionResult, TripsActionResult } from "./actions";
import { createServerTripsSource, type TripsActions } from "./server-source";
import { TripsSourceError } from "./trips-source";

const state = emptyLifecycleState();
const ok: TripsActionResult = { ok: true, state };
const trip = { id: "new-trip" } as LifecycleTrip;
const draft = { mode: "create" } as TripDraft;

function actions(result: TripsActionResult = ok) {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn(async (id?: string) => {
      calls.push(id === undefined ? name : `${name}:${id}`);
      return result;
    });
  const fakes = {
    load: record("load"),
    archive: record("archive"),
    restore: record("restore"),
    remove: record("remove"),
    undoRemove: record("undoRemove"),
    create: vi.fn(async (): Promise<CreateTripActionResult> => {
      calls.push("create");
      return result.ok ? { ok: true, trip } : result;
    }),
  };
  return { fakes: fakes as unknown as TripsActions, calls };
}

describe("createServerTripsSource", () => {
  it("passes each call to the matching action and returns the state it gives back", async () => {
    const { fakes, calls } = actions();
    const source = createServerTripsSource(fakes);
    expect(await source.load()).toBe(state);
    expect(await source.archive("a")).toBe(state);
    expect(await source.restore("b")).toBe(state);
    expect(await source.remove("c")).toBe(state);
    expect(await source.undoRemove("d")).toBe(state);
    expect(await source.createTrip(draft)).toBe(trip);
    expect(fakes.create).toHaveBeenCalledWith(draft);
    expect(calls).toEqual(["load", "archive:a", "restore:b", "remove:c", "undoRemove:d", "create"]);
  });

  it.each(["NOT_FOUND", "INTERNAL", "INVALID_INPUT", "REJECTED"] as const)(
    "turns a failed action (%s) into a TripsSourceError carrying only the code",
    async (code) => {
      const { fakes } = actions({ ok: false, code });
      const source = createServerTripsSource(fakes);
      for (const call of [
        () => source.load(),
        () => source.archive("a"),
        () => source.restore("a"),
        () => source.remove("a"),
        () => source.undoRemove("a"),
        () => source.createTrip(draft),
      ]) {
        const error = await call().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TripsSourceError);
        expect((error as Error).message).toBe(code);
      }
    },
  );

  it("propagates a thrown action (for example a network failure) as a rejection", async () => {
    const source = createServerTripsSource({
      ...actions().fakes,
      load: async () => {
        throw new Error("network down");
      },
    });
    await expect(source.load()).rejects.toThrow("network down");
  });
});
