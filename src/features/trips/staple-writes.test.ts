import { describe, expect, it } from "vitest";
import type { Staple, StapleRevision } from "@/domain/calc/staples";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource } from "./trips-source";

const scarf: Staple = {
  id: "scarf",
  name: "Scarf",
  category: "Accessories",
  qty: 1,
  cadence: "per trip",
  packLast: false,
};
const create = () =>
  createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    staples: [scarf, { ...scarf, id: "hat", name: "Hat" }],
  });
const read = async (source: ReturnType<typeof create>, id = "scarf") =>
  (await source.listStaples()).find((row) => row.id === id)!;

describe("direct memory Staples revision contract", () => {
  it("retains physical identity, advances content changes, and preserves matching no-ops", async () => {
    const source = create();
    const first = await read(source);
    expect(first.revision).toEqual({ rowId: expect.stringMatching(/^[0-9a-f-]{36}$/), version: 1 });
    expect(await read(source)).toEqual(first);
    const changed = (await source.upsertStaple({ ...first, qty: 3 }, first.revision!)).find(
      (row) => row.id === first.id,
    )!;
    expect(changed).toEqual({ ...first, qty: 3, revision: { ...first.revision!, version: 2 } });
    expect(await source.upsertStaple(changed, changed.revision!)).toEqual(
      await source.listStaples(),
    );
    expect((await read(source)).revision).toEqual(changed.revision);
  });
  it.each([
    undefined,
    {},
    { rowId: "bad", version: 1 },
    { rowId: "00000000-0000-f000-0000-000000000001", version: 1 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 0 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 1.5 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 2147483648 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 1, extra: true },
  ])("rejects malformed/missing expectation %j without mutation", async (expected) => {
    const source = create();
    const before = await source.listStaples();
    await expect(
      source.upsertStaple({ ...scarf, qty: 9 }, expected as StapleRevision),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(source.removeStaple(scarf.id, expected as StapleRevision)).rejects.toThrow(
      "INVALID_INPUT",
    );
    expect(await source.listStaples()).toEqual(before);
  });
  it("preserves revisions for equivalent omitted/explicit optional values", async () => {
    const source = create();
    const before = await source.listStaples();
    const first = before[0];
    expect(
      await source.upsertStaple({ ...first, laundryHalves: false, cube: "misc" }, first.revision!),
    ).toEqual(before);
    expect(await source.listStaples()).toEqual(before);
  });
  it("rejects missing expectation on a new row without creating it", async () => {
    const source = create();
    const before = await source.listStaples();
    await expect(source.upsertStaple({ ...scarf, id: "new" }, undefined as never)).rejects.toThrow(
      "INVALID_INPUT",
    );
    expect(await source.listStaples()).toEqual(before);
  });
  it("distinguishes explicit absence from missing metadata for both commands", async () => {
    const source = create();
    const before = await source.listStaples();
    await expect(source.upsertStaple(scarf, null)).rejects.toThrow("STALE");
    await expect(source.removeStaple(scarf.id, null)).rejects.toThrow("STALE");
    expect(await source.removeStaple("absent", null)).toEqual(before);
    const created = (await source.upsertStaple({ ...scarf, id: "new" }, null)).find(
      (row) => row.id === "new",
    )!;
    expect(created.revision).toEqual({ rowId: expect.any(String), version: 1 });
  });
  describe.each(["explicit absence", "captured revision"])(
    "%s on a remembered ADD row",
    (expectation) => {
      it.each(["remove", "equal-content upsert", "changed upsert"])(
        "rejects %s without changing Staples or trips",
        async (operation) => {
          const source = createMemoryTripsSource(sampleLifecycleState(), {
            now: () => 1,
            staples: [],
            newId: () => "qa-razor",
          });
          await source.addToiletryItem("san-diego", {
            name: "Razor",
            qty: 1,
            packLast: false,
            scope: "remember",
          });
          const row = (await source.listStaples())[0];
          expect(row).toEqual({
            id: "qa-razor",
            name: "Razor",
            category: "Toiletries",
            qty: 1,
            cadence: "per trip",
            packLast: false,
            groupId: "toiletry-bag",
            revision: { rowId: expect.stringMatching(/^[a-f0-9-]{36}$/), version: 1 },
          });
          // A different row token must not authorize this remembered row.
          const unrelated = (await source.upsertStaple(scarf, null)).find(
            (entry) => entry.id === scarf.id,
          )!;
          const expected = expectation === "explicit absence" ? null : unrelated.revision!;
          const before = await source.listStaples();
          const trips = structuredClone(source.snapshot());
          const attempt =
            operation === "remove"
              ? source.removeStaple(row.id, expected)
              : source.upsertStaple(
                  operation === "changed upsert" ? { ...row, qty: 9 } : row,
                  expected,
                );
          await expect(attempt).rejects.toThrow("STALE");
          expect(await source.listStaples()).toEqual(before);
          expect(source.snapshot()).toEqual(trips);
        },
      );
    },
  );
  it("rejects stale edit, equal-content no-op and removal, preserving all rows", async () => {
    const source = create();
    const old = await read(source);
    await source.upsertStaple({ ...old, qty: 3 }, old.revision!);
    const before = await source.listStaples();
    for (const content of [
      { ...old, packLast: true },
      { ...old, qty: 3 },
    ])
      await expect(source.upsertStaple(content, old.revision!)).rejects.toThrow("STALE");
    await expect(source.removeStaple(old.id, old.revision!)).rejects.toThrow("STALE");
    expect(await source.listStaples()).toEqual(before);
  });
  it("allows an unrelated row's captured intent and preserves the first writer and trip snapshots", async () => {
    const source = create();
    const trips = structuredClone(source.snapshot());
    const [a, b] = await source.listStaples();
    const updated = (await source.upsertStaple({ ...a, qty: 3 }, a.revision!)).find(
      (row) => row.id === a.id,
    )!;
    await source.upsertStaple({ ...b, qty: 2 }, b.revision!);
    expect(await read(source, a.id)).toEqual(updated);
    expect((await read(source, b.id)).qty).toBe(2);
    expect(source.snapshot()).toEqual(trips);
  });
  it("rejects resurrection, repeated deletes and equal-version delete/recreate ABA", async () => {
    const source = create();
    const old = await read(source);
    await source.removeStaple(old.id, old.revision!);
    await expect(source.upsertStaple(old, old.revision!)).rejects.toThrow("STALE");
    await expect(source.removeStaple(old.id, old.revision!)).rejects.toThrow("STALE");
    const recreated = (await source.upsertStaple(scarf, null)).find((row) => row.id === old.id)!;
    expect(recreated.revision!.version).toBe(old.revision!.version);
    expect(recreated.revision!.rowId).not.toBe(old.revision!.rowId);
    const before = await source.listStaples();
    await expect(source.upsertStaple({ ...old, qty: 4 }, old.revision!)).rejects.toThrow("STALE");
    await expect(source.removeStaple(old.id, old.revision!)).rejects.toThrow("STALE");
    expect(await source.listStaples()).toEqual(before);
  });
  it("detaches list, snapshot, write-result and caller expectation tokens", async () => {
    const source = create();
    const old = await read(source);
    const expected = { ...old.revision! };
    const storedRowId = expected.rowId;
    old.revision!.rowId = "mutated";
    source.staplesSnapshot()[0].revision!.version = 999;
    expect((await read(source)).revision).toEqual(expected);
    const result = await source.upsertStaple({ ...scarf, qty: 2 }, expected);
    expected.rowId = "mutated";
    result[0].revision!.version = 999;
    expect((await read(source)).revision).toEqual({ rowId: storedRowId, version: 2 });
    expect((await read(source)).revision!.rowId).not.toBe("mutated");
  });
  it("isolates separate owners and rejects a token from another owner", async () => {
    const a = create();
    const b = create();
    const old = await read(a);
    const before = await b.listStaples();
    await expect(b.upsertStaple({ ...old, qty: 9 }, old.revision!)).rejects.toThrow("STALE");
    await expect(b.removeStaple(old.id, old.revision!)).rejects.toThrow("STALE");
    expect(await b.listStaples()).toEqual(before);
  });
  it("replays the same captured intent/token after a failure and rejects an unknown-commit retry", async () => {
    const source = create();
    const old = await read(source);
    const intended = Object.freeze({ ...old, qty: 2 });
    const expected = Object.freeze({ ...old.revision! });
    let committed = false;
    const write = async () => {
      const result = await source.upsertStaple(intended, expected);
      committed = true;
      throw Object.assign(new Error("response lost"), { result });
    };
    await expect(write()).rejects.toThrow("response lost");
    expect(committed).toBe(true);
    const confirmed = await read(source);
    await source.removeStaple(confirmed.id, confirmed.revision!);
    await expect(write()).rejects.toThrow("STALE");
    expect((await source.listStaples()).some((row) => row.id === old.id)).toBe(false);
  });
});
