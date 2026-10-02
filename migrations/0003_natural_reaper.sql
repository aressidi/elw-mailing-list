ALTER TABLE "properties" DROP CONSTRAINT "properties_apn_unique";--> statement-breakpoint
DROP INDEX "properties_apn_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "properties_apn_location_idx" ON "properties" USING btree ("apn",(coalesce("state", '')),(regexp_replace(regexp_replace(upper(coalesce("county", '')), '\s+COUNTY$', ''), '[^A-Z]', '', 'g')));--> statement-breakpoint
CREATE INDEX "properties_apn_idx" ON "properties" USING btree ("apn");