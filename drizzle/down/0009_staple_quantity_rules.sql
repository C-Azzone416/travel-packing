ALTER TABLE "trip_items" DROP COLUMN "staple_cadence";--> statement-breakpoint
ALTER TABLE "staples" ALTER COLUMN "cadence" TYPE text;--> statement-breakpoint
UPDATE "staples" SET "cadence" = 'per trip' WHERE "cadence" = 'smart';--> statement-breakpoint
DROP TYPE "public"."staple_cadence";--> statement-breakpoint
CREATE TYPE "public"."staple_cadence" AS ENUM('per day', 'per trip');--> statement-breakpoint
ALTER TABLE "staples" ALTER COLUMN "cadence" TYPE "public"."staple_cadence" USING "cadence"::"public"."staple_cadence";
