// One-off remediation for 5 properties whose owner was erroneously recorded
// as a seed/test row ('Alex Ressi', 'Rocket Print') instead of the real
// landowner, because an earlier import ran before isSeedOwner() existed and
// let whichever row for an APN happened to come first (often a seed/test
// row placed early in the Consolidated Master Google Sheet) win.
//
// For each of the 5 properties, this script:
//   1. Fetches the real owner's name + mailing address directly from the
//      known 'Master' sheet row via the `gog` CLI (same source the import
//      scripts use), verifying the row's APN before trusting it.
//   2. Finds-or-creates the real owner + their mailing address.
//   3. Links the real owner to the property (property_owners) and re-points
//      the property's existing mailings (preserving mail date/campaign/offer
//      price — those mailings genuinely went out, only the owner on file was
//      wrong) to the real owner + address.
//   4. Removes the seed owner's link to that one property (property_owners,
//      and any mailing_suppression/deals tied to that property+seed owner)
//      without touching the seed owner row itself or its links elsewhere.
//
// Usage:
//   npx tsx scripts/patch-seed-owners.ts            # dry-run (read-only)
//   npx tsx scripts/patch-seed-owners.ts --apply     # writes the DB

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { and, eq } from 'drizzle-orm';
import {
  properties, owners, propertyOwners, mailingAddresses, mailings, mailingSuppression, deals,
} from '../shared/schema';
import { isSeedOwner } from './seed-owner-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const SHEET_ID = '1SrqwoqPlxmceae5y7DylTvUkVOXjyb58dsjDY3KQ7zA';
const GOG_CMD_PREFIX = 'export GOG_ACCOUNT=alex@eastonlandworks.com &&';
const APPLY = process.argv.includes('--apply');

// Same 36-column (A:AJ) layout the import scripts use for the 'Master' tab.
interface SheetRow {
  apn: string;
  ownerFirstName: string;
  ownerLastName: string;
  mailingAddress1: string;
  mailingAddress2: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
}

function parseSheetRow(raw: string[]): SheetRow {
  return {
    apn: (raw[1] || '').toString().trim(),
    ownerFirstName: (raw[7] || '').toString().trim(),
    ownerLastName: (raw[8] || '').toString().trim(),
    mailingAddress1: (raw[12] || '').toString().trim(),
    mailingAddress2: (raw[13] || '').toString().trim(),
    mailingCity: (raw[14] || '').toString().trim(),
    mailingState: (raw[15] || '').toString().trim(),
    mailingZip: (raw[16] || '').toString().trim(),
  };
}

function fetchSheetRows(startRow: number, endRow: number): string[][] {
  const cmd = `${GOG_CMD_PREFIX} gog sheets get ${SHEET_ID} "'Master'!A${startRow}:AJ${endRow}" --json 2>&1`;
  const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  const data = JSON.parse(result);
  return data.values || [];
}

/**
 * Fetches the sheet row for a fix by its known row number, verifying the APN
 * matches. Falls back to searching a window around that row in case rows
 * shifted since the row number was recorded.
 */
function resolveSheetRow(fix: SeedOwnerFix): SheetRow {
  const exactRows = fetchSheetRows(fix.masterSheetRow, fix.masterSheetRow);
  if (exactRows.length > 0) {
    const row = parseSheetRow(exactRows[0]);
    if (row.apn.toUpperCase() === fix.apn.toUpperCase()) return row;
  }

  console.warn(`  Row ${fix.masterSheetRow} did not match APN ${fix.apn} exactly — searching nearby rows...`);
  const windowStart = Math.max(2, fix.masterSheetRow - 25);
  const windowEnd = fix.masterSheetRow + 25;
  const windowRows = fetchSheetRows(windowStart, windowEnd);
  for (const raw of windowRows) {
    const row = parseSheetRow(raw);
    if (row.apn.toUpperCase() === fix.apn.toUpperCase()) return row;
  }

  throw new Error(
    `Could not find a Master sheet row matching APN ${fix.apn} near row ${fix.masterSheetRow} ` +
    `(searched rows ${windowStart}-${windowEnd}). Update masterSheetRow and re-run.`
  );
}

function getOwnerType(name: string): 'individual' | 'company' | 'trust' | 'llc' | 'other' {
  const upper = name.toUpperCase();
  if (upper.includes('TRUST')) return 'trust';
  if (upper.includes('LLC') || upper.includes('L.L.C')) return 'llc';
  if (upper.includes('INC') || upper.includes('CORP') || upper.includes('COMPANY')) return 'company';
  return 'individual';
}

interface SeedOwnerFix {
  apn: string;
  county: string;
  state: string;
  seedOwnerName: string;
  masterSheetRow: number;
  expectedOwnerName: string;
}

const FIXES: SeedOwnerFix[] = [
  { apn: 'R0026060', county: 'Park', state: 'CO', seedOwnerName: 'Alex Ressi', masterSheetRow: 5625, expectedOwnerName: 'Raceann Abbott' },
  { apn: '022-01006000', county: 'Henry', state: 'GA', seedOwnerName: 'Alex Ressi', masterSheetRow: 8315, expectedOwnerName: 'Bobby Mcdaniel Virgil V' },
  { apn: 'NHMP M:U08 B:031 L:000', county: 'Belknap', state: 'NH', seedOwnerName: 'Alex Ressi', masterSheetRow: 2709, expectedOwnerName: 'Janet Bonnell' },
  { apn: 'R0175341', county: 'Cleveland', state: 'OK', seedOwnerName: 'Alex Ressi', masterSheetRow: 8813, expectedOwnerName: 'Abbey Mcclellan' },
  { apn: '185 A 8B', county: 'Bedford', state: 'VA', seedOwnerName: 'Rocket Print', masterSheetRow: 6507, expectedOwnerName: 'Johnnie Ferrell' },
];

interface FixResult {
  apn: string;
  status: 'planned' | 'applied' | 'skipped' | 'error';
  detail: string;
  seedOwnerId?: number;
  realOwnerId?: number;
  realOwnerName?: string;
  realOwnerIsNew?: boolean;
  realAddressId?: number;
  realAddressIsNew?: boolean;
  mailingsRepointed?: number;
  suppressionsRepointed?: number;
  dealsRepointed?: number;
}

async function processFix(db: any, fix: SeedOwnerFix, apply: boolean): Promise<FixResult> {
  console.log(`\n--- APN ${fix.apn} (${fix.county} County, ${fix.state}) ---`);

  const [property] = await db.select().from(properties).where(eq(properties.apn, fix.apn));
  if (!property) {
    return { apn: fix.apn, status: 'error', detail: `No property found in DB for APN ${fix.apn}` };
  }

  const sheetRow = resolveSheetRow(fix);
  let realOwnerName = [sheetRow.ownerFirstName, sheetRow.ownerLastName].filter(Boolean).join(' ').trim();
  if (!realOwnerName) realOwnerName = fix.expectedOwnerName;
  if (isSeedOwner(realOwnerName)) {
    return { apn: fix.apn, status: 'error', detail: `Sheet row ${fix.masterSheetRow} resolved to a seed owner ('${realOwnerName}') — refusing to patch with seed data` };
  }
  if (realOwnerName.toLowerCase() !== fix.expectedOwnerName.toLowerCase()) {
    console.warn(`  Sheet owner "${realOwnerName}" differs from expected "${fix.expectedOwnerName}" — proceeding with the sheet's value.`);
  }
  console.log(`  Real owner (Master row ${fix.masterSheetRow}): ${realOwnerName}`);
  console.log(`  Mailing address: ${sheetRow.mailingAddress1}${sheetRow.mailingAddress2 ? ' ' + sheetRow.mailingAddress2 : ''}, ${sheetRow.mailingCity}, ${sheetRow.mailingState} ${sheetRow.mailingZip}`);

  // Find the seed owner currently linked to this property (scoped to this
  // property's link, not a global lookup by name).
  const links = await db.select({ ownerId: propertyOwners.ownerId, ownerName: owners.ownerName })
    .from(propertyOwners)
    .innerJoin(owners, eq(propertyOwners.ownerId, owners.id))
    .where(eq(propertyOwners.propertyId, property.id));
  const seedLink = links.find((l: { ownerName: string }) => isSeedOwner(l.ownerName));

  if (!seedLink) {
    const alreadyReal = links.find((l: { ownerName: string }) => l.ownerName.toLowerCase() === realOwnerName.toLowerCase());
    if (alreadyReal) {
      return { apn: fix.apn, status: 'skipped', detail: `Property already linked to real owner "${realOwnerName}" — nothing to do` };
    }
    return { apn: fix.apn, status: 'error', detail: `No seed owner (${fix.seedOwnerName}) currently linked to this property; found: ${links.map((l: { ownerName: string }) => l.ownerName).join(', ') || '(none)'}` };
  }
  const seedOwnerId = seedLink.ownerId;
  console.log(`  Seed owner to remove: "${seedLink.ownerName}" (owner id ${seedOwnerId})`);

  // Find-or-create the real owner.
  const [existingOwner] = await db.select().from(owners).where(eq(owners.ownerName, realOwnerName));
  let realOwnerId: number;
  let realOwnerIsNew = false;
  if (existingOwner) {
    realOwnerId = existingOwner.id;
  } else {
    realOwnerIsNew = true;
    if (apply) {
      const [inserted] = await db.insert(owners).values({
        firstName: sheetRow.ownerFirstName || null,
        lastName: sheetRow.ownerLastName || null,
        ownerName: realOwnerName,
        ownerType: getOwnerType(realOwnerName),
      }).returning();
      realOwnerId = inserted.id;
    } else {
      realOwnerId = -1; // placeholder id for dry-run reporting only
    }
  }

  // Find-or-create the real owner's mailing address.
  let realAddressId: number | undefined;
  let realAddressIsNew = false;
  if (realOwnerId === -1) {
    // Dry-run and the owner itself doesn't exist yet — it can't have an
    // address on file either, so the address will necessarily be new too.
    realAddressIsNew = true;
  } else {
    const existingAddresses = await db.select().from(mailingAddresses).where(eq(mailingAddresses.ownerId, realOwnerId));
    const match = existingAddresses.find((a: typeof mailingAddresses.$inferSelect) =>
      (a.addressLine1 || '').toLowerCase() === sheetRow.mailingAddress1.toLowerCase() &&
      (a.city || '').toLowerCase() === sheetRow.mailingCity.toLowerCase() &&
      (a.zip || '') === sheetRow.mailingZip
    );
    if (match) {
      realAddressId = match.id;
    } else {
      realAddressIsNew = true;
      if (apply) {
        const [insertedAddr] = await db.insert(mailingAddresses).values({
          ownerId: realOwnerId,
          addressLine1: sheetRow.mailingAddress1 || null,
          addressLine2: sheetRow.mailingAddress2 || null,
          city: sheetRow.mailingCity || null,
          state: sheetRow.mailingState?.toUpperCase() || null,
          zip: sheetRow.mailingZip || null,
        }).returning();
        realAddressId = insertedAddr.id;
      }
    }
  }

  let mailingsRepointed = 0;
  let suppressionsRepointed = 0;
  let dealsRepointed = 0;

  if (apply) {
    await db.insert(propertyOwners).values({ propertyId: property.id, ownerId: realOwnerId }).onConflictDoNothing();

    const repointedMailings = await db.update(mailings)
      .set({ ownerId: realOwnerId, mailingAddressId: realAddressId ?? null })
      .where(and(eq(mailings.propertyId, property.id), eq(mailings.ownerId, seedOwnerId)))
      .returning({ id: mailings.id });
    mailingsRepointed = repointedMailings.length;

    // mailing_suppression has a unique (owner_id, property_id) index, so a
    // straight UPDATE could collide with a suppression row that already
    // exists for the real owner — drop the seed row in that case instead.
    const [conflictingSuppression] = await db.select().from(mailingSuppression)
      .where(and(eq(mailingSuppression.propertyId, property.id), eq(mailingSuppression.ownerId, realOwnerId)));
    if (conflictingSuppression) {
      const removed = await db.delete(mailingSuppression)
        .where(and(eq(mailingSuppression.propertyId, property.id), eq(mailingSuppression.ownerId, seedOwnerId)))
        .returning({ id: mailingSuppression.id });
      suppressionsRepointed = removed.length;
    } else {
      const repointedSuppressions = await db.update(mailingSuppression)
        .set({ ownerId: realOwnerId })
        .where(and(eq(mailingSuppression.propertyId, property.id), eq(mailingSuppression.ownerId, seedOwnerId)))
        .returning({ id: mailingSuppression.id });
      suppressionsRepointed = repointedSuppressions.length;
    }

    const repointedDeals = await db.update(deals)
      .set({ ownerId: realOwnerId })
      .where(and(eq(deals.propertyId, property.id), eq(deals.ownerId, seedOwnerId)))
      .returning({ id: deals.id });
    dealsRepointed = repointedDeals.length;

    await db.delete(propertyOwners)
      .where(and(eq(propertyOwners.propertyId, property.id), eq(propertyOwners.ownerId, seedOwnerId)));
  } else {
    const mRows = await db.select().from(mailings).where(and(eq(mailings.propertyId, property.id), eq(mailings.ownerId, seedOwnerId)));
    mailingsRepointed = mRows.length;
    const sRows = await db.select().from(mailingSuppression).where(and(eq(mailingSuppression.propertyId, property.id), eq(mailingSuppression.ownerId, seedOwnerId)));
    suppressionsRepointed = sRows.length;
    const dRows = await db.select().from(deals).where(and(eq(deals.propertyId, property.id), eq(deals.ownerId, seedOwnerId)));
    dealsRepointed = dRows.length;
  }

  console.log(`  ${apply ? 'Repointed' : 'Would repoint'} ${mailingsRepointed} mailing(s), ${suppressionsRepointed} suppression(s), ${dealsRepointed} deal(s) to owner "${realOwnerName}"${realOwnerIsNew ? ' (new)' : ''}.`);
  console.log(`  ${apply ? 'Removed' : 'Would remove'} property_owners link for seed owner id ${seedOwnerId}.`);

  return {
    apn: fix.apn,
    status: apply ? 'applied' : 'planned',
    detail: 'ok',
    seedOwnerId,
    realOwnerId: realOwnerId === -1 ? undefined : realOwnerId,
    realOwnerName,
    realOwnerIsNew,
    realAddressId,
    realAddressIsNew,
    mailingsRepointed,
    suppressionsRepointed,
    dealsRepointed,
  };
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes DB!)' : 'DRY-RUN (read-only)'}`);

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const results: FixResult[] = [];

  if (APPLY) {
    await db.transaction(async (tx: any) => {
      for (const fix of FIXES) {
        const result = await processFix(tx, fix, true);
        results.push(result);
        if (result.status === 'error') {
          throw new Error(`Aborting transaction — fix for APN ${fix.apn} failed: ${result.detail}`);
        }
      }
    });
  } else {
    for (const fix of FIXES) {
      try {
        results.push(await processFix(db, fix, false));
      } catch (e: any) {
        results.push({ apn: fix.apn, status: 'error', detail: e.message || String(e) });
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  ${r.apn}: ${r.status}${r.status === 'error' ? ` — ${r.detail}` : ''}`);
  }

  const modeLabel = APPLY ? 'apply' : 'dry-run';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `patch-seed-owners-${modeLabel}-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: modeLabel, results }, null, 2));
  console.log(`\nReport written: ${reportPath}`);

  const hadErrors = results.some(r => r.status === 'error');

  await pool.end();

  if (!APPLY) {
    console.log('\n=== DRY RUN COMPLETE. No database writes were made. Re-run with --apply to write. ===');
  } else if (!hadErrors) {
    console.log('\n=== APPLY COMPLETE ===');
  }

  if (hadErrors) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
