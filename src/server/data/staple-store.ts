// Staples persistence. Staples are independently versioned future-trip defaults; nothing here touches trip rows.

import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_STAPLES } from "../../domain/calc";
import type { Staple } from "../../domain/trip";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { ITEM_CATEGORIES } from "../db/schema";
import { fail } from "./result";
import { refuse } from "./run";

const CATEGORIES: ReadonlySet<string> = new Set(ITEM_CATEGORIES);

type StapleRow = typeof schema.staples.$inferSelect;

function toStaple(row: StapleRow): Staple {
  const staple: Staple = {
    id: row.semanticId,
    name: row.name,
    category: row.category,
    qty: row.qty,
    cadence: row.cadence,
    packLast: row.packLast,
  };
  if (row.groupId) staple.groupId = row.groupId;
  return staple;
}

/** The owner's staples. With `lock`, the rows are locked until the transaction ends (read-modify-write callers). */
export async function listStaples(
  db: Db,
  ownerId: string,
  options: { lock?: boolean } = {},
): Promise<Staple[]> {
  const query = db
    .select()
    .from(schema.staples)
    .where(eq(schema.staples.ownerId, ownerId))
    .orderBy(schema.staples.createdAt, schema.staples.semanticId);
  const rows = await (options.lock ? query.for("update") : query);
  return rows.map(toStaple);
}

function sameStaple(a: Staple, b: Staple): boolean {
  return (
    a.name === b.name &&
    a.category === b.category &&
    a.qty === b.qty &&
    a.cadence === b.cadence &&
    a.packLast === b.packLast &&
    (a.groupId ?? null) === (b.groupId ?? null)
  );
}

/**
 * Make the owner's stored staples equal `next`: new ones are inserted, changed ones are updated with their
 * version bumped, missing ones are deleted. Trip rows are never touched (snapshots).
 */
export async function saveStaples(db: Db, ownerId: string, next: Staple[]): Promise<void> {
  const badCategory = next.find((staple) => !CATEGORIES.has(staple.category));
  if (badCategory) refuse(fail("INVALID_INPUT", { fields: ["staples.category"] }));

  await db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.staples).where(eq(schema.staples.ownerId, ownerId));
    const current = new Map(rows.map((row) => [row.semanticId, row]));
    const keep = new Set(next.map((staple) => staple.id));

    const removed = rows.filter((row) => !keep.has(row.semanticId)).map((row) => row.id);
    if (removed.length > 0) {
      await tx
        .delete(schema.staples)
        .where(and(inArray(schema.staples.id, removed), eq(schema.staples.ownerId, ownerId)));
    }

    for (const staple of next) {
      const existing = current.get(staple.id);
      if (existing && sameStaple(toStaple(existing), staple)) continue;
      const values = {
        name: staple.name,
        category: staple.category as (typeof ITEM_CATEGORIES)[number],
        qty: staple.qty,
        cadence: staple.cadence,
        packLast: staple.packLast,
        groupId: staple.groupId ?? null,
      };
      if (existing) {
        await tx
          .update(schema.staples)
          .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
          .where(and(eq(schema.staples.id, existing.id), eq(schema.staples.ownerId, ownerId)));
      } else {
        await tx.insert(schema.staples).values({ ownerId, semanticId: staple.id, ...values });
      }
    }
  });
}

/**
 * First use only: give an owner with no staples the prototype's defaults. Idempotent and never overwrites or
 * re-adds anything: once the owner has any staples (even after deleting some defaults), nothing is seeded.
 */
export async function ensureDefaultStaples(db: Db, ownerId: string): Promise<void> {
  const existing = await db
    .select({ id: schema.staples.id })
    .from(schema.staples)
    .where(eq(schema.staples.ownerId, ownerId))
    .limit(1);
  if (existing.length > 0) return;
  await db
    .insert(schema.staples)
    .values(
      DEFAULT_STAPLES.map((staple) => ({
        ownerId,
        semanticId: staple.id,
        name: staple.name,
        category: staple.category as (typeof ITEM_CATEGORIES)[number],
        qty: staple.qty,
        cadence: staple.cadence,
        packLast: staple.packLast,
        groupId: staple.groupId ?? null,
      })),
    )
    .onConflictDoNothing({ target: [schema.staples.ownerId, schema.staples.semanticId] });
}
