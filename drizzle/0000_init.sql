CREATE TYPE "public"."item_category" AS ENUM('Clothing', 'Nice attire', 'Bathroom', 'Toiletries', 'Tech', 'Other essentials', 'Accessories', 'Pack last', 'Return outfit', 'Weather suggestion');--> statement-breakpoint
CREATE TYPE "public"."item_section" AS ENUM('main', 'return', 'packlast');--> statement-breakpoint
CREATE TYPE "public"."staple_cadence" AS ENUM('per day', 'per trip');--> statement-breakpoint
CREATE TYPE "public"."weather_status" AS ENUM('pending', 'accepted', 'skipped');--> statement-breakpoint
CREATE TABLE "staples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"semantic_id" text NOT NULL,
	"name" text NOT NULL,
	"category" "item_category" NOT NULL,
	"qty" integer NOT NULL,
	"cadence" "staple_cadence" NOT NULL,
	"pack_last" boolean DEFAULT false NOT NULL,
	"group_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staples_owner_semantic_unique" UNIQUE("owner_id","semantic_id"),
	CONSTRAINT "staples_qty_positive" CHECK ("staples"."qty" >= 1),
	CONSTRAINT "staples_version_positive" CHECK ("staples"."version" >= 1),
	CONSTRAINT "staples_name_not_blank" CHECK (btrim("staples"."name") <> ''),
	CONSTRAINT "staples_group_known" CHECK ("staples"."group_id" is null or "staples"."group_id" = 'toiletry-bag')
);
--> statement-breakpoint
CREATE TABLE "trip_item_progress" (
	"item_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"qty" integer NOT NULL,
	"packed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_item_progress_pk" PRIMARY KEY("item_id"),
	CONSTRAINT "trip_item_progress_packed_range" CHECK ("trip_item_progress"."packed" >= 0 and "trip_item_progress"."packed" <= "trip_item_progress"."qty")
);
--> statement-breakpoint
CREATE TABLE "trip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"semantic_id" text NOT NULL,
	"name" text NOT NULL,
	"category" "item_category" NOT NULL,
	"qty" integer NOT NULL,
	"section" "item_section" DEFAULT 'main' NOT NULL,
	"group_id" text,
	"optional" boolean DEFAULT false NOT NULL,
	"user_edited" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_items_trip_semantic_unique" UNIQUE("trip_id","semantic_id"),
	CONSTRAINT "trip_items_progress_key" UNIQUE("id","trip_id","owner_id","qty"),
	CONSTRAINT "trip_items_qty_positive" CHECK ("trip_items"."qty" >= 1),
	CONSTRAINT "trip_items_name_not_blank" CHECK (btrim("trip_items"."name") <> ''),
	CONSTRAINT "trip_items_group_known" CHECK ("trip_items"."group_id" is null or "trip_items"."group_id" = 'toiletry-bag')
);
--> statement-breakpoint
CREATE TABLE "trip_preferences" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"laundry" boolean DEFAULT false NOT NULL,
	"spare" boolean DEFAULT false NOT NULL,
	"nice_attire" boolean DEFAULT false NOT NULL,
	"occasion_count" integer DEFAULT 1 NOT NULL,
	"reuse_nice" boolean DEFAULT false NOT NULL,
	"return_outfit" boolean DEFAULT true NOT NULL,
	"suggestion_memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suppressed_suggestions" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_preferences_occasion_count_range" CHECK ("trip_preferences"."occasion_count" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"destination" text NOT NULL,
	"location_id" text,
	"location_label" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"daily_days" integer NOT NULL,
	"toiletry_bag_packed" boolean DEFAULT false NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"copied_from" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "trips_dates_ordered" CHECK ("trips"."end_date" >= "trips"."start_date"),
	CONSTRAINT "trips_days_positive" CHECK ("trips"."days" >= 1),
	CONSTRAINT "trips_daily_days_range" CHECK ("trips"."daily_days" >= 0 and "trips"."daily_days" <= "trips"."days"),
	CONSTRAINT "trips_destination_not_blank" CHECK (btrim("trips"."destination") <> '')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_suggestions" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"status" "weather_status" DEFAULT 'pending' NOT NULL,
	"label" text NOT NULL,
	"suggestion_semantic_id" text DEFAULT 'weather-umbrella' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staples" ADD CONSTRAINT "staples_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_item_progress" ADD CONSTRAINT "trip_item_progress_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_item_progress" ADD CONSTRAINT "trip_item_progress_item_fk" FOREIGN KEY ("item_id","trip_id","owner_id","qty") REFERENCES "public"."trip_items"("id","trip_id","owner_id","qty") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_trip_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_preferences" ADD CONSTRAINT "trip_preferences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_preferences" ADD CONSTRAINT "trip_preferences_trip_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_copied_from_fk" FOREIGN KEY ("copied_from") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD CONSTRAINT "weather_suggestions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_suggestions" ADD CONSTRAINT "weather_suggestions_trip_fk" FOREIGN KEY ("trip_id","owner_id") REFERENCES "public"."trips"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_items_trip_order_idx" ON "trip_items" USING btree ("trip_id","sort_order");--> statement-breakpoint
CREATE INDEX "trips_owner_start_idx" ON "trips" USING btree ("owner_id","start_date");--> statement-breakpoint
CREATE INDEX "trips_deleted_at_idx" ON "trips" USING btree ("deleted_at") WHERE "trips"."deleted_at" is not null;