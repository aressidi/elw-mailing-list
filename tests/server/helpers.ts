import { db, pool } from '../../server/db.ts';
import {
  properties,
  owners,
  mailingAddresses,
  campaigns,
  mailings,
  deals,
  mailingSuppression,
  propertyOwners,
  sourceMetadata,
  type NewProperty,
  type NewOwner,
  type NewMailingAddress,
  type NewCampaign,
  type NewMailing,
  type NewDeal,
  type NewMailingSuppression,
} from '../../shared/schema.ts';

export { db, pool };

/** Wipes every table in the test database. Refuses to touch a non-test DB. */
export async function resetDb() {
  const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
  if (!rows[0].db.endsWith('_test')) {
    throw new Error(`Refusing to truncate non-test database "${rows[0].db}"`);
  }
  await pool.query(`
    TRUNCATE mailing_suppression, deals, mailings, campaigns, mailing_addresses,
             property_owners, source_metadata, owners, properties, data_sources
    RESTART IDENTITY CASCADE
  `);
}

export async function addProperty(values: Partial<NewProperty> & { apn: string }) {
  const [row] = await db.insert(properties).values(values).returning();
  return row;
}

export async function addOwner(values: Partial<NewOwner> & { ownerName: string }) {
  const [row] = await db.insert(owners).values(values).returning();
  return row;
}

export async function addAddress(values: NewMailingAddress) {
  const [row] = await db.insert(mailingAddresses).values(values).returning();
  return row;
}

export async function linkOwner(propertyId: number, ownerId: number) {
  await db.insert(propertyOwners).values({ propertyId, ownerId });
}

export async function addCampaign(values: NewCampaign) {
  const [row] = await db.insert(campaigns).values(values).returning();
  return row;
}

export async function addMailing(values: NewMailing) {
  const [row] = await db.insert(mailings).values(values).returning();
  return row;
}

export async function addDeal(values: NewDeal) {
  const [row] = await db.insert(deals).values(values).returning();
  return row;
}

export async function addSuppression(values: NewMailingSuppression) {
  const [row] = await db.insert(mailingSuppression).values(values).returning();
  return row;
}

export async function addSourceLink(propertyId: number, sourceLink: string) {
  await db.insert(sourceMetadata).values({ propertyId, sourceLink });
}

export async function countRows(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(rows[0].n);
}

/** Loads the real Express app (server/index.ts) with the current env. */
export async function loadApp() {
  const mod = await import('../../server/index.ts');
  return mod.default;
}
