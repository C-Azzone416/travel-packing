CREATE TABLE "trip_stops" (
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"position" integer NOT NULL,
	"city" text NOT NULL,
	"location_id" text,
	"location_label" text,
	"location_provider" text,
	"location_place_id" text,
	"location_region" text,
	"location_country" text,
	"location_country_code" text,
	"latitude" numeric(5, 2),
	"longitude" numeric(5, 2),
	"timezone" text,
	"arrive_date" date NOT NULL,
	"leave_date" date NOT NULL,
	CONSTRAINT "trip_stops_pk" PRIMARY KEY("trip_id","position"),
	CONSTRAINT "trip_stops_position_range" CHECK ("trip_stops"."position" >= 0),
	CONSTRAINT "trip_stops_dates_ordered" CHECK ("trip_stops"."leave_date" >= "trip_stops"."arrive_date"),
	CONSTRAINT "trip_stops_city_not_blank" CHECK (btrim("trip_stops"."city") <> ''),
	CONSTRAINT "trip_stops_latitude_range" CHECK ("trip_stops"."latitude" between -90 and 90),
	CONSTRAINT "trip_stops_longitude_range" CHECK ("trip_stops"."longitude" between -180 and 180),
	CONSTRAINT "trip_stops_coordinates_pair" CHECK (("trip_stops"."latitude" is null) = ("trip_stops"."longitude" is null)),
	CONSTRAINT "trip_stops_coordinates_need_provider" CHECK ("trip_stops"."latitude" is null or "trip_stops"."location_provider" is not null),
	CONSTRAINT "trip_stops_provider_pair" CHECK (("trip_stops"."location_provider" is null) = ("trip_stops"."location_place_id" is null)),
	CONSTRAINT "trip_stops_country_code_length" CHECK ("trip_stops"."location_country_code" is null or char_length("trip_stops"."location_country_code") = 2)
);
--> statement-breakpoint
ALTER TABLE "weather_suggestions" DROP CONSTRAINT "weather_suggestions_pkey";--> statement-breakpoint
ALTER TABLE "weather_suggestions" ALTER COLUMN "label" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD CONSTRAINT "weather_suggestions_pk" PRIMARY KEY("trip_id","suggestion_semantic_id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weather_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "temperature_unit" text DEFAULT 'F' NOT NULL;--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD COLUMN "rule_signature" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_stops_owner_idx" ON "trip_stops" USING btree ("owner_id","trip_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_temperature_unit_known" CHECK ("users"."temperature_unit" in ('F', 'C'));--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD CONSTRAINT "weather_suggestions_signature_short" CHECK (char_length("weather_suggestions"."rule_signature") <= 200);--> statement-breakpoint
INSERT INTO "trip_stops" ("trip_id", "owner_id", "position", "city", "location_id", "location_label", "location_provider", "location_place_id", "location_region", "location_country", "location_country_code", "latitude", "longitude", "timezone", "arrive_date", "leave_date")
SELECT "id", "owner_id", 0, "destination", "location_id", "location_label", "location_provider", "location_place_id", "location_region", "location_country", "location_country_code", "latitude", "longitude", "timezone", "start_date", "end_date" FROM "trips";
