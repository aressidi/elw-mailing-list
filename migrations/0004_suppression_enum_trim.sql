ALTER TABLE "mailing_suppression" ALTER COLUMN "reason" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mailing_suppression" ALTER COLUMN "reason" SET DEFAULT 'do_not_mail'::text;--> statement-breakpoint
DROP TYPE "public"."suppression_reason";--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('do_not_mail', 'bad_address');--> statement-breakpoint
ALTER TABLE "mailing_suppression" ALTER COLUMN "reason" SET DEFAULT 'do_not_mail'::"public"."suppression_reason";--> statement-breakpoint
ALTER TABLE "mailing_suppression" ALTER COLUMN "reason" SET DATA TYPE "public"."suppression_reason" USING "reason"::"public"."suppression_reason";