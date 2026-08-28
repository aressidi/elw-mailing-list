import { pgTable, serial, varchar, text, integer, decimal, timestamp, boolean, pgEnum, index, uniqueIndex, foreignKey, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// Enums
export const ownerTypeEnum = pgEnum('owner_type', ['individual', 'company', 'trust', 'llc', 'other']);
export const hitTypeEnum = pgEnum('hit_type', ['call', 'email', 'website', 'text', 'mail', 'other']);
export const suppressionReasonEnum = pgEnum('suppression_reason', ['do_not_mail', 'bad_address', 'deceased', 'sold', 'other']);

// ====================
// Data Sources Table
// ====================
export const dataSources = pgTable('data_sources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
}, (table) => ({
  nameIdx: uniqueIndex('data_sources_name_idx').on(table.name),
}));

// ====================
// Properties Table
// ====================
export const properties = pgTable('properties', {
  id: serial('id').primaryKey(),
  apn: varchar('apn', { length: 100 }).notNull().unique(),
  state: varchar('state', { length: 2 }),
  county: varchar('county', { length: 100 }),
  zip: varchar('zip', { length: 20 }),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  acres: decimal('acres', { precision: 12, scale: 4 }),
  legalDescription: text('legal_description'),
  dataSourceId: integer('data_source_id').references(() => dataSources.id, { onDelete: 'set null' }),
  sourceAcquiredDate: timestamp('source_acquired_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  apnIdx: uniqueIndex('properties_apn_idx').on(table.apn),
  stateIdx: index('properties_state_idx').on(table.state),
  countyIdx: index('properties_county_idx').on(table.county),
  zipIdx: index('properties_zip_idx').on(table.zip),
  dataSourceIdx: index('properties_data_source_idx').on(table.dataSourceId),
}));

// ====================
// Owners Table
// ====================
export const owners = pgTable('owners', {
  id: serial('id').primaryKey(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  ownerName: varchar('owner_name', { length: 255 }).notNull(),
  ownerType: ownerTypeEnum('owner_type').default('individual'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerNameIdx: index('owners_owner_name_idx').on(table.ownerName),
  lastNameIdx: index('owners_last_name_idx').on(table.lastName),
  ownerTypeIdx: index('owners_owner_type_idx').on(table.ownerType),
}));

// ====================
// Property Owners (Junction Table)
// ====================
export const propertyOwners = pgTable('property_owners', {
  propertyId: integer('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  ownerId: integer('owner_id').notNull().references(() => owners.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.propertyId, table.ownerId] }),
  propertyIdx: index('property_owners_property_idx').on(table.propertyId),
  ownerIdx: index('property_owners_owner_idx').on(table.ownerId),
}));

// ====================
// Mailing Addresses Table
// ====================
export const mailingAddresses = pgTable('mailing_addresses', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => owners.id, { onDelete: 'cascade' }),
  addressLine1: varchar('address_line1', { length: 255 }),
  addressLine2: varchar('address_line2', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 2 }),
  zip: varchar('zip', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index('mailing_addresses_owner_idx').on(table.ownerId),
  cityIdx: index('mailing_addresses_city_idx').on(table.city),
  stateIdx: index('mailing_addresses_state_idx').on(table.state),
  zipIdx: index('mailing_addresses_zip_idx').on(table.zip),
}));

// ====================
// Campaigns Table
// ====================
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  link: text('link'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: index('campaigns_name_idx').on(table.name),
}));

// ====================
// Mailings Table
// ====================
export const mailings = pgTable('mailings', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
  ownerId: integer('owner_id').references(() => owners.id, { onDelete: 'set null' }),
  mailingAddressId: integer('mailing_address_id').references(() => mailingAddresses.id, { onDelete: 'set null' }),
  campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  mailDate: timestamp('mail_date', { withTimezone: true }),
  offerPrice: decimal('offer_price', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  propertyIdx: index('mailings_property_idx').on(table.propertyId),
  ownerIdx: index('mailings_owner_idx').on(table.ownerId),
  mailingAddressIdx: index('mailings_mailing_address_idx').on(table.mailingAddressId),
  campaignIdx: index('mailings_campaign_idx').on(table.campaignId),
  mailDateIdx: index('mailings_mail_date_idx').on(table.mailDate),
  campaignPropertyIdx: index('mailings_campaign_property_idx').on(table.campaignId, table.propertyId),
  campaignOwnerIdx: index('mailings_campaign_owner_idx').on(table.campaignId, table.ownerId),
}));

// ====================
// Deals Table
// ====================
export const deals = pgTable('deals', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
  ownerId: integer('owner_id').references(() => owners.id, { onDelete: 'set null' }),
  hitType: hitTypeEnum('hit_type').default('call'),
  hitDate: timestamp('hit_date', { withTimezone: true }).defaultNow().notNull(),
  isLead: boolean('is_lead').default(false),
  isConversion: boolean('is_conversion').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  propertyIdx: index('deals_property_idx').on(table.propertyId),
  ownerIdx: index('deals_owner_idx').on(table.ownerId),
  hitDateIdx: index('deals_hit_date_idx').on(table.hitDate),
  isLeadIdx: index('deals_is_lead_idx').on(table.isLead),
  isConversionIdx: index('deals_is_conversion_idx').on(table.isConversion),
}));

// ====================
// Mailing Suppression Table
// ====================
export const mailingSuppression = pgTable('mailing_suppression', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id').references(() => owners.id, { onDelete: 'cascade' }),
  propertyId: integer('property_id').references(() => properties.id, { onDelete: 'cascade' }),
  reason: suppressionReasonEnum('reason').default('do_not_mail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index('mailing_suppression_owner_idx').on(table.ownerId),
  propertyIdx: index('mailing_suppression_property_idx').on(table.propertyId),
  reasonIdx: index('mailing_suppression_reason_idx').on(table.reason),
  uniqueSuppression: uniqueIndex('mailing_suppression_unique_idx').on(table.ownerId, table.propertyId),
}));

// ====================
// Source Metadata Table
// ====================
export const sourceMetadata = pgTable('source_metadata', {
  id: serial('id').primaryKey(),
  propertyId: integer('property_id').references(() => properties.id, { onDelete: 'cascade' }),
  sourceId: integer('source_id').references(() => dataSources.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 255 }),
  sourceLink: text('source_link'),
  estimatedValue: decimal('estimated_value', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  propertyIdx: index('source_metadata_property_idx').on(table.propertyId),
  sourceIdx: index('source_metadata_source_idx').on(table.sourceId),
  externalIdIdx: index('source_metadata_external_id_idx').on(table.externalId),
}));

// ====================
// Relations
// ====================

export const dataSourcesRelations = relations(dataSources, ({ many }) => ({
  properties: many(properties),
  sourceMetadata: many(sourceMetadata),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  dataSource: one(dataSources, {
    fields: [properties.dataSourceId],
    references: [dataSources.id],
  }),
  propertyOwners: many(propertyOwners),
  mailings: many(mailings),
  deals: many(deals),
  suppressions: many(mailingSuppression),
  sourceMetadata: many(sourceMetadata),
}));

export const ownersRelations = relations(owners, ({ many }) => ({
  propertyOwners: many(propertyOwners),
  mailingAddresses: many(mailingAddresses),
  mailings: many(mailings),
  deals: many(deals),
  suppressions: many(mailingSuppression),
}));

export const propertyOwnersRelations = relations(propertyOwners, ({ one }) => ({
  property: one(properties, {
    fields: [propertyOwners.propertyId],
    references: [properties.id],
  }),
  owner: one(owners, {
    fields: [propertyOwners.ownerId],
    references: [owners.id],
  }),
}));

export const mailingAddressesRelations = relations(mailingAddresses, ({ one, many }) => ({
  owner: one(owners, {
    fields: [mailingAddresses.ownerId],
    references: [owners.id],
  }),
  mailings: many(mailings),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  mailings: many(mailings),
}));

export const mailingsRelations = relations(mailings, ({ one }) => ({
  property: one(properties, {
    fields: [mailings.propertyId],
    references: [properties.id],
  }),
  owner: one(owners, {
    fields: [mailings.ownerId],
    references: [owners.id],
  }),
  mailingAddress: one(mailingAddresses, {
    fields: [mailings.mailingAddressId],
    references: [mailingAddresses.id],
  }),
  campaign: one(campaigns, {
    fields: [mailings.campaignId],
    references: [campaigns.id],
  }),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  property: one(properties, {
    fields: [deals.propertyId],
    references: [properties.id],
  }),
  owner: one(owners, {
    fields: [deals.ownerId],
    references: [owners.id],
  }),
}));

export const mailingSuppressionRelations = relations(mailingSuppression, ({ one }) => ({
  owner: one(owners, {
    fields: [mailingSuppression.ownerId],
    references: [owners.id],
  }),
  property: one(properties, {
    fields: [mailingSuppression.propertyId],
    references: [properties.id],
  }),
}));

export const sourceMetadataRelations = relations(sourceMetadata, ({ one }) => ({
  property: one(properties, {
    fields: [sourceMetadata.propertyId],
    references: [properties.id],
  }),
  source: one(dataSources, {
    fields: [sourceMetadata.sourceId],
    references: [dataSources.id],
  }),
}));

// ====================
// Zod Insert Schemas
// ====================

export const insertDataSourceSchema = createInsertSchema(dataSources);
export const insertPropertySchema = createInsertSchema(properties);
export const insertOwnerSchema = createInsertSchema(owners);
export const insertPropertyOwnerSchema = createInsertSchema(propertyOwners);
export const insertMailingAddressSchema = createInsertSchema(mailingAddresses);
export const insertCampaignSchema = createInsertSchema(campaigns);
export const insertMailingSchema = createInsertSchema(mailings);
export const insertDealSchema = createInsertSchema(deals);
export const insertMailingSuppressionSchema = createInsertSchema(mailingSuppression);
export const insertSourceMetadataSchema = createInsertSchema(sourceMetadata);

// ====================
// Type Exports
// ====================

export type DataSource = typeof dataSources.$inferSelect;
export type NewDataSource = typeof dataSources.$inferInsert;

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;

export type Owner = typeof owners.$inferSelect;
export type NewOwner = typeof owners.$inferInsert;

export type PropertyOwner = typeof propertyOwners.$inferSelect;
export type NewPropertyOwner = typeof propertyOwners.$inferInsert;

export type MailingAddress = typeof mailingAddresses.$inferSelect;
export type NewMailingAddress = typeof mailingAddresses.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Mailing = typeof mailings.$inferSelect;
export type NewMailing = typeof mailings.$inferInsert;

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

export type MailingSuppression = typeof mailingSuppression.$inferSelect;
export type NewMailingSuppression = typeof mailingSuppression.$inferInsert;

export type SourceMetadata = typeof sourceMetadata.$inferSelect;
export type NewSourceMetadata = typeof sourceMetadata.$inferInsert;

// ====================
// Seed Data Types
// ====================

export const seedDataSources: NewDataSource[] = [
  { name: 'datatree', description: 'DataTree property data service' },
  { name: 'zamplo', description: 'Zamplo parcel lookup service' },
  { name: 'county', description: 'County assessor records' },
];
