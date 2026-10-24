CREATE TYPE "public"."staples_setup_state" AS ENUM('incomplete', 'skipped', 'completed');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staples_setup_state" "staples_setup_state";--> statement-breakpoint
UPDATE "users" SET "staples_setup_state" = 'skipped';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "staples_setup_state" SET DEFAULT 'incomplete';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "staples_setup_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staples_reminder_dismissed" boolean DEFAULT false NOT NULL;
