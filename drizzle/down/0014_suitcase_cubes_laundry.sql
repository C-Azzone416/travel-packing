-- The up migration reset converted Smart rows to qty 1; Smart ignores the stored quantity, so down leaves qty as it is.
-- Lossy by nature: "per night" rows become "per day", and tops that carried the laundry flag go back to Smart.
-- Underwear and socks that were Smart before the up migration stay "per day" (their old cadence is not recorded).
UPDATE "staples" SET "cadence" = 'smart' WHERE "laundry_halves" AND "semantic_id" IN ('tops') AND "cadence" = 'per day';--> statement-breakpoint
ALTER TABLE "staples" DROP CONSTRAINT "staples_laundry_not_underwear_socks";--> statement-breakpoint
ALTER TABLE "trip_items" DROP CONSTRAINT "trip_items_staple_qty_positive";--> statement-breakpoint
ALTER TABLE "trip_preferences" DROP COLUMN "morning_of_cubes";--> statement-breakpoint
ALTER TABLE "trip_items" DROP COLUMN "cube";--> statement-breakpoint
ALTER TABLE "trip_items" DROP COLUMN "laundry_halves";--> statement-breakpoint
ALTER TABLE "trip_items" DROP COLUMN "staple_qty";--> statement-breakpoint
ALTER TABLE "staples" DROP COLUMN "cube";--> statement-breakpoint
ALTER TABLE "staples" DROP COLUMN "laundry_halves";--> statement-breakpoint
DROP TYPE "public"."item_cube";--> statement-breakpoint
UPDATE "staples" SET "cadence" = 'per day' WHERE "cadence" = 'per night';--> statement-breakpoint
UPDATE "trip_items" SET "staple_cadence" = 'per day' WHERE "staple_cadence" = 'per night';--> statement-breakpoint
ALTER TABLE "staples" ALTER COLUMN "cadence" TYPE text;--> statement-breakpoint
ALTER TABLE "trip_items" ALTER COLUMN "staple_cadence" TYPE text;--> statement-breakpoint
DROP TYPE "public"."staple_cadence";--> statement-breakpoint
CREATE TYPE "public"."staple_cadence" AS ENUM('per day', 'per trip', 'smart');--> statement-breakpoint
ALTER TABLE "staples" ALTER COLUMN "cadence" TYPE "public"."staple_cadence" USING "cadence"::"public"."staple_cadence";--> statement-breakpoint
ALTER TABLE "trip_items" ALTER COLUMN "staple_cadence" TYPE "public"."staple_cadence" USING "staple_cadence"::"public"."staple_cadence";
