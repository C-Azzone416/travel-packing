DROP TABLE "framebriar_redemptions";--> statement-breakpoint
DROP TABLE "framebriar_enrollments";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_id_generation_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "generation";
