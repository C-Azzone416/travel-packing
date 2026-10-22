ALTER TABLE "trips" DROP CONSTRAINT "trips_stamp_label_2_format";--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_stamp_label_1_format";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "stamp_label_2";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "stamp_label_1";
