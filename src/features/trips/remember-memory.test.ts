import { describe, expect, it } from "vitest";
import { createMemoryTripsSource } from "./trips-source";
import { sampleLifecycleState } from "./fixtures";
import type { StapleRevision } from "@/domain/calc/staples";
const edit = { name: "Wash", qty: 3, timing: "main", scope: "remember" } as const;
async function arrange() {
  let count = 0;
  const source = createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `wash-${++count}`,
    staples: [],
  });
  const result = await source.addToiletryItem("san-diego", {
    name: "Wash",
    qty: 1,
    packLast: false,
    scope: "remember",
  });
  const row = (await source.listStaples())[0];
  return { source, row, expected: structuredClone(row.revision!), result };
}
const state = (source: Awaited<ReturnType<typeof arrange>>["source"]) =>
  structuredClone({ trips: source.snapshot(), staples: source.staplesSnapshot() });
describe("remember-created memory row revision parity", () => {
  it("initializes actual remembered ADD rows as valid direct edit/delete baselines", async () => {
    const { source, row, expected, result } = await arrange();
    expect(expected).toEqual({ rowId: expect.stringMatching(/^[a-f0-9-]{36}$/), version: 1 });
    expect(result.staples).toEqual([row]);
    await expect(source.upsertStaple({ ...row, qty: 2 }, null)).rejects.toThrow("STALE");
    const direct = (await source.upsertStaple({ ...row, qty: 2 }, expected))[0];
    expect(direct.revision).toEqual({ ...expected, version: 2 });
    expect(await source.removeStaple(row.id, direct.revision!)).toEqual([]);
    const recreated = (await source.upsertStaple(row, null))[0];
    expect(recreated.revision!.rowId).not.toBe(expected.rowId);
    expect(recreated.revision!.version).toBe(1);
  });
  it("advances actual changes only, with stable physical identity and detached reads/results", async () => {
    const { source, row, expected, result } = await arrange();
    const changed = await source.editItem("san-diego", row.id, edit, expected);
    const next = changed.staples![0];
    expect(next.revision).toEqual({ ...expected, version: 2 });
    expect((await source.listStaples())[0]).toEqual(next);
    const token = structuredClone(next.revision!);
    const noop = await source.editItem("san-diego", row.id, edit, token);
    expect(noop.staples![0].revision).toEqual(token);
    next.revision!.version = 100;
    result.staples![0].revision!.rowId = "mutated";
    row.revision!.version = 200;
    const read = await source.listStaples();
    read[0].revision!.version = 300;
    const snapshot = source.staplesSnapshot();
    snapshot[0].revision!.rowId = "also mutated";
    expect((await source.listStaples())[0].revision).toEqual(token);
    expect(await source.removeStaple(row.id, token)).toEqual([]);
  });
  it.each(["edit", "remove", "equal-content", "retry"])(
    "rejects stale %s before any memory trip/default mutation",
    async (operation) => {
      const { source, row, expected } = await arrange();
      const intent = Object.freeze({ ...edit });
      const retry = () => source.editItem("san-diego", row.id, intent, expected);
      await retry();
      const before = state(source);
      await expect(
        operation === "remove"
          ? source.removeItem("san-diego", row.id, "remember", expected)
          : operation === "equal-content"
            ? source.editItem("san-diego", row.id, edit, expected)
            : retry(),
      ).rejects.toThrow("STALE");
      expect(state(source)).toEqual(before);
    },
  );
  it("rejects stale resurrection and equal-version ABA, then permits explicitly reviewed absence", async () => {
    const { source, row, expected } = await arrange();
    await source.removeStaple(row.id, expected);
    const absent = state(source);
    await expect(source.editItem("san-diego", row.id, edit, expected)).rejects.toThrow("STALE");
    expect(state(source)).toEqual(absent);
    const created = await source.editItem("san-diego", row.id, edit, null);
    expect(created.staples![0].revision!.version).toBe(1);
    expect(created.staples![0].revision!.rowId).not.toBe(expected.rowId);
    const before = state(source);
    await expect(source.removeItem("san-diego", row.id, "remember", expected)).rejects.toThrow(
      "STALE",
    );
    expect(state(source)).toEqual(before);
  });
  it.each([
    undefined,
    {},
    { rowId: "bad", version: 1 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 0 },
  ])("rejects missing/malformed metadata %j before mutation", async (expected) => {
    const { source, row } = await arrange();
    const before = state(source);
    await expect(
      source.editItem("san-diego", row.id, edit, expected as StapleRevision),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      source.removeItem("san-diego", row.id, "remember", expected as StapleRevision),
    ).rejects.toThrow("INVALID_INPUT");
    expect(state(source)).toEqual(before);
  });
  it("keeps this-trip operations compatible and existing trip snapshots unchanged", async () => {
    const { source, row } = await arrange();
    const before = state(source);
    await source.editItem("san-diego", row.id, { ...edit, scope: "this-trip" });
    await source.removeItem("san-diego", row.id, "this-trip");
    expect(source.staplesSnapshot()).toEqual(before.staples);
    expect(source.snapshot().trips.find((trip) => trip.id === "lisbon")).toEqual(
      before.trips.trips.find((trip) => trip.id === "lisbon"),
    );
  });
});
