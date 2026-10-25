// Test helpers: build and persist synthetic trips (fictional places and dates), and make a DataContext.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTripItems, SYNTHETIC_STAPLES } from "../../../domain/calc";
import type { TripConfig } from "../../../domain/trip";
import { createFakeAuth, type FakeAuth } from "../../auth/__fixtures__/fake-auth";
import { parseAllowlist } from "../../auth/allowlist";
import { loadMigrations, migrateUp } from "../../db/migrator";
import { MIGRATIONS_DIR } from "../../db/__fixtures__/db";
import type { Db } from "../../db/retention";
import * as schema from "../../db/schema";
import type { DataContext } from "../context";
import { insertTrip, type StoredTrip } from "../trip-store";

export const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 2,
  reuseNice: false,
  returnOutfit: true,
};

export const OWNER = { userId: "owner-a", email: "owner@example.test" };
export const OTHER_OWNER = { userId: "owner-b", email: "second@example.test" };

let counter = 0;
export const newUuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/** A synthetic, fully-formed trip. Fictional destination and dates. */
export function makeStoredTrip(overrides: Partial<StoredTrip> = {}): StoredTrip {
  const start = overrides.start ?? "2030-04-01";
  const end = overrides.end ?? "2030-04-08";
  const config = overrides.config ?? CONFIG;
  const built = buildTripItems({ ...config, start, end }, SYNTHETIC_STAPLES);
  return {
    id: newUuid(),
    destination: "Sampleton",
    locationId: "sample-a",
    locationLabel: "Sampleton, Sample Region, Sampleland",
    start,
    end,
    stops: [
      {
        location: {
          id: "sample-a",
          city: "Sampleton",
          region: "",
          country: "",
          countryCode: "",
          label: "Sampleton, Sample Region, Sampleland",
        },
        arrive: start,
        leave: end,
      },
    ],
    config,
    days: built.days,
    dailyDays: built.dailyDays,
    items: built.items.filter((entry) => entry.qty > 0),
    suggestionMemory: {},
    suppressedSuggestions: {},
    toiletryBagPacked: false,
    ready: false,
    weather: { status: "pending", label: "Seasonal outlook", suggestion: "Compact umbrella" },
    copiedFrom: null,
    archived: false,
    theme: "travel",
    deletedAt: null,
    ...overrides,
  };
}

export async function seedOwner(db: Db, ownerId: string): Promise<void> {
  await db.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();
}

export async function seedTrip(
  db: Db,
  ownerId: string,
  overrides: Partial<StoredTrip> = {},
): Promise<StoredTrip> {
  await seedOwner(db, ownerId);
  const trip = makeStoredTrip(overrides);
  await insertTrip(db, ownerId, trip);
  return trip;
}

/** The fixed instant used by tests: 2030-03-10, so trips in April 2030 are upcoming. */
export const NOW = new Date("2030-03-10T12:00:00.000Z");

export function makeContext(db: Db, fake: FakeAuth, now: Date = NOW): DataContext {
  return {
    db,
    auth: { provider: fake, allowlist: parseAllowlist(`${OWNER.email}, ${OTHER_OWNER.email}`) },
    now: () => now,
  };
}

export function signedInAs(fake: FakeAuth, user: { userId: string; email: string } | null): void {
  fake.current = user;
}

export { createFakeAuth };

/** A file-backed database, so a test can close it and reopen it ("reconnect") to check durability. */
export async function openDurableDb(): Promise<{
  open: () => Promise<{ client: PGlite; db: Db }>;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "travel-packing-db-"));
  const dataDir = join(dir, "pg");
  let migrated = false;
  return {
    async open() {
      const client = new PGlite(dataDir);
      if (!migrated) {
        await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
        migrated = true;
      }
      return { client, db: drizzle(client, { schema }) as unknown as Db };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
