-- Dropping a column drops the check constraints that mention it. Lossy by nature: home cities, trip origins, modes and names are discarded.
ALTER TABLE "trips" DROP COLUMN "origin_city";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_label";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_provider";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_place_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_region";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_country";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_location_country_code";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_latitude";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_longitude";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "origin_timezone";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "travel_mode";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_city";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_label";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_provider";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_place_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_region";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_country";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_location_country_code";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_latitude";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_longitude";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "home_timezone";--> statement-breakpoint
DROP TYPE "public"."travel_mode";
