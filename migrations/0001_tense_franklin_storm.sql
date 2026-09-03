ALTER TABLE "owners" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "merged_into_id" integer;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_merged_into_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailings_campaign_property_idx" ON "mailings" USING btree ("campaign_id","property_id");--> statement-breakpoint
CREATE INDEX "mailings_campaign_owner_idx" ON "mailings" USING btree ("campaign_id","owner_id");--> statement-breakpoint
CREATE INDEX "owners_archived_at_idx" ON "owners" USING btree ("archived_at");