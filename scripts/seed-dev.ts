/**
 * Development seed script — populates the local database with sample data
 * so the UI has something to render. Safe to re-run: it truncates first.
 *
 *   npx tsx scripts/seed-dev.ts
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';
import * as schema from '../shared/schema.ts';

dotenv.config();

const {
  dataSources, properties, owners, propertyOwners, mailingAddresses,
  campaigns, mailings, deals, mailingSuppression, sourceMetadata,
  seedDataSources,
} = schema;

const COUNTIES = [
  { state: 'TX', county: 'Hudspeth', zip: '79851' },
  { state: 'TX', county: 'Culberson', zip: '79847' },
  { state: 'NM', county: 'Luna', zip: '88030' },
  { state: 'AZ', county: 'Mohave', zip: '86413' },
  { state: 'CO', county: 'Costilla', zip: '81133' },
  { state: 'NV', county: 'Nye', zip: '89060' },
];

const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Susan', 'Carlos', 'Nancy', 'Michael', 'Karen'];
const LAST = ['Alvarez', 'Whitfield', 'Nakamura', 'Okonkwo', 'Petersen', 'Reyes', 'Brennan', 'Kowalski', 'Ferrand', 'Ibarra'];
const CITIES = [
  { city: 'El Paso', state: 'TX', zip: '79901' },
  { city: 'Albuquerque', state: 'NM', zip: '87102' },
  { city: 'Phoenix', state: 'AZ', zip: '85004' },
  { city: 'Denver', state: 'CO', zip: '80202' },
  { city: 'Las Vegas', state: 'NV', zip: '89101' },
  { city: 'Austin', state: 'TX', zip: '78701' },
];

const HIT_TYPES = ['call', 'email', 'website', 'text', 'mail', 'other'] as const;
const SUPPRESSION_REASONS = ['do_not_mail', 'bad_address', 'deceased', 'sold', 'other'] as const;
const OWNER_TYPES = ['individual', 'company', 'trust', 'llc', 'other'] as const;

// Deterministic PRNG so re-runs produce the same dataset.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/elw_mailing_list';
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log(`Seeding ${connectionString.replace(/:[^:@]*@/, ':***@')}`);

  // Wipe in dependency order and reset identity sequences.
  await db.execute(sql`TRUNCATE TABLE
    source_metadata, mailing_suppression, deals, mailings, campaigns,
    mailing_addresses, property_owners, owners, properties, data_sources
    RESTART IDENTITY CASCADE`);

  const sources = await db.insert(dataSources).values(seedDataSources).returning();
  console.log(`  data_sources:        ${sources.length}`);

  // ── Properties ──────────────────────────────────────────────
  const propertyRows = Array.from({ length: 120 }, (_, i) => {
    const loc = pick(COUNTIES);
    return {
      apn: `${loc.state}-${String(int(1000, 9999))}-${String(i).padStart(4, '0')}`,
      state: loc.state,
      county: loc.county,
      zip: loc.zip,
      latitude: (31 + rand() * 7).toFixed(6),
      longitude: (-114 + rand() * 10).toFixed(6),
      acres: (rand() * 40 + 0.5).toFixed(2),
      legalDescription: `LOT ${int(1, 200)} BLK ${int(1, 40)}, ${loc.county.toUpperCase()} RANCH ESTATES UNIT ${int(1, 9)}`,
      dataSourceId: pick(sources).id,
      sourceAcquiredDate: daysAgo(int(30, 400)),
    };
  });
  const props = await db.insert(properties).values(propertyRows).returning();
  console.log(`  properties:          ${props.length}`);

  // ── Owners ──────────────────────────────────────────────────
  const ownerRows = Array.from({ length: 90 }, () => {
    const type = rand() < 0.75 ? 'individual' : pick(OWNER_TYPES);
    if (type === 'individual') {
      const first = pick(FIRST);
      const last = pick(LAST);
      return { firstName: first, lastName: last, ownerName: `${first} ${last}`, ownerType: type };
    }
    const name = `${pick(LAST)} ${pick(['Holdings', 'Land Co', 'Family Trust', 'Ventures', 'Properties'])}`;
    return { firstName: null, lastName: null, ownerName: name, ownerType: type };
  });
  const owns = await db.insert(owners).values(ownerRows).returning();
  console.log(`  owners:              ${owns.length}`);

  // ── Property ↔ Owner links (some properties co-owned) ───────
  const links = new Set<string>();
  const linkRows: { propertyId: number; ownerId: number }[] = [];
  for (const p of props) {
    const n = rand() < 0.2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const o = pick(owns);
      const key = `${p.id}:${o.id}`;
      if (links.has(key)) continue;
      links.add(key);
      linkRows.push({ propertyId: p.id, ownerId: o.id });
    }
  }
  await db.insert(propertyOwners).values(linkRows);
  console.log(`  property_owners:     ${linkRows.length}`);

  // ── Mailing addresses ───────────────────────────────────────
  const addrRows = owns.map((o) => {
    const c = pick(CITIES);
    return {
      ownerId: o.id,
      addressLine1: `${int(100, 9999)} ${pick(['Mesa', 'Cottonwood', 'Juniper', 'Ridgeline', 'Alamo', 'Sagebrush'])} ${pick(['St', 'Ave', 'Rd', 'Dr', 'Ln'])}`,
      addressLine2: rand() < 0.15 ? `Unit ${int(1, 40)}` : null,
      city: c.city,
      state: c.state,
      zip: c.zip,
    };
  });
  const addrs = await db.insert(mailingAddresses).values(addrRows).returning();
  console.log(`  mailing_addresses:   ${addrs.length}`);
  const addrByOwner = new Map(addrs.map((a) => [a.ownerId, a]));

  // ── Campaigns ───────────────────────────────────────────────
  const campaignRows = [
    { name: 'Q1 2026 West Texas Blind Offer', link: 'https://example.com/campaigns/q1-2026-wtx' },
    { name: 'Q2 2026 Desert Southwest Push', link: 'https://example.com/campaigns/q2-2026-dsw' },
    { name: 'Spring 2026 High-Acreage Follow-Up', link: null },
    { name: 'Summer 2026 Colorado Test', link: 'https://example.com/campaigns/su-2026-co' },
  ];
  const camps = await db.insert(campaigns).values(campaignRows).returning();
  console.log(`  campaigns:           ${camps.length}`);

  // ── Mailings ────────────────────────────────────────────────
  const mailingRows: typeof mailings.$inferInsert[] = [];
  for (const link of linkRows) {
    if (rand() > 0.65) continue;
    const addr = addrByOwner.get(link.ownerId);
    mailingRows.push({
      propertyId: link.propertyId,
      ownerId: link.ownerId,
      mailingAddressId: addr?.id ?? null,
      campaignId: pick(camps).id,
      mailDate: daysAgo(int(1, 180)),
      offerPrice: (int(2, 60) * 500).toFixed(2),
    });
  }
  const mails = await db.insert(mailings).values(mailingRows).returning();
  console.log(`  mailings:            ${mails.length}`);

  // ── Deals / responses (~12% response rate) ──────────────────
  const dealRows: typeof deals.$inferInsert[] = [];
  for (const m of mails) {
    if (rand() > 0.12) continue;
    const isLead = rand() < 0.45;
    dealRows.push({
      propertyId: m.propertyId,
      ownerId: m.ownerId,
      hitType: pick(HIT_TYPES),
      hitDate: daysAgo(int(1, 120)),
      isLead,
      isConversion: isLead && rand() < 0.3,
    });
  }
  const dls = await db.insert(deals).values(dealRows).returning();
  console.log(`  deals:               ${dls.length}`);

  // ── Suppression (unique on owner+property) ──────────────────
  const suppSeen = new Set<string>();
  const suppRows: typeof mailingSuppression.$inferInsert[] = [];
  for (const link of linkRows) {
    if (rand() > 0.07) continue;
    const key = `${link.ownerId}:${link.propertyId}`;
    if (suppSeen.has(key)) continue;
    suppSeen.add(key);
    suppRows.push({ ownerId: link.ownerId, propertyId: link.propertyId, reason: pick(SUPPRESSION_REASONS) });
  }
  await db.insert(mailingSuppression).values(suppRows);
  console.log(`  mailing_suppression: ${suppRows.length}`);

  // ── Source metadata ─────────────────────────────────────────
  const metaRows = props
    .filter(() => rand() < 0.6)
    .map((p) => ({
      propertyId: p.id,
      sourceId: p.dataSourceId,
      externalId: `EXT-${int(100000, 999999)}`,
      sourceLink: `https://example.com/parcels/${p.apn}`,
      estimatedValue: (int(4, 120) * 500).toFixed(2),
    }));
  await db.insert(sourceMetadata).values(metaRows);
  console.log(`  source_metadata:     ${metaRows.length}`);

  await pool.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
