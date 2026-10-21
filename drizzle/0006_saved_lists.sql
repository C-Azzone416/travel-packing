CREATE TABLE "saved_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"semantic_id" text NOT NULL,
	"name" text NOT NULL,
	"category" "item_category" NOT NULL,
	"qty" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "saved_list_items_list_semantic_unique" UNIQUE("list_id","semantic_id"),
	CONSTRAINT "saved_list_items_qty_positive" CHECK ("saved_list_items"."qty" >= 1),
	CONSTRAINT "saved_list_items_name_not_blank" CHECK (btrim("saved_list_items"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "saved_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_lists_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "saved_lists_name_not_blank" CHECK (btrim("saved_lists"."name") <> ''),
	CONSTRAINT "saved_lists_name_short" CHECK (char_length("saved_lists"."name") <= 80)
);
--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_list_fk" FOREIGN KEY ("list_id","owner_id") REFERENCES "public"."saved_lists"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lists" ADD CONSTRAINT "saved_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_list_items_list_order_idx" ON "saved_list_items" USING btree ("list_id","sort_order");--> statement-breakpoint
CREATE INDEX "saved_lists_owner_idx" ON "saved_lists" USING btree ("owner_id");