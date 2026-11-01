import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "./__fixtures__/db";
import { buildTripItems, calculateSuggestions, SYNTHETIC_STAPLES } from "../../domain/calc";
import { THEME_IDS } from "../../domain/themes";
import * as schema from "./schema";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const client = () => ctx.client;

beforeAll(async () => {
  ctx = await createMigratedDb();
});

beforeEach(async () => {
  await resetData(ctx.client);
});

afterAll(async () => {
  await ctx.client.close();
});

type Row = Record<string, unknown>;

async function rows<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await client().query<T>(sql, params)).rows;
}

async function addUser(id: string): Promise<string> {
  await client().query('INSERT INTO "users" ("id") VALUES ($1)', [id]);
  return id;
}

async function addTrip(owner: string, overrides: Row = {}): Promise<string> {
  const row = {
    destination: "Sampleton",
    start_date: "2030-04-01",
    end_date: "2030-04-08",
    days: 8,
    daily_days: 6,
    ...overrides,
  };
  const columns = Object.keys(row);
  const result = await client().query<{ id: string }>(
    `INSERT INTO "trips" ("owner_id", ${columns.map((c) => `"${c}"`).join(", ")})
     VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING "id"`,
    [owner, ...Object.values(row)],
  );
  return result.rows[0].id;
}

async function addItem(tripId: string, owner: string, overrides: Row = {}): Promise<string> {
  const row = {
    semantic_id: "underwear",
    name: "Underwear",
    category: "Clothing",
    qty: 6,
    ...overrides,
  };
  const columns = Object.keys(row);
  const result = await client().query<{ id: string }>(
    `INSERT INTO "trip_items" ("trip_id", "owner_id", ${columns.map((c) => `"${c}"`).join(", ")})
     VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(", ")}) RETURNING "id"`,
    [tripId, owner, ...Object.values(row)],
  );
  return result.rows[0].id;
}

async function addProgress(
  itemId: string,
  tripId: string,
  owner: string,
  qty: number,
  packed: number,
) {
  await client().query(
    'INSERT INTO "trip_item_progress" ("item_id", "trip_id", "owner_id", "qty", "packed") VALUES ($1, $2, $3, $4, $5)',
    [itemId, tripId, owner, qty, packed],
  );
}

async function addStaple(owner: string, overrides: Row = {}): Promise<void> {
  const row = {
    semantic_id: "underwear",
    name: "Underwear",
    category: "Clothing",
    qty: 1,
    cadence: "per day",
    ...overrides,
  };
  const columns = Object.keys(row);
  await client().query(
    `INSERT INTO "staples" ("owner_id", ${columns.map((c) => `"${c}"`).join(", ")})
     VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})`,
    [owner, ...Object.values(row)],
  );
}

describe("check constraints reject invalid rows", () => {
  it.each([
    ["trip_items qty 0", "trip_items_qty_positive", { qty: 0 }],
    ["trip_items qty -2", "trip_items_qty_positive", { qty: -2 }],
    ["blank item name", "trip_items_name_not_blank", { name: "   " }],
    ["unknown item group", "trip_items_group_known", { group_id: "mystery" }],
  ])("%s", async (_name, constraint, overrides) => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    await expect(addItem(trip, owner, overrides)).rejects.toThrow(constraint);
  });

  it.each([
    [
      "end before start",
      "trips_dates_ordered",
      { start_date: "2030-04-05", end_date: "2030-04-04" },
    ],
    ["zero days", "trips_days_positive", { days: 0, daily_days: 0 }],
    ["negative daily days", "trips_daily_days_range", { daily_days: -1 }],
    ["daily days above days", "trips_daily_days_range", { days: 3, daily_days: 4 }],
    ["blank destination", "trips_destination_not_blank", { destination: " " }],
  ])("trips: %s", async (_name, constraint, overrides) => {
    const owner = await addUser("owner-a");
    await expect(addTrip(owner, overrides)).rejects.toThrow(constraint);
  });

  describe("trips: provider location columns (#47)", () => {
    const place = {
      location_provider: "open-meteo",
      location_place_id: "2643743",
      location_region: "England",
      location_country: "United Kingdom",
      location_country_code: "GB",
      latitude: 51.51,
      longitude: -0.13,
      timezone: "Europe/London",
    };

    it.each([
      ["latitude above 90", "trips_latitude_range", { ...place, latitude: 90.01 }],
      ["latitude below -90", "trips_latitude_range", { ...place, latitude: -90.01 }],
      [
        "a latitude that overflows the column",
        "numeric field overflow",
        { ...place, latitude: 1000 },
      ],
      ["longitude above 180", "trips_longitude_range", { ...place, longitude: 180.01 }],
      ["longitude below -180", "trips_longitude_range", { ...place, longitude: -180.01 }],
      ["latitude without longitude", "trips_coordinates_pair", { ...place, longitude: null }],
      ["longitude without latitude", "trips_coordinates_pair", { ...place, latitude: null }],
      [
        "coordinates without a provider",
        "trips_coordinates_need_provider",
        { ...place, location_provider: null, location_place_id: null },
      ],
      [
        "a provider without a place id",
        "trips_provider_pair",
        { ...place, location_place_id: null, latitude: null, longitude: null },
      ],
      [
        "a place id without a provider",
        "trips_provider_pair",
        { ...place, location_provider: null, latitude: null, longitude: null },
      ],
      [
        "a 3-letter country code",
        "trips_country_code_length",
        { ...place, location_country_code: "GBR" },
      ],
      [
        "a 1-letter country code",
        "trips_country_code_length",
        { ...place, location_country_code: "G" },
      ],
    ])("rejects %s", async (_name, constraint, overrides) => {
      const owner = await addUser("owner-a");
      await expect(addTrip(owner, overrides)).rejects.toThrow(constraint);
    });

    it("accepts a full provider place, the coordinate extremes, and a trip with no place at all", async () => {
      const owner = await addUser("owner-a");
      await expect(addTrip(owner, place)).resolves.toBeTruthy();
      await expect(
        addTrip(owner, { ...place, latitude: 90, longitude: 180 }),
      ).resolves.toBeTruthy();
      await expect(
        addTrip(owner, { ...place, latitude: -90, longitude: -180 }),
      ).resolves.toBeTruthy();
      await expect(addTrip(owner, {})).resolves.toBeTruthy();
      await expect(
        addTrip(owner, {
          location_id: "us-ca-san-diego",
          location_label: "San Diego, California, United States",
          location_region: "California",
          location_country: "United States",
          location_country_code: "US",
        }),
      ).resolves.toBeTruthy();
    });

    it("keeps coordinates to 2 decimals even if a caller sends more (the column rounds)", async () => {
      const owner = await addUser("owner-a");
      const id = await addTrip(owner, { ...place, latitude: 51.508539, longitude: -0.125741 });
      const [row] = await rows<{ latitude: string; longitude: string }>(
        'SELECT "latitude", "longitude" FROM "trips" WHERE "id" = $1',
        [id],
      );
      expect([row.latitude, row.longitude]).toEqual(["51.51", "-0.13"]);
    });

    it("existing trips (no place) stay valid with every new column null", async () => {
      const owner = await addUser("owner-a");
      const id = await addTrip(owner, {});
      const [row] = await rows('SELECT * FROM "trips" WHERE "id" = $1', [id]);
      for (const column of Object.keys(place)) expect(row[column], column).toBeNull();
    });
  });

  it("accepts a same-day trip", async () => {
    const owner = await addUser("owner-a");
    await expect(
      addTrip(owner, { start_date: "2030-04-05", end_date: "2030-04-05", days: 1, daily_days: 0 }),
    ).resolves.toBeTruthy();
  });

  it.each([
    ["staple qty 0", "staples_qty_positive", { qty: 0 }],
    ["staple version 0", "staples_version_positive", { version: 0 }],
    ["blank staple name", "staples_name_not_blank", { name: "" }],
    ["unknown staple group", "staples_group_known", { group_id: "mystery" }],
  ])("%s", async (_name, constraint, overrides) => {
    const owner = await addUser("owner-a");
    await expect(addStaple(owner, overrides)).rejects.toThrow(constraint);
  });

  it.each([
    [0, false],
    [1, true],
    [8, true],
    [9, false],
  ])("occasion_count %s accepted=%s", async (count, accepted) => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const insert = client().query(
      'INSERT INTO "trip_preferences" ("trip_id", "owner_id", "occasion_count") VALUES ($1, $2, $3)',
      [trip, owner, count],
    );
    if (accepted) await expect(insert).resolves.toBeTruthy();
    else await expect(insert).rejects.toThrow("trip_preferences_occasion_count_range");
  });

  it.each([
    ["negative packed", -1, "trip_item_progress_packed_range"],
    ["packed above qty", 7, "trip_item_progress_packed_range"],
  ])("progress: %s", async (_name, packed, constraint) => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const item = await addItem(trip, owner, { qty: 6 });
    await expect(addProgress(item, trip, owner, 6, packed)).rejects.toThrow(constraint);
  });

  it("progress accepts the whole 0..qty range", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const zero = await addItem(trip, owner, { semantic_id: "a", qty: 3 });
    const full = await addItem(trip, owner, { semantic_id: "b", qty: 3 });
    await addProgress(zero, trip, owner, 3, 0);
    await addProgress(full, trip, owner, 3, 3);
    expect(await rows("SELECT 1 FROM trip_item_progress")).toHaveLength(2);
  });

  it.each([
    ["category", "item_category", { category: "Gadgets" }],
    ["section", "item_section", { section: "later" }],
  ])("enum rejects unknown %s", async (_name, type, overrides) => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    await expect(addItem(trip, owner, overrides)).rejects.toThrow(type);
  });

  it("a trip's theme defaults to travel and only the six built-in names are accepted", async () => {
    const owner = await addUser("owner-a");
    const plain = await addTrip(owner);
    expect(await rows(`SELECT theme FROM "trips" WHERE id = '${plain}'`)).toEqual([
      { theme: "travel" },
    ]);
    for (const theme of THEME_IDS) await addTrip(owner, { theme });
    await expect(addTrip(owner, { theme: "volcano" })).rejects.toThrow("trip_theme");
    await expect(addTrip(owner, { theme: null })).rejects.toThrow("theme");
  });

  it("enum rejects unknown cadence and weather status", async () => {
    const owner = await addUser("owner-a");
    await expect(addStaple(owner, { cadence: "per week" })).rejects.toThrow("staple_cadence");
    const trip = await addTrip(owner);
    await expect(
      client().query(
        'INSERT INTO "weather_suggestions" ("trip_id", "owner_id", "status", "label") VALUES ($1, $2, $3, $4)',
        [trip, owner, "maybe", "Simulated"],
      ),
    ).rejects.toThrow("weather_status");
  });
});

describe("ownership", () => {
  it("rejects a row with no owner or an unknown owner", async () => {
    await expect(
      client().query(
        `INSERT INTO "trips" ("destination", "start_date", "end_date", "days", "daily_days") VALUES ('X', '2030-04-01', '2030-04-02', 2, 0)`,
      ),
    ).rejects.toThrow("owner_id");
    await expect(addTrip("ghost")).rejects.toThrow("trips_owner_id_users_id_fk");
  });

  it("rejects a child row that points at another owner's trip", async () => {
    const alice = await addUser("alice");
    const bob = await addUser("bob");
    const trip = await addTrip(alice);
    await expect(addItem(trip, bob)).rejects.toThrow("trip_items_trip_fk");
    await expect(
      client().query('INSERT INTO "trip_preferences" ("trip_id", "owner_id") VALUES ($1, $2)', [
        trip,
        bob,
      ]),
    ).rejects.toThrow("trip_preferences_trip_fk");
    await expect(
      client().query(
        'INSERT INTO "weather_suggestions" ("trip_id", "owner_id", "label") VALUES ($1, $2, $3)',
        [trip, bob, "Simulated"],
      ),
    ).rejects.toThrow("weather_suggestions_trip_fk");
  });

  it("rejects progress that names another owner or a wrong qty", async () => {
    const alice = await addUser("alice");
    const bob = await addUser("bob");
    const trip = await addTrip(alice);
    const item = await addItem(trip, alice, { qty: 6 });
    await expect(addProgress(item, trip, bob, 6, 1)).rejects.toThrow("trip_item_progress");
    await expect(addProgress(item, trip, alice, 5, 1)).rejects.toThrow(
      "trip_item_progress_item_fk",
    );
  });

  it("deleting a user removes everything they own, and only theirs", async () => {
    const alice = await addUser("alice");
    const bob = await addUser("bob");
    const aliceTrip = await addTrip(alice);
    const bobTrip = await addTrip(bob);
    await addItem(aliceTrip, alice);
    await addItem(bobTrip, bob);
    await addStaple(alice);
    await client().query('DELETE FROM "users" WHERE "id" = $1', [alice]);
    expect(await rows("SELECT owner_id FROM trips")).toEqual([{ owner_id: "bob" }]);
    expect(await rows("SELECT owner_id FROM trip_items")).toEqual([{ owner_id: "bob" }]);
    expect(await rows("SELECT 1 FROM staples")).toEqual([]);
  });
});

describe("uniqueness and stable ids", () => {
  it("semantic ids are unique per trip, not per name", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const other = await addTrip(owner);
    await addItem(trip, owner, { semantic_id: "underwear", name: "Underwear" });
    await addItem(trip, owner, {
      semantic_id: "return-underwear",
      name: "Underwear",
      section: "return",
    });
    await expect(addItem(trip, owner, { semantic_id: "underwear", name: "Other" })).rejects.toThrow(
      "trip_items_trip_semantic_unique",
    );
    await expect(addItem(other, owner, { semantic_id: "underwear" })).resolves.toBeTruthy();
  });

  it("each trip item gets its own immutable uuid", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const a = await addItem(trip, owner, { semantic_id: "a" });
    const b = await addItem(trip, owner, { semantic_id: "b" });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("staple semantic ids are unique per owner", async () => {
    const alice = await addUser("alice");
    const bob = await addUser("bob");
    await addStaple(alice);
    await expect(addStaple(alice)).rejects.toThrow("staples_owner_semantic_unique");
    await expect(addStaple(bob)).resolves.toBeUndefined();
  });
});

describe("historical trips are snapshots", () => {
  it("editing a staple never alters an existing trip's items", async () => {
    const owner = await addUser("owner-a");
    await addStaple(owner, { qty: 1, name: "Underwear" });
    const trip = await addTrip(owner);
    const item = await addItem(trip, owner, {
      semantic_id: "underwear",
      name: "Underwear",
      qty: 6,
    });
    await addProgress(item, trip, owner, 6, 4);
    const before = await rows("SELECT * FROM trip_items ORDER BY id");
    const progressBefore = await rows("SELECT * FROM trip_item_progress");

    await client().query(
      `UPDATE "staples" SET "name" = 'Briefs', "qty" = 3, "pack_last" = true, "version" = "version" + 1, "updated_at" = now()
       WHERE "semantic_id" = 'underwear'`,
    );
    expect(await rows("SELECT name, qty, version FROM staples")).toEqual([
      { name: "Briefs", qty: 3, version: 2 },
    ]);
    expect(await rows("SELECT * FROM trip_items ORDER BY id")).toEqual(before);
    expect(await rows("SELECT * FROM trip_item_progress")).toEqual(progressBefore);

    await client().query('DELETE FROM "staples"');
    expect(await rows("SELECT * FROM trip_items ORDER BY id")).toEqual(before);
  });

  it("no foreign key links trip tables to staples", async () => {
    const links = await rows(
      `SELECT conrelid::regclass::text AS from_table FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'staples'::regclass`,
    );
    expect(links).toEqual([]);
  });
});

describe("cascades", () => {
  it("deleting a trip removes its preferences, items, progress and weather", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const item = await addItem(trip, owner, { qty: 2 });
    await addProgress(item, trip, owner, 2, 1);
    await client().query('INSERT INTO "trip_preferences" ("trip_id", "owner_id") VALUES ($1, $2)', [
      trip,
      owner,
    ]);
    await client().query(
      'INSERT INTO "weather_suggestions" ("trip_id", "owner_id", "label") VALUES ($1, $2, $3)',
      [trip, owner, "Simulated"],
    );
    await client().query('DELETE FROM "trips" WHERE "id" = $1', [trip]);
    for (const table of [
      "trip_items",
      "trip_item_progress",
      "trip_preferences",
      "weather_suggestions",
    ]) {
      expect(await rows(`SELECT 1 FROM "${table}"`)).toEqual([]);
    }
  });

  it("deleting a source trip keeps its copy and clears copied_from", async () => {
    const owner = await addUser("owner-a");
    const source = await addTrip(owner);
    const copy = await addTrip(owner, { copied_from: source });
    await client().query('DELETE FROM "trips" WHERE "id" = $1', [source]);
    expect(await rows("SELECT id, copied_from FROM trips")).toEqual([
      { id: copy, copied_from: null },
    ]);
  });

  it("column defaults describe a fresh, unready, live trip with default preferences", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    await client().query('INSERT INTO "trip_preferences" ("trip_id", "owner_id") VALUES ($1, $2)', [
      trip,
      owner,
    ]);
    await client().query(
      'INSERT INTO "weather_suggestions" ("trip_id", "owner_id", "label") VALUES ($1, $2, $3)',
      [trip, owner, "Simulated"],
    );
    expect(
      await rows("SELECT ready, toiletry_bag_packed, archived, deleted_at FROM trips"),
    ).toEqual([{ ready: false, toiletry_bag_packed: false, archived: false, deleted_at: null }]);
    expect(
      await rows(
        "SELECT return_outfit, occasion_count, suggestion_memory, suppressed_suggestions FROM trip_preferences",
      ),
    ).toEqual([
      { return_outfit: true, occasion_count: 1, suggestion_memory: {}, suppressed_suggestions: [] },
    ]);
    expect(await rows("SELECT status, suggestion_semantic_id FROM weather_suggestions")).toEqual([
      { status: "pending", suggestion_semantic_id: "weather-umbrella" },
    ]);
  });
});

describe("progress follows item quantity", () => {
  async function setup(qty: number, packed: number) {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const item = await addItem(trip, owner, { qty });
    await addProgress(item, trip, owner, qty, packed);
    return item;
  }
  const progress = () =>
    rows<{ qty: number; packed: number }>("SELECT qty, packed FROM trip_item_progress");

  it("raising qty keeps packed and mirrors the new qty", async () => {
    const item = await setup(4, 3);
    await client().query('UPDATE "trip_items" SET "qty" = 9 WHERE "id" = $1', [item]);
    expect(await progress()).toEqual([{ qty: 9, packed: 3 }]);
  });

  it("lowering qty clamps packed first, so the edit succeeds", async () => {
    const item = await setup(6, 5);
    await client().query('UPDATE "trip_items" SET "qty" = 2 WHERE "id" = $1', [item]);
    expect(await progress()).toEqual([{ qty: 2, packed: 2 }]);
  });

  it("lowering qty below packed leaves smaller packed counts alone", async () => {
    const item = await setup(6, 1);
    await client().query('UPDATE "trip_items" SET "qty" = 3 WHERE "id" = $1', [item]);
    expect(await progress()).toEqual([{ qty: 3, packed: 1 }]);
  });

  it("editing other columns does not touch progress", async () => {
    const item = await setup(6, 5);
    await client().query('UPDATE "trip_items" SET "name" = \'Briefs\' WHERE "id" = $1', [item]);
    expect(await progress()).toEqual([{ qty: 6, packed: 5 }]);
  });

  it("an item without progress can still change qty", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const item = await addItem(trip, owner, { qty: 2 });
    await client().query('UPDATE "trip_items" SET "qty" = 5 WHERE "id" = $1', [item]);
    expect(await rows("SELECT qty FROM trip_items")).toEqual([{ qty: 5 }]);
  });

  it("setting qty to the same value is a no-op for progress", async () => {
    const item = await setup(6, 5);
    await client().query('UPDATE "trip_items" SET "qty" = 6 WHERE "id" = $1', [item]);
    expect(await progress()).toEqual([{ qty: 6, packed: 5 }]);
  });
});

describe("drizzle schema matches the migrated database", () => {
  const tables = [
    schema.accountDeletions,
    schema.users,
    schema.staples,
    schema.trips,
    schema.tripPreferences,
    schema.tripItems,
    schema.tripItemProgress,
    schema.weatherSuggestions,
  ] as PgTable[];

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
    "%s columns",
    async (name, table) => {
      const actual = await rows<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
        [name],
      );
      const expected = getTableConfig(table)
        .columns.map((column) => ({
          column_name: column.name,
          is_nullable: column.notNull ? "NO" : "YES",
        }))
        .sort((a, b) => a.column_name.localeCompare(b.column_name));
      expect(actual).toEqual(expected);
    },
  );

  it("enum values match", async () => {
    const enums = await rows<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname ORDER BY 1`,
    );
    expect(enums).toEqual([
      { typname: "item_category", labels: [...schema.ITEM_CATEGORIES] },
      { typname: "item_section", labels: [...schema.ITEM_SECTIONS] },
      { typname: "staple_cadence", labels: [...schema.STAPLE_CADENCES] },
      { typname: "staples_setup_state", labels: [...schema.STAPLES_SETUP_STATES] },
      { typname: "trip_theme", labels: [...THEME_IDS] },
      { typname: "weather_status", labels: [...schema.WEATHER_STATUSES] },
    ]);
  });
});

describe("domain categories fit the item_category enum", () => {
  const allOn = {
    start: "2030-04-01",
    end: "2030-04-12",
    laundry: true,
    spare: true,
    niceAttire: true,
    occasionCount: 3,
    reuseNice: false,
    returnOutfit: true,
  };
  const allowed = new Set<string>(schema.ITEM_CATEGORIES);

  it("every category the calculator and default staples produce is a valid enum value", () => {
    const produced = new Set<string>([
      ...calculateSuggestions(allOn).items.map((entry) => entry.category),
      ...buildTripItems(allOn, SYNTHETIC_STAPLES).items.map((entry) => entry.category),
      ...SYNTHETIC_STAPLES.map((staple) => staple.category),
    ]);
    expect([...produced].filter((category) => !allowed.has(category))).toEqual([]);
  });

  it('normalizes everyday clothing to "Clothing" only', () => {
    expect(allowed.has("Clothing")).toBe(true);
    expect(allowed.has("Clothes")).toBe(false);
  });

  it("the migrated database accepts every produced category", async () => {
    const owner = await addUser("owner-a");
    const trip = await addTrip(owner);
    const categories = [
      ...new Set(buildTripItems(allOn, SYNTHETIC_STAPLES).items.map((entry) => entry.category)),
    ];
    for (const [index, category] of categories.entries()) {
      await addItem(trip, owner, { semantic_id: `item-${index}`, category });
    }
    expect(await rows("SELECT 1 FROM trip_items")).toHaveLength(categories.length);
  });
});

describe("indexes the data layer relies on", () => {
  const definitions = async () =>
    Object.fromEntries(
      (
        await rows<{ indexname: string; indexdef: string }>(
          "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
        )
      ).map((row) => [row.indexname, row.indexdef]),
    );

  it.each([
    ["trips_owner_start_idx", /ON public\.trips USING btree \(owner_id, start_date\)/],
    ["trip_items_trip_order_idx", /ON public\.trip_items USING btree \(trip_id, sort_order\)/],
    [
      "staples_owner_semantic_unique",
      /UNIQUE INDEX .* ON public\.staples USING btree \(owner_id, semantic_id\)/,
    ],
    ["trips_id_owner_unique", /UNIQUE INDEX .* ON public\.trips USING btree \(id, owner_id\)/],
    [
      "trip_items_trip_semantic_unique",
      /UNIQUE INDEX .* ON public\.trip_items USING btree \(trip_id, semantic_id\)/,
    ],
    [
      "trip_items_progress_key",
      /UNIQUE INDEX .* ON public\.trip_items USING btree \(id, trip_id, owner_id, qty\)/,
    ],
    [
      "trip_item_progress_pk",
      /UNIQUE INDEX .* ON public\.trip_item_progress USING btree \(item_id\)/,
    ],
  ])("%s exists with the expected columns", async (name, pattern) => {
    expect((await definitions())[name]).toMatch(pattern);
  });

  it("the recently-deleted index is partial, so it never scans live trips", async () => {
    const definition = (await definitions())["trips_deleted_at_idx"];
    expect(definition).toMatch(/ON public\.trips USING btree \(deleted_at\)/);
    expect(definition).toMatch(/WHERE \(deleted_at IS NOT NULL\)/);
  });
});
