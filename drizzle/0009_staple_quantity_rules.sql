ALTER TYPE "public"."staple_cadence" ADD VALUE 'smart';--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "staple_cadence" "staple_cadence";
