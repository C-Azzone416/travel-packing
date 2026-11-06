// The in-memory source's cube commands (#385): add into a cube, move, Morning of; and several packed counts at once (#386).
import { describe, expect, it } from "vitest";
import { itemCube } from "@/domain/cubes";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, TripsSourceError } from "./trips-source";

const source = () =>
  createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => "new-1",
    today: () => "2026-10-16",
  });

describe("createMemoryTripsSource: cubes", () => {
  it("adds an item into the given cube", async () => {
    const memory = source();
    const { trip } = await memory.addItem("san-diego", {
      name: "Pillow",
      category: "Accessories",
      neededQty: 1,
      cube: "tech",
    });
    expect(itemCube(trip.items.find((entry) => entry.name === "Pillow")!)).toBe("tech");
  });

  it("moves an item to another cube and keeps its packed count", async () => {
    const memory = source();
    const before = (await memory.getTrip("san-diego")).items.find((e) => e.id === "underwear")!;
    const { trip } = await memory.moveItemToCube("san-diego", "underwear", "misc");
    const moved = trip.items.find((entry) => entry.id === "underwear")!;
    expect(itemCube(moved)).toBe("misc");
    expect(moved.packed).toBe(before.packed);
  });

  it("says NOT_FOUND for a missing item and INVALID_INPUT for a cube that does not exist", async () => {
    const memory = source();
    await expect(memory.moveItemToCube("san-diego", "nope", "tech")).rejects.toEqual(
      new TripsSourceError("NOT_FOUND"),
    );
    await expect(memory.moveItemToCube("san-diego", "tops", "attic" as never)).rejects.toEqual(
      new TripsSourceError("INVALID_INPUT"),
    );
  });

  it("flags and unflags a cube Morning of", async () => {
    const memory = source();
    expect((await memory.setMorningOf("san-diego", "tech", true)).trip.morningOfCubes).toContain(
      "tech",
    );
    expect(
      (await memory.setMorningOf("san-diego", "tech", false)).trip.morningOfCubes,
    ).not.toContain("tech");
  });

  it("sets several packed counts as one change, and none when one item is unknown", async () => {
    const memory = source();
    const { trip } = await memory.setPackedMany("san-diego", [
      { itemId: "tops", packed: 4 },
      { itemId: "underwear", packed: 5 },
    ]);
    expect(trip.items.find((entry) => entry.id === "tops")?.packed).toBe(4);
    expect(trip.items.find((entry) => entry.id === "underwear")?.packed).toBe(5);
    const before = JSON.stringify(memory.snapshot());
    await expect(
      memory.setPackedMany("san-diego", [
        { itemId: "socks", packed: 5 },
        { itemId: "nope", packed: 1 },
      ]),
    ).rejects.toBeInstanceOf(TripsSourceError);
    expect(JSON.stringify(memory.snapshot())).toBe(before);
  });
});
