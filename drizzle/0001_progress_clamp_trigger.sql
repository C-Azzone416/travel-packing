-- Lowering a trip item's qty must first lower packed, otherwise the progress row (which mirrors qty through a
-- composite foreign key with ON UPDATE CASCADE) would violate CHECK (packed <= qty) during the cascade.
CREATE FUNCTION "clamp_progress_to_qty"() RETURNS trigger AS $$
BEGIN
	IF NEW."qty" IS DISTINCT FROM OLD."qty" THEN
		UPDATE "trip_item_progress" SET "packed" = LEAST("packed", NEW."qty") WHERE "item_id" = NEW."id";
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trip_items_clamp_progress" BEFORE UPDATE OF "qty" ON "trip_items" FOR EACH ROW EXECUTE FUNCTION "clamp_progress_to_qty"();
