CREATE TABLE "framebriar_enrollments" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"generation" uuid NOT NULL,
	"key_version" text NOT NULL,
	"credentials" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "framebriar_enrollments_state_known" CHECK ("framebriar_enrollments"."state" in ('active', 'revoked', 'disabled')),
	CONSTRAINT "framebriar_enrollments_revision_positive" CHECK ("framebriar_enrollments"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "framebriar_redemptions" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"generation" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "generation" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_generation_unique" UNIQUE("id","generation");--> statement-breakpoint
ALTER TABLE "framebriar_enrollments" ADD CONSTRAINT "framebriar_enrollments_user_fk" FOREIGN KEY ("owner_id","generation") REFERENCES "public"."users"("id","generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framebriar_redemptions" ADD CONSTRAINT "framebriar_redemptions_user_fk" FOREIGN KEY ("owner_id","generation") REFERENCES "public"."users"("id","generation") ON DELETE cascade ON UPDATE no action;
