ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "raw_data" jsonb;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN IF NOT EXISTS "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN IF NOT EXISTS "email" varchar(255);--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN IF NOT EXISTS "raw_data" jsonb;
