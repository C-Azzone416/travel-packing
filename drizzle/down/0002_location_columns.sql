ALTER TABLE "trips" DROP CONSTRAINT "trips_country_code_length";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_provider_pair";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_coordinates_need_provider";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_coordinates_pair";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_longitude_range";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_latitude_range";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "longitude";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "location_country_code";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "location_country";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "location_region";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "location_place_id";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "location_provider";
