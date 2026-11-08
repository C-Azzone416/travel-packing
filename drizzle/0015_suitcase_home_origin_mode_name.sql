CREATE TYPE "public"."travel_mode" AS ENUM('fly', 'drive', 'other');--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_city" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_label" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_provider" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_place_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_region" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_country" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_location_country_code" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_latitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_longitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_timezone" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "travel_mode" "travel_mode";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_label" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_provider" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_place_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_region" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_country" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location_country_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_latitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_longitude" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_timezone" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_name_valid" CHECK ("trips"."name" is null or (btrim("trips"."name") = "trips"."name" and char_length("trips"."name") between 1 and 60));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_city_not_blank" CHECK ("trips"."origin_city" is null or btrim("trips"."origin_city") <> '');--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_city_short" CHECK ("trips"."origin_city" is null or char_length("trips"."origin_city") <= 80);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_all_or_nothing" CHECK ("trips"."origin_city" is not null or ("trips"."origin_location_id" is null and "trips"."origin_location_label" is null and "trips"."origin_location_region" is null and "trips"."origin_location_country" is null and "trips"."origin_timezone" is null and "trips"."origin_location_provider" is null and "trips"."origin_location_place_id" is null and "trips"."origin_location_country_code" is null and "trips"."origin_latitude" is null and "trips"."origin_longitude" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_latitude_range" CHECK ("trips"."origin_latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_longitude_range" CHECK ("trips"."origin_longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_coordinates_pair" CHECK (("trips"."origin_latitude" is null) = ("trips"."origin_longitude" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_coordinates_need_provider" CHECK ("trips"."origin_latitude" is null or "trips"."origin_location_provider" is not null);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_provider_pair" CHECK (("trips"."origin_location_provider" is null) = ("trips"."origin_location_place_id" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_country_code_length" CHECK ("trips"."origin_location_country_code" is null or char_length("trips"."origin_location_country_code") = 2);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_city_not_blank" CHECK ("users"."home_city" is null or btrim("users"."home_city") <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_city_short" CHECK ("users"."home_city" is null or char_length("users"."home_city") <= 80);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_all_or_nothing" CHECK ("users"."home_city" is not null or ("users"."home_location_id" is null and "users"."home_location_label" is null and "users"."home_location_region" is null and "users"."home_location_country" is null and "users"."home_timezone" is null and "users"."home_location_provider" is null and "users"."home_location_place_id" is null and "users"."home_location_country_code" is null and "users"."home_latitude" is null and "users"."home_longitude" is null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_latitude_range" CHECK ("users"."home_latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_longitude_range" CHECK ("users"."home_longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_coordinates_pair" CHECK (("users"."home_latitude" is null) = ("users"."home_longitude" is null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_coordinates_need_provider" CHECK ("users"."home_latitude" is null or "users"."home_location_provider" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_provider_pair" CHECK (("users"."home_location_provider" is null) = ("users"."home_location_place_id" is null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_country_code_length" CHECK ("users"."home_location_country_code" is null or char_length("users"."home_location_country_code") = 2);