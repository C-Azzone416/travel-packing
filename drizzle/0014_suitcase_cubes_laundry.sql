CREATE TYPE "public"."item_cube" AS ENUM('clothing', 'toiletries', 'tech', 'documents', 'misc', 'weather');--> statement-breakpoint
ALTER TYPE "public"."staple_cadence" ADD VALUE 'per night';--> statement-breakpoint
ALTER TABLE "staples" ADD COLUMN "laundry_halves" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staples" ADD COLUMN "cube" "item_cube" DEFAULT 'misc' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "staple_qty" integer;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "laundry_halves" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "cube" "item_cube" DEFAULT 'misc' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_preferences" ADD COLUMN "morning_of_cubes" "item_cube"[] DEFAULT '{toiletries}'::item_cube[] NOT NULL;--> statement-breakpoint
ALTER TABLE "staples" ADD CONSTRAINT "staples_laundry_not_underwear_socks" CHECK (not "staples"."laundry_halves" or "staples"."semantic_id" not in ('underwear', 'socks'));--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_staple_qty_positive" CHECK ("trip_items"."staple_qty" is null or "trip_items"."staple_qty" >= 1);--> statement-breakpoint
-- Data: category -> cube backfill (rules mirror cubeForItem in src/domain/cubes.ts; a test runs both on the same fixtures).
UPDATE "staples" SET "cube" = (CASE
  WHEN "group_id" = 'toiletry-bag' THEN 'toiletries'
  WHEN "semantic_id" LIKE 'weather-%' OR "semantic_id" IN ('umbrella', 'sunscreen', 'sun-hat', 'rain-jacket', 'swimsuit', 'snow-boots') THEN 'weather'
  WHEN "category" IN ('Clothing', 'Nice attire', 'Return outfit') THEN 'clothing'
  WHEN "category" IN ('Bathroom', 'Toiletries') THEN 'toiletries'
  WHEN "category" = 'Tech' THEN 'tech'
  WHEN "category" = 'Other essentials' THEN (CASE WHEN ("semantic_id" || ' ' || "name") ~* 'passport|document|licen[cs]e|ticket|visa|insurance|boarding|itinerary|reservation|booking|vaccin|\yid\y' THEN 'documents' ELSE 'misc' END)
  WHEN "category" = 'Accessories' THEN 'misc'
  WHEN "category" = 'Weather suggestion' THEN 'weather'
  WHEN ("semantic_id" || ' ' || "name") ~* 'laptop|charger|phone|cable|adapter|headphone|earbud|camera|tablet|power bank' THEN 'tech'
  WHEN ("semantic_id" || ' ' || "name") ~* 'passport|document|licen[cs]e|ticket|visa|insurance|boarding|itinerary|reservation|booking|vaccin|\yid\y' THEN 'documents'
  ELSE 'misc' END)::"item_cube";--> statement-breakpoint
UPDATE "trip_items" SET "cube" = (CASE
  WHEN "group_id" = 'toiletry-bag' THEN 'toiletries'
  WHEN "semantic_id" LIKE 'weather-%' OR "semantic_id" IN ('umbrella', 'sunscreen', 'sun-hat', 'rain-jacket', 'swimsuit', 'snow-boots') THEN 'weather'
  WHEN "category" IN ('Clothing', 'Nice attire', 'Return outfit') THEN 'clothing'
  WHEN "category" IN ('Bathroom', 'Toiletries') THEN 'toiletries'
  WHEN "category" = 'Tech' THEN 'tech'
  WHEN "category" = 'Other essentials' THEN (CASE WHEN ("semantic_id" || ' ' || "name") ~* 'passport|document|licen[cs]e|ticket|visa|insurance|boarding|itinerary|reservation|booking|vaccin|\yid\y' THEN 'documents' ELSE 'misc' END)
  WHEN "category" = 'Accessories' THEN 'misc'
  WHEN "category" = 'Weather suggestion' THEN 'weather'
  WHEN ("semantic_id" || ' ' || "name") ~* 'laptop|charger|phone|cable|adapter|headphone|earbud|camera|tablet|power bank' THEN 'tech'
  WHEN ("semantic_id" || ' ' || "name") ~* 'passport|document|licen[cs]e|ticket|visa|insurance|boarding|itinerary|reservation|booking|vaccin|\yid\y' THEN 'documents'
  ELSE 'misc' END)::"item_cube";--> statement-breakpoint
-- Data: Smart staples become "per day" plus the laundry flag; underwear and socks never carry it. Sleepwear and the Nice
-- attire staples and bottoms stay Smart (they follow the trip's occasions, which no day count reproduces). Trip rows are untouched.
-- Smart ignored the stored quantity but per day multiplies it, so the converted rows are reset to 1 (all other rows keep theirs).
UPDATE "staples" SET "cadence" = 'per day', "qty" = 1, "laundry_halves" = ("semantic_id" NOT IN ('underwear', 'socks'))
  WHERE "cadence" = 'smart' AND "semantic_id" IN ('tops', 'underwear', 'socks');
