// Adding a custom item straight into a cube (#385).
import { describe, expect, it } from "vitest";
import { itemCube } from "./cubes";
import { addCustomItem } from "./item-ops";
import type { Trip } from "./trip";

const trip = { items: [], ready: false, toiletryBagPacked: false } as unknown as Trip;
const input = { id: "custom-1", name: "Pillow", category: "Accessories", neededQty: 1 };

describe("addCustomItem with a cube", () => {
  it("puts the item in the cube it was given, whatever its category implies", () => {
    const result = addCustomItem(trip, { ...input, cube: "tech" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.item.cube).toBe("tech");
    expect(itemCube(result.item)).toBe("tech");
  });

  it("leaves the cube to the category when none is given", () => {
    const result = addCustomItem(trip, input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.item.cube).toBeUndefined();
    expect(itemCube(result.item)).toBe("misc");
  });

  it("rejects a cube that does not exist", () => {
    const result = addCustomItem(trip, { ...input, cube: "attic" as never });
    expect(result).toMatchObject({ ok: false, reason: "INVALID_CUBE" });
  });
});
