ALTER TABLE "trips" ADD COLUMN "location_provider" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "location_place_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "location_region" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "location_country" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "location_country_code" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "latitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "longitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_latitude_range" CHECK ("trips"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_longitude_range" CHECK ("trips"."longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_coordinates_pair" CHECK (("trips"."latitude" is null) = ("trips"."longitude" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_coordinates_need_provider" CHECK ("trips"."latitude" is null or "trips"."location_provider" is not null);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_provider_pair" CHECK (("trips"."location_provider" is null) = ("trips"."location_place_id" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_country_code_length" CHECK ("trips"."location_country_code" is null or char_length("trips"."location_country_code") = 2);