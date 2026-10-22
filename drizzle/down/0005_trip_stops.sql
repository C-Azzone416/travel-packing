DROP TABLE "trip_stops";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "temperature_unit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "weather_opt_in";--> statement-breakpoint
DELETE FROM "weather_suggestions" WHERE "suggestion_semantic_id" <> 'weather-umbrella';--> statement-breakpoint
ALTER TABLE "weather_suggestions" DROP CONSTRAINT "weather_suggestions_signature_short";--> statement-breakpoint
ALTER TABLE "weather_suggestions" DROP CONSTRAINT "weather_suggestions_pk";--> statement-breakpoint
ALTER TABLE "weather_suggestions" DROP COLUMN "rule_signature";--> statement-breakpoint
ALTER TABLE "weather_suggestions" ALTER COLUMN "label" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD CONSTRAINT "weather_suggestions_pkey" PRIMARY KEY ("trip_id");
