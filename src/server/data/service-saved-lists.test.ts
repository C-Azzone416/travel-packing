// Managing saved lists through the data layer (#167): owner isolation, name uniqueness, item edits and the duplicate
// refusal, on PGlite. Synthetic data only.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import {
  createFakeAuth,
  makeContext,
  makeStoredTrip,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { createSavedList } from "./saved-list-store";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";
import { insertTrip, loadTrip } from "./trip-store";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const context = () => makeContext(db(), fake);
const as = (user: typeof OWNER | null) => signedInAs(fake, user);
const MISSING = "00000000-0000-4000-8000-0000000000ff";

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  await seedOwner(db(), OWNER.userId);
  await seedOwner(db(), OTHER_OWNER.userId);
  setDataLogSink(() => {});
});
afterEach(() => setDataLogSink());
afterAll(async () => {
  await ctx.client.close();
});

function data<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.data;
}
const errorOf = (result: Result<unknown>) => (result.ok ? null : result.error);

const beach = {
  name: "Beach week",
  items: [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "sunscreen", name: "Sunscreen", category: "Toiletries", qty: 1 },
    { id: "hat", name: "Sun hat", category: "Accessories", qty: 1 },
  ],
};
const ski = {
  name: "Ski trip",
  items: [{ id: "gloves", name: "Gloves", category: "Clothing", qty: 1 }],
};

async function seedLists() {
  const first = await createSavedList(db(), OWNER.userId, beach);
  const second = await createSavedList(db(), OWNER.userId, ski);
  return { beach: first, ski: second };
}

describe("listSavedListSummaries", () => {
  it("gives each list's count, categories and when it changed, newest change first", async () => {
    const { beach: b, ski: s } = await seedLists();
    // Touching the older list moves it to the top.
    data(await service.renameSavedList(context(), { listId: b.id, name: "Beach holiday" }));
    const lists = data(await service.listSavedListSummaries(context()));
    expect(lists.map((list) => list.name)).toEqual(["Beach holiday", "Ski trip"]);
    expect(lists[0]).toMatchObject({
      id: b.id,
      itemCount: 3,
      categories: [
        { category: "Accessories", count: 1 },
        { category: "Other essentials", count: 1 },
        { category: "Toiletries", count: 1 },
      ],
    });
    expect(Date.parse(lists[0].updatedAt)).not.toBeNaN();
    expect(lists[1]).toMatchObject({ id: s.id, itemCount: 1 });
  });

  it("is empty for an owner with no lists, and never shows another owner's", async () => {
    await seedLists();
    as(OTHER_OWNER);
    expect(data(await service.listSavedListSummaries(context()))).toEqual([]);
  });
});

describe("getSavedListDetail", () => {
  it("returns the list with its items in order", async () => {
    const { beach: b } = await seedLists();
    const detail = data(await service.getSavedListDetail(context(), { listId: b.id }));
    expect(detail.name).toBe("Beach week");
    expect(detail.items.map((item) => item.id)).toEqual(["towel", "sunscreen", "hat"]);
  });

  it("is NOT_FOUND for a missing list and for another owner's, INVALID_INPUT for a malformed id", async () => {
    const { beach: b } = await seedLists();
    expect(errorOf(await service.getSavedListDetail(context(), { listId: MISSING }))?.code).toBe(
      "NOT_FOUND",
    );
    as(OTHER_OWNER);
    expect(errorOf(await service.getSavedListDetail(context(), { listId: b.id }))?.code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await service.getSavedListDetail(context(), { listId: "nope" }))?.code).toBe(
      "INVALID_INPUT",
    );
  });
});

describe("renameSavedList", () => {
  it("renames, trims, and keeps the items", async () => {
    const { beach: b } = await seedLists();
    const renamed = data(
      await service.renameSavedList(context(), { listId: b.id, name: "  Lake week " }),
    );
    expect(renamed.name).toBe("Lake week");
    expect(renamed.items).toHaveLength(3);
  });

  it("refuses a name another list already has (case, accents and spaces ignored) with NAME_TAKEN", async () => {
    const { beach: b } = await seedLists();
    for (const name of ["Ski trip", "ski  TRIP", " SKÍ trip "]) {
      expect(
        errorOf(await service.renameSavedList(context(), { listId: b.id, name })),
      ).toMatchObject({
        code: "REJECTED",
        reason: "NAME_TAKEN",
      });
    }
    // Its own name is fine (renaming only the case), and another owner's lists don't count.
    expect(
      data(await service.renameSavedList(context(), { listId: b.id, name: "BEACH WEEK" })).name,
    ).toBe("BEACH WEEK");
    as(OTHER_OWNER);
    const theirs = await createSavedList(db(), OTHER_OWNER.userId, { name: "Mine", items: [] });
    expect(
      data(await service.renameSavedList(context(), { listId: theirs.id, name: "Ski trip" })).name,
    ).toBe("Ski trip");
  });

  it.each([
    ["blank", "   "],
    ["over 60 characters", "x".repeat(61)],
  ])("refuses a name that is %s with INVALID_INPUT on name", async (_label, name) => {
    const { beach: b } = await seedLists();
    expect(errorOf(await service.renameSavedList(context(), { listId: b.id, name }))).toMatchObject(
      {
        code: "INVALID_INPUT",
        fields: ["name"],
      },
    );
  });

  it("is NOT_FOUND for another owner's list and changes nothing", async () => {
    const { beach: b } = await seedLists();
    as(OTHER_OWNER);
    expect(
      errorOf(await service.renameSavedList(context(), { listId: b.id, name: "Stolen" }))?.code,
    ).toBe("NOT_FOUND");
    as(OWNER);
    expect(data(await service.getSavedListDetail(context(), { listId: b.id })).name).toBe(
      "Beach week",
    );
  });
});

describe("deleteSavedListById", () => {
  it("deletes the list and its items, and leaves trips untouched", async () => {
    const { beach: b } = await seedLists();
    const trip = makeStoredTrip({ destination: "Made from a list" });
    await insertTrip(db(), OWNER.userId, trip);
    const before = JSON.stringify(await loadTrip(db(), OWNER.userId, trip.id));
    expect(data(await service.deleteSavedListById(context(), { listId: b.id }))).toEqual({
      id: b.id,
    });
    expect(errorOf(await service.getSavedListDetail(context(), { listId: b.id }))?.code).toBe(
      "NOT_FOUND",
    );
    expect(
      (await ctx.client.query("SELECT 1 FROM saved_list_items WHERE list_id = $1", [b.id])).rows,
    ).toEqual([]);
    expect(JSON.stringify(await loadTrip(db(), OWNER.userId, trip.id))).toBe(before);
    expect(data(await service.listSavedListSummaries(context()))).toHaveLength(1);
  });

  it("is NOT_FOUND for another owner's or a missing list, and nothing is deleted", async () => {
    const { beach: b } = await seedLists();
    as(OTHER_OWNER);
    expect(errorOf(await service.deleteSavedListById(context(), { listId: b.id }))?.code).toBe(
      "NOT_FOUND",
    );
    as(OWNER);
    expect(errorOf(await service.deleteSavedListById(context(), { listId: MISSING }))?.code).toBe(
      "NOT_FOUND",
    );
    expect(data(await service.listSavedListSummaries(context()))).toHaveLength(2);
  });
});

describe("list items", () => {
  const camera = { name: "Camera", category: "Tech", qty: 2 };

  it("adds an item at the end with a fresh id", async () => {
    const { beach: b } = await seedLists();
    const detail = data(await service.addSavedListItem(context(), { listId: b.id, ...camera }));
    expect(detail.items).toHaveLength(4);
    expect(detail.items.at(-1)).toMatchObject(camera);
    expect(detail.items.at(-1)?.id).toMatch(/^item-/);
  });

  it("refuses an item that is already in the list (normalised name + category) with EXISTS, nothing saved", async () => {
    const { beach: b } = await seedLists();
    for (const name of ["Beach towel", " beach  TOWEL ", "Béach towel"]) {
      expect(
        errorOf(
          await service.addSavedListItem(context(), {
            listId: b.id,
            name,
            category: "Other essentials",
            qty: 1,
          }),
        ),
      ).toMatchObject({ code: "REJECTED", reason: "EXISTS" });
    }
    expect(data(await service.getSavedListDetail(context(), { listId: b.id })).items).toHaveLength(
      3,
    );
    // The same name in another category is a different item.
    expect(
      data(
        await service.addSavedListItem(context(), {
          listId: b.id,
          name: "Beach towel",
          category: "Accessories",
          qty: 1,
        }),
      ).items,
    ).toHaveLength(4);
  });

  it.each([
    ["a blank name", { name: " " }, "name"],
    ["a name over 120 characters", { name: "x".repeat(121) }, "name"],
    ["an unknown category", { category: "Gadgets" }, "category"],
    ["a zero quantity", { qty: 0 }, "qty"],
    ["a quantity over 999", { qty: 1000 }, "qty"],
    ["a fractional quantity", { qty: 1.5 }, "qty"],
  ])("rejects %s as INVALID_INPUT naming the field", async (_label, bad, field) => {
    const { beach: b } = await seedLists();
    expect(
      errorOf(await service.addSavedListItem(context(), { listId: b.id, ...camera, ...bad })),
    ).toMatchObject({
      code: "INVALID_INPUT",
      fields: [field],
    });
  });

  it("changes an item's name, category and quantity in place, keeping its id and position", async () => {
    const { beach: b } = await seedLists();
    const detail = data(
      await service.updateSavedListItem(context(), {
        listId: b.id,
        itemId: "sunscreen",
        name: "Sunscreen SPF 50",
        category: "Bathroom",
        qty: 3,
      }),
    );
    expect(detail.items.map((item) => item.id)).toEqual(["towel", "sunscreen", "hat"]);
    expect(detail.items[1]).toEqual({
      id: "sunscreen",
      name: "Sunscreen SPF 50",
      category: "Bathroom",
      qty: 3,
    });
  });

  it("lets an item keep its own name when only the quantity changes, but refuses a clash with another item", async () => {
    const { beach: b } = await seedLists();
    const same = {
      listId: b.id,
      itemId: "towel",
      name: "Beach towel",
      category: "Other essentials",
      qty: 5,
    };
    expect(data(await service.updateSavedListItem(context(), same)).items[0].qty).toBe(5);
    expect(
      errorOf(
        await service.updateSavedListItem(context(), {
          ...same,
          itemId: "hat",
          name: "beach towel",
        }),
      ),
    ).toMatchObject({ code: "REJECTED", reason: "EXISTS" });
    expect(
      errorOf(await service.updateSavedListItem(context(), { ...same, itemId: "nope" }))?.code,
    ).toBe("NOT_FOUND");
  });

  it("removes an item, and NOT_FOUND for one that isn't there", async () => {
    const { beach: b } = await seedLists();
    const detail = data(
      await service.removeSavedListItem(context(), { listId: b.id, itemId: "towel" }),
    );
    expect(detail.items.map((item) => item.id)).toEqual(["sunscreen", "hat"]);
    expect(
      errorOf(await service.removeSavedListItem(context(), { listId: b.id, itemId: "towel" }))
        ?.code,
    ).toBe("NOT_FOUND");
  });

  it("touches only the owner's own lists: another owner gets NOT_FOUND on every item call and nothing changes", async () => {
    const { beach: b } = await seedLists();
    as(OTHER_OWNER);
    for (const result of [
      await service.addSavedListItem(context(), { listId: b.id, ...camera }),
      await service.updateSavedListItem(context(), { listId: b.id, itemId: "towel", ...camera }),
      await service.removeSavedListItem(context(), { listId: b.id, itemId: "towel" }),
    ]) {
      expect(errorOf(result)?.code).toBe("NOT_FOUND");
    }
    as(OWNER);
    expect(data(await service.getSavedListDetail(context(), { listId: b.id })).items).toHaveLength(
      3,
    );
  });

  it("moves the list to the top of the newest-change order", async () => {
    const { beach: b } = await seedLists();
    data(await service.removeSavedListItem(context(), { listId: b.id, itemId: "hat" }));
    expect(data(await service.listSavedListSummaries(context()))[0].id).toBe(b.id);
  });
});
