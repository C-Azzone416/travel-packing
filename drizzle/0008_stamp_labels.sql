ALTER TABLE "trips" ADD COLUMN "stamp_label_1" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "stamp_label_2" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_stamp_label_1_format" CHECK ("trips"."stamp_label_1" is null or "trips"."stamp_label_1" ~ '^[A-Z0-9]{3}$');--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_stamp_label_2_format" CHECK ("trips"."stamp_label_2" is null or "trips"."stamp_label_2" ~ '^[A-Z0-9]{3}$');