// Saved lists persistence (#140). Every query is scoped by owner_id, including child-table queries, so another
// owner's list can't be listed, read, applied, changed or deleted. Nothing here touches trip rows (snapshots).

import { and, asc, desc, eq } from "drizzle-orm";
import type { SavedList, SavedListItem } from "../../domain/saved-lists";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { ITEM_CATEGORIES } from "../db/schema";
import { fail } from "./result";
import { refuse } from "./run";

const CATEGORIES: ReadonlySet<string> = new Set(ITEM_CATEGORIES);
type Category = (typeof ITEM_CATEGORIES)[number];

export interface SavedListInput {
  name: string;
  items: SavedListItem[];
}

function validate(input: SavedListInput): void {
  const name = input.name.trim();
  if (name === "" || name.length > 80) refuse(fail("INVALID_INPUT", { fields: ["name"] }));
  const ids = new Set<string>();
  for (const item of input.items) {
    if (
      item.id.trim() === "" ||
      ids.has(item.id) ||
      item.name.trim() === "" ||
      !CATEGORIES.has(item.category) ||
      !Number.isInteger(item.qty) ||
      item.qty < 1
    ) {
      refuse(fail("INVALID_INPUT", { fields: ["items"] }));
    }
    ids.add(item.id);
  }
}

const toItem = (row: typeof schema.savedListItems.$inferSelect): SavedListItem => ({
  id: row.semanticId,
  name: row.name,
  category: row.category,
  qty: row.qty,
});

async function loadItems(db: Db, ownerId: string, listId: string) {
  const rows = await db
    .select()
    .from(schema.savedListItems)
    .where(
      and(eq(schema.savedListItems.listId, listId), eq(schema.savedListItems.ownerId, ownerId)),
    )
    .orderBy(asc(schema.savedListItems.sortOrder), asc(schema.savedListItems.semanticId));
  return rows.map(toItem);
}

/** The owner's lists with their items, oldest first. */
export async function listSavedLists(db: Db, ownerId: string): Promise<SavedList[]> {
  const lists = await db
    .select()
    .from(schema.savedLists)
    .where(eq(schema.savedLists.ownerId, ownerId))
    .orderBy(asc(schema.savedLists.createdAt), asc(schema.savedLists.id));
  const items = await db
    .select()
    .from(schema.savedListItems)
    .where(eq(schema.savedListItems.ownerId, ownerId))
    .orderBy(asc(schema.savedListItems.sortOrder), asc(schema.savedListItems.semanticId));
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    items: items.filter((item) => item.listId === list.id).map(toItem),
  }));
}

/** One of the owner's lists, or NOT_FOUND (also for a list that belongs to someone else). */
export async function getSavedList(db: Db, ownerId: string, listId: string): Promise<SavedList> {
  const [list] = await db
    .select()
    .from(schema.savedLists)
    .where(and(eq(schema.savedLists.id, listId), eq(schema.savedLists.ownerId, ownerId)));
  if (!list) refuse(fail("NOT_FOUND"));
  return { id: list.id, name: list.name, items: await loadItems(db, ownerId, list.id) };
}

/** Several of the owner's lists in the order asked; any id that isn't theirs is NOT_FOUND. For applying to a trip. */
export async function getSavedLists(
  db: Db,
  ownerId: string,
  listIds: readonly string[],
): Promise<SavedList[]> {
  const all = new Map((await listSavedLists(db, ownerId)).map((list) => [list.id, list]));
  return listIds.map((id) => {
    const list = all.get(id);
    if (!list) refuse(fail("NOT_FOUND"));
    return list;
  });
}

function itemValues(ownerId: string, listId: string, items: SavedListItem[]) {
  return items.map((item, index) => ({
    listId,
    ownerId,
    semanticId: item.id,
    name: item.name,
    category: item.category as Category,
    qty: item.qty,
    sortOrder: index,
  }));
}

export async function createSavedList(
  db: Db,
  ownerId: string,
  input: SavedListInput,
): Promise<SavedList> {
  validate(input);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.savedLists)
      .values({ ownerId, name: input.name.trim() })
      .returning({ id: schema.savedLists.id });
    if (input.items.length > 0) {
      await tx.insert(schema.savedListItems).values(itemValues(ownerId, row.id, input.items));
    }
    return row.id;
  });
  return getSavedList(db, ownerId, id);
}

/** Replace a list's name and items. NOT_FOUND for another owner's list. Trips are untouched. */
export async function updateSavedList(
  db: Db,
  ownerId: string,
  listId: string,
  input: SavedListInput,
): Promise<SavedList> {
  validate(input);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.savedLists)
      .set({ name: input.name.trim(), updatedAt: new Date() })
      .where(and(eq(schema.savedLists.id, listId), eq(schema.savedLists.ownerId, ownerId)))
      .returning({ id: schema.savedLists.id });
    if (updated.length === 0) refuse(fail("NOT_FOUND"));
    await tx
      .delete(schema.savedListItems)
      .where(
        and(eq(schema.savedListItems.listId, listId), eq(schema.savedListItems.ownerId, ownerId)),
      );
    if (input.items.length > 0) {
      await tx.insert(schema.savedListItems).values(itemValues(ownerId, listId, input.items));
    }
  });
  return getSavedList(db, ownerId, listId);
}

/** Delete a list and its items. NOT_FOUND for another owner's list. Trips that used it are untouched. */
export async function deleteSavedList(db: Db, ownerId: string, listId: string): Promise<void> {
  const deleted = await db
    .delete(schema.savedLists)
    .where(and(eq(schema.savedLists.id, listId), eq(schema.savedLists.ownerId, ownerId)))
    .returning({ id: schema.savedLists.id });
  if (deleted.length === 0) refuse(fail("NOT_FOUND"));
}

export interface SavedListMeta {
  id: string;
  name: string;
  /** ISO timestamp of the last change to the list or its items. */
  updatedAt: string;
}

/** The owner's lists, newest change first, with when each last changed. Items are loaded separately. */
export async function listSavedListMetas(db: Db, ownerId: string): Promise<SavedListMeta[]> {
  const rows = await db
    .select({
      id: schema.savedLists.id,
      name: schema.savedLists.name,
      updatedAt: schema.savedLists.updatedAt,
    })
    .from(schema.savedLists)
    .where(eq(schema.savedLists.ownerId, ownerId))
    .orderBy(desc(schema.savedLists.updatedAt), asc(schema.savedLists.id));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}
