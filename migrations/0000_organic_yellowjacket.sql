CREATE TYPE "public"."hit_type" AS ENUM('call', 'email', 'website', 'text', 'mail', 'other');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('individual', 'company', 'trust', 'llc', 'other');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('do_not_mail', 'bad_address', 'deceased', 'sold', 'other');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"owner_id" integer,
	"hit_type" "hit_type" DEFAULT 'call',
	"hit_date" timestamp with time zone DEFAULT now() NOT NULL,
	"is_lead" boolean DEFAULT false,
	"is_conversion" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailing_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"address_line1" varchar(255),
	"address_line2" varchar(255),
	"city" varchar(100),
	"state" varchar(2),
	"zip" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailing_suppression" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer,
	"property_id" integer,
	"reason" "suppression_reason" DEFAULT 'do_not_mail',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailings" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"owner_id" integer,
	"mailing_address_id" integer,
	"campaign_id" integer,
	"mail_date" timestamp with time zone,
	"offer_price" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"owner_name" varchar(255) NOT NULL,
	"owner_type" "owner_type" DEFAULT 'individual',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"apn" varchar(100) NOT NULL,
	"state" varchar(2),
	"county" varchar(100),
	"zip" varchar(20),
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"acres" numeric(12, 4),
	"legal_description" text,
	"data_source_id" integer,
	"source_acquired_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_apn_unique" UNIQUE("apn")
);
--> statement-breakpoint
CREATE TABLE "property_owners" (
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	CONSTRAINT "property_owners_property_id_owner_id_pk" PRIMARY KEY("property_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "source_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"source_id" integer,
	"external_id" varchar(255),
	"source_link" text,
	"estimated_value" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_addresses" ADD CONSTRAINT "mailing_addresses_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_suppression" ADD CONSTRAINT "mailing_suppression_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_suppression" ADD CONSTRAINT "mailing_suppression_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_mailing_address_id_mailing_addresses_id_fk" FOREIGN KEY ("mailing_address_id") REFERENCES "public"."mailing_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_metadata" ADD CONSTRAINT "source_metadata_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_metadata" ADD CONSTRAINT "source_metadata_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_name_idx" ON "campaigns" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_name_idx" ON "data_sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "deals_property_idx" ON "deals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deals_hit_date_idx" ON "deals" USING btree ("hit_date");--> statement-breakpoint
CREATE INDEX "deals_is_lead_idx" ON "deals" USING btree ("is_lead");--> statement-breakpoint
CREATE INDEX "deals_is_conversion_idx" ON "deals" USING btree ("is_conversion");--> statement-breakpoint
CREATE INDEX "mailing_addresses_owner_idx" ON "mailing_addresses" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "mailing_addresses_city_idx" ON "mailing_addresses" USING btree ("city");--> statement-breakpoint
CREATE INDEX "mailing_addresses_state_idx" ON "mailing_addresses" USING btree ("state");--> statement-breakpoint
CREATE INDEX "mailing_addresses_zip_idx" ON "mailing_addresses" USING btree ("zip");--> statement-breakpoint
CREATE INDEX "mailing_suppression_owner_idx" ON "mailing_suppression" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "mailing_suppression_property_idx" ON "mailing_suppression" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "mailing_suppression_reason_idx" ON "mailing_suppression" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "mailing_suppression_unique_idx" ON "mailing_suppression" USING btree ("owner_id","property_id");--> statement-breakpoint
CREATE INDEX "mailings_property_idx" ON "mailings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "mailings_owner_idx" ON "mailings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "mailings_mailing_address_idx" ON "mailings" USING btree ("mailing_address_id");--> statement-breakpoint
CREATE INDEX "mailings_campaign_idx" ON "mailings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "mailings_mail_date_idx" ON "mailings" USING btree ("mail_date");--> statement-breakpoint
CREATE INDEX "owners_owner_name_idx" ON "owners" USING btree ("owner_name");--> statement-breakpoint
CREATE INDEX "owners_last_name_idx" ON "owners" USING btree ("last_name");--> statement-breakpoint
CREATE INDEX "owners_owner_type_idx" ON "owners" USING btree ("owner_type");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_apn_idx" ON "properties" USING btree ("apn");--> statement-breakpoint
CREATE INDEX "properties_state_idx" ON "properties" USING btree ("state");--> statement-breakpoint
CREATE INDEX "properties_county_idx" ON "properties" USING btree ("county");--> statement-breakpoint
CREATE INDEX "properties_zip_idx" ON "properties" USING btree ("zip");--> statement-breakpoint
CREATE INDEX "properties_data_source_idx" ON "properties" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "property_owners_property_idx" ON "property_owners" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_owners_owner_idx" ON "property_owners" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "source_metadata_property_idx" ON "source_metadata" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "source_metadata_source_idx" ON "source_metadata" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_metadata_external_id_idx" ON "source_metadata" USING btree ("external_id");