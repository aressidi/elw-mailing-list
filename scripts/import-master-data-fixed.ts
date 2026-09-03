import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  properties, owners, propertyOwners, mailingAddresses, campaigns, mailings,
  dataSources, mailingSuppression, deals, sourceMetadata,
} from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { normalizeCampaignName, cleanSheetLink, UNASSIGNED_CAMPAIGN_NAME } from './campaign-normalize';
import { isSeedOwner, deleteSeedOwnerLinksForProperty } from './seed-owner-utils';
import { normalizeIdentityName, ownerIdentityKey } from './owner-identity';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const SHEET_ID = '1SrqwoqPlxmceae5y7DylTvUkVOXjyb58dsjDY3KQ7zA';

interface SheetRow {
  apn: string;
  county: string;
  state: string;
  acres: string;
  sheetName: string;
  sheetLink: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhone: string;
  mailingAddress1: string;
  mailingAddress2: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  situsAddress: string;
  situsCity: string;
  legalDescription: string;
  dataSource: string;
  offerPrice: string;
  toMail: string;
  mailingDate1: string;
  mailingDate2: string;
  mailingDate3: string;
  mailExclusion: string;
  mailExclusionReason: string;
  badAddress: string;
  hitType: string;
  hitDate: string;
  hitSource: string;
  prospect: string;
  prospectDate: string;
  prospectSource: string;
  doNotMail: string;
}

function parseSheetData(rawData: any[]): SheetRow[] {
  const rows: SheetRow[] = [];
  
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    rows.push({
      apn: row[1] || '',
      county: row[2] || '',
      state: row[3] || '',
      acres: row[4] || '',
      sheetName: row[5] || '',
      sheetLink: row[6] || '',
      ownerFirstName: row[7] || '',
      ownerLastName: row[8] || '',
      ownerEmail: row[9] || '',
      ownerPhone: row[10] || '',
      mailingAddress1: row[12] || '',
      mailingAddress2: row[13] || '',
      mailingCity: row[14] || '',
      mailingState: row[15] || '',
      mailingZip: row[16] || '',
      situsAddress: row[17] || '',
      situsCity: row[18] || '',
      legalDescription: row[19] || '',
      dataSource: row[20] || '',
      offerPrice: row[21] || '',
      toMail: row[22] || '',
      mailingDate1: row[23] || '',
      mailingDate2: row[24] || '',
      mailingDate3: row[25] || '',
      mailExclusion: row[26] || '',
      mailExclusionReason: row[27] || '',
      badAddress: row[28] || '',
      hitType: row[29] || '',
      hitDate: row[30] || '',
      hitSource: row[31] || '',
      prospect: row[32] || '',
      prospectDate: row[33] || '',
      doNotMail: row[34] || '',
    });
  }
  
  return rows;
}

function getOwnerType(name: string): 'individual' | 'company' | 'trust' | 'llc' | 'other' {
  const upper = name.toUpperCase();
  if (upper.includes('TRUST') || upper.includes('REV TRUST') || upper.includes('LIVING TRUST')) return 'trust';
  if (upper.includes('LLC') || upper.includes('L.L.C')) return 'llc';
  if (upper.includes('INC') || upper.includes('CORP') || upper.includes('COMPANY')) return 'company';
  return 'individual';
}

function parseOfferPrice(price: string): string | null {
  if (!price) return null;
  const cleaned = price.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed.toString();
}

function parseAcres(acres: string): string | null {
  if (!acres) return null;
  const cleaned = acres.toString().replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed.toString();
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

function parseBoolean(val: string): boolean {
  if (!val) return false;
  const v = val.toString().toLowerCase().trim();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}

async function main() {
  console.log('Connecting to database...');
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);
  
  console.log('Fetching sheet metadata...');
  const { execSync } = await import('child_process');
  
  const metadataCmd = `export GOG_ACCOUNT=alex@eastonlandworks.com && gog sheets metadata ${SHEET_ID} --json`;
  const metadata = JSON.parse(execSync(metadataCmd, { encoding: 'utf-8' }));
  const masterSheet = metadata.sheets.find((s: any) => s.properties.title === 'Master');
  const totalRows = masterSheet?.properties.gridProperties.rowCount || 12000;
  const batchSize = 500;
  const numBatches = Math.ceil((totalRows - 1) / batchSize);
  
  console.log(`Sheet has ${totalRows} rows, processing in ${numBatches} batches of ${batchSize}`);
  
  let stats = {
    properties: 0,
    owners: 0,
    ownersReused: 0,
    ownersMismatchedAddress: 0,
    propertyOwners: 0,
    mailingAddresses: 0,
    campaigns: 0,
    mailings: 0,
    suppressions: 0,
    deals: 0,
    errors: 0,
    skipped: 0,
    seedOwnersReplaced: 0,
  };

  // Active tracking for memory-based duplicate prevention. Tracks, per APN,
  // which owner claimed it and whether that owner was a seed/test row — a
  // later real-owner row for the same APN is allowed to supersede an earlier
  // seed row (see the dedup check below), but never the reverse.
  const apnOwnerByApn = new Map<string, { ownerId: number; isSeed: boolean }>();
  // Owner identity rule (see scripts/owner-identity.ts): reuse an existing
  // owner ONLY when name + zip + full mailing address all match exactly.
  // ownerIdentityToId is the authoritative dedup map; ownerNamesSeen is kept
  // only to report how often a name recurred at a different address
  // (stats.ownersMismatchedAddress), which is otherwise invisible once a
  // new owner row is minted.
  const ownerIdentityToId = new Map<string, number>(); // name+address key -> id
  const ownerNamesSeen = new Set<string>(); // normalized name -> seen at least once
  const addressToId = new Map<string, number>(); // owner+full-address composite -> id

  // Create default data source
  console.log('Creating data source...');
  const dataSourceResult = await db.insert(dataSources).values({
    name: 'consolidated_master_2026',
    description: 'Consolidated Master Mailing List 2026',
  }).onConflictDoUpdate({
    target: dataSources.name,
    set: { description: 'Consolidated Master Mailing List 2026' }
  }).returning();
  const dataSourceId = dataSourceResult[0].id;
  
  // Load existing campaigns (find-or-create by exact name; campaigns.name has no unique
  // constraint, so dedup is done in-memory the same way owner names are deduped below).
  console.log('Loading existing campaigns...');
  const campaignNameToId = new Map<string, number>();
  const existingCampaigns = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
  for (const c of existingCampaigns) {
    if (!campaignNameToId.has(c.name)) campaignNameToId.set(c.name, c.id);
  }
  console.log(`Found ${existingCampaigns.length} existing campaigns`);

  async function resolveCampaignId(sheetName: string, sheetLink: string): Promise<number> {
    const name = normalizeCampaignName(sheetName);
    const link = cleanSheetLink(sheetLink);
    if (campaignNameToId.has(name)) {
      return campaignNameToId.get(name)!;
    }
    const result = await db.insert(campaigns).values({
      name,
      link,
    }).returning();
    const id = result[0].id;
    campaignNameToId.set(name, id);
    stats.campaigns++;
    return id;
  }

  // Load existing owners (joined to their mailing address, if any) so the
  // in-run identity map matches the same name+zip+full-address rule applied
  // to every row below. An owner with multiple pre-existing addresses (e.g.
  // from data imported before this fix) contributes one identity-key entry
  // per address, all pointing at that same owner id.
  console.log('Loading existing owners...');
  const existingOwners = await db.select({
    id: owners.id,
    ownerName: owners.ownerName,
    line1: mailingAddresses.addressLine1,
    line2: mailingAddresses.addressLine2,
    city: mailingAddresses.city,
    state: mailingAddresses.state,
    zip: mailingAddresses.zip,
  }).from(owners).leftJoin(mailingAddresses, eq(mailingAddresses.ownerId, owners.id));
  const existingOwnerIds = new Set<number>();
  for (const o of existingOwners) {
    existingOwnerIds.add(o.id);
    ownerNamesSeen.add(normalizeIdentityName(o.ownerName));
    ownerIdentityToId.set(ownerIdentityKey(o.ownerName, o), o.id);
  }
  console.log(`Found ${existingOwnerIds.size} existing owners`);
  
  for (let batch = 0; batch < numBatches; batch++) {
    const startRow = batch * batchSize + 2;
    const endRow = Math.min(startRow + batchSize - 1, totalRows);
    
    console.log(`\nProcessing batch ${batch + 1}/${numBatches} (rows ${startRow}-${endRow})...`);
    
    try {
      const cmd = `export GOG_ACCOUNT=alex@eastonlandworks.com && gog sheets get ${SHEET_ID} "'Master'!A${startRow}:AJ${endRow}" --json 2>&1`;
      const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      const data = JSON.parse(result);
      
      if (!data.values || data.values.length === 0) {
        console.log('  No data in this batch, skipping...');
        continue;
      }
      
      const rows = parseSheetData(data.values);
      console.log(`  Retrieved ${rows.length} rows`);
      
      for (const row of rows) {
        try {
          if (!row.apn || row.apn.trim() === '') {
            stats.skipped++;
            continue;
          }
          
          const apn = row.apn.trim().toUpperCase();

          // Resolve this row's owner name/type up front so the dedup check
          // below can tell a real owner apart from a seed/test row.
          let ownerName = row.ownerLastName || '';
          if (row.ownerFirstName) {
            ownerName = `${row.ownerFirstName} ${ownerName}`.trim();
          }
          if (!ownerName) {
            ownerName = `Unknown Owner - ${apn}`;
          }
          const rowIsSeed = isSeedOwner(ownerName);

          const claimedBy = apnOwnerByApn.get(apn);
          if (claimedBy) {
            if (claimedBy.isSeed && !rowIsSeed) {
              // A real owner row has arrived for an APN a seed/test row
              // previously claimed — let the real owner take over below
              // instead of skipping.
            } else {
              stats.skipped++;
              continue;
            }
          }

          // ========== PROPERTY ==========
          const propertyResult = await db.insert(properties).values({
            apn: apn,
            state: row.state?.trim().toUpperCase() || null,
            county: row.county?.trim() || null,
            acres: parseAcres(row.acres),
            legalDescription: row.legalDescription?.trim() || null,
            dataSourceId: dataSourceId,
            sourceAcquiredDate: parseDate(row.mailingDate1) || new Date('2026-01-01'),
          }).onConflictDoUpdate({
            target: properties.apn,
            set: {
              acres: parseAcres(row.acres),
              legalDescription: row.legalDescription?.trim() || null,
            }
          }).returning();
          const propertyId = propertyResult[0].id;
          stats.properties++;

          // ========== OWNER - resolve by name + zip + full mailing address ==========
          // See scripts/owner-identity.ts: reuse an existing owner ONLY when
          // name, zip, and the full mailing address all match exactly.
          const ownerType = getOwnerType(ownerName);
          const rowAddress = {
            line1: row.mailingAddress1?.trim() || null,
            line2: row.mailingAddress2?.trim() || null,
            city: row.mailingCity?.trim() || null,
            state: row.mailingState?.trim().toUpperCase() || null,
            zip: row.mailingZip?.trim() || null,
          };
          const identityKey = ownerIdentityKey(ownerName, rowAddress);
          const normalizedName = normalizeIdentityName(ownerName);

          let ownerId: number;
          if (ownerIdentityToId.has(identityKey)) {
            ownerId = ownerIdentityToId.get(identityKey)!;
            stats.ownersReused++;
          } else {
            if (ownerNamesSeen.has(normalizedName)) {
              stats.ownersMismatchedAddress++;
            }
            const ownerResult = await db.insert(owners).values({
              firstName: row.ownerFirstName?.trim() || null,
              lastName: row.ownerLastName?.trim() || null,
              ownerName: ownerName,
              ownerType: ownerType,
            }).returning();
            ownerId = ownerResult[0].id;
            ownerIdentityToId.set(identityKey, ownerId);
            ownerNamesSeen.add(normalizedName);
            stats.owners++;
          }

          // A real owner is taking over an APN a seed/test row previously
          // claimed: that seed row's mailing never really happened, so purge
          // its links to this property rather than letting it block or
          // shadow the real owner being linked in below.
          if (claimedBy?.isSeed && !rowIsSeed && claimedBy.ownerId !== ownerId) {
            await deleteSeedOwnerLinksForProperty(db, propertyId, claimedBy.ownerId);
            stats.seedOwnersReplaced++;
          }
          apnOwnerByApn.set(apn, { ownerId, isSeed: rowIsSeed });

          // ========== PROPERTY_OWNERS ==========
          await db.insert(propertyOwners).values({
            propertyId: propertyId,
            ownerId: ownerId,
          }).onConflictDoNothing();
          stats.propertyOwners++;

          // ========== MAILING ADDRESS ==========
          if (row.mailingAddress1 || row.mailingCity) {
            const addressKey = `${ownerId}|${identityKey}`;

            let mailingAddressId: number;
            if (addressToId.has(addressKey)) {
              mailingAddressId = addressToId.get(addressKey)!;
            } else {
              const addressResult = await db.insert(mailingAddresses).values({
                ownerId: ownerId,
                addressLine1: rowAddress.line1,
                addressLine2: rowAddress.line2,
                city: rowAddress.city,
                state: rowAddress.state,
                zip: rowAddress.zip,
              }).returning();
              mailingAddressId = addressResult[0].id;
              addressToId.set(addressKey, mailingAddressId);
              stats.mailingAddresses++;
            }

            // ========== MAILING ==========
            const mailDate = parseDate(row.mailingDate1);
            if (mailDate || row.offerPrice) {
              const campaignId = await resolveCampaignId(row.sheetName, row.sheetLink);
              await db.insert(mailings).values({
                propertyId: propertyId,
                ownerId: ownerId,
                mailingAddressId: mailingAddressId,
                campaignId: campaignId,
                mailDate: mailDate,
                offerPrice: parseOfferPrice(row.offerPrice),
              }).onConflictDoNothing();
              stats.mailings++;
            }
            
            // ========== MAILING SUPPRESSION ==========
            if (parseBoolean(row.doNotMail)) {
              await db.insert(mailingSuppression).values({
                ownerId: ownerId,
                propertyId: propertyId,
                reason: 'do_not_mail',
              }).onConflictDoNothing();
              stats.suppressions++;
            }
            
            if (parseBoolean(row.badAddress)) {
              await db.insert(mailingSuppression).values({
                ownerId: ownerId,
                propertyId: propertyId,
                reason: 'bad_address',
              }).onConflictDoNothing();
              if (!parseBoolean(row.doNotMail)) stats.suppressions++;
            }
          }
          
          // ========== DEALS ==========
          if (row.hitDate || row.hitType) {
            const hitType = row.hitType?.toLowerCase() as any || 'call';
            if (['call', 'email', 'website', 'text', 'mail', 'other'].includes(hitType)) {
              await db.insert(deals).values({
                propertyId: propertyId,
                ownerId: ownerId,
                hitType: hitType,
                hitDate: parseDate(row.hitDate) || new Date(),
                isLead: parseBoolean(row.prospect),
                isConversion: false,
              }).onConflictDoNothing();
              stats.deals++;
            }
          }
          
          // ========== SOURCE METADATA ==========
          if (row.sheetLink) {
            await db.insert(sourceMetadata).values({
              propertyId: propertyId,
              sourceId: dataSourceId,
              sourceLink: row.sheetLink,
            }).onConflictDoNothing();
          }
          
        } catch (rowError: any) {
          console.error(`  Error processing APN ${row.apn}: ${rowError.message}`);
          stats.errors++;
        }
      }
      
      console.log(`  Batch ${batch + 1} complete. Props: ${stats.properties}, Owners: ${stats.owners}, Mailings: ${stats.mailings}`);
      
    } catch (batchError: any) {
      console.error(`  Error in batch ${batch + 1}: ${batchError.message}`);
      stats.errors += batchSize;
    }
  }
  
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Total unique APNs: ${apnOwnerByApn.size}`);
  console.log(`Properties inserted: ${stats.properties}`);
  console.log(`Owners created: ${stats.owners}`);
  console.log(`Owners reused (name+zip+address matched): ${stats.ownersReused}`);
  console.log(`Owners created despite name match (address mismatch): ${stats.ownersMismatchedAddress}`);
  console.log(`Property-Owner links: ${stats.propertyOwners}`);
  console.log(`Mailing addresses: ${stats.mailingAddresses}`);
  console.log(`Mailings created: ${stats.mailings}`);
  console.log(`Suppression records: ${stats.suppressions}`);
  console.log(`Deals created: ${stats.deals}`);
  console.log(`Rows skipped: ${stats.skipped}`);
  console.log(`Seed owners replaced by real owners: ${stats.seedOwnersReplaced}`);
  console.log(`Errors: ${stats.errors}`);
  
  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
