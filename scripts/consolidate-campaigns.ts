// Consolidates the ~5,486 fragmented per-row campaign records (root cause:
// Consolidated Master Google Sheet columns F "Sheet Name" / G "Sheet Link"
// carry a per-row auto-incremented counter/suffix, so verbatim matching
// during import created ~1 campaign per mailing/owner) into the true
// ~15-20 canonical parent campaigns, rolling up every mailing to its real
// campaign.
//
// Usage:
//   npx tsx scripts/consolidate-campaigns.ts            # dry-run (read-only)
//   npx tsx scripts/consolidate-campaigns.ts --apply     # writes the DB

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { campaigns, mailings } from '../shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { normalizeCampaignName, cleanSheetLink, UNASSIGNED_CAMPAIGN_NAME } from './campaign-normalize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const APPLY = process.argv.includes('--apply');

interface CanonicalGroup {
  canonicalName: string;
  canonicalLink: string | null;
  memberCampaignIds: number[];
  mailingCountBefore: number;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes DB!)' : 'DRY-RUN (read-only)'}`);

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log('\n=== STEP 1: Load existing campaigns ===');
  const existingCampaigns = await db.select().from(campaigns);
  console.log(`Loaded ${existingCampaigns.length} existing campaign records.`);

  console.log('\n=== STEP 2: Load mailing counts per campaign ===');
  const mailingCounts = await db
    .select({ campaignId: mailings.campaignId, count: sql<number>`count(*)::int` })
    .from(mailings)
    .groupBy(mailings.campaignId);
  const mailingCountByCampaignId = new Map<number, number>();
  let totalMailingsBefore = 0;
  for (const row of mailingCounts) {
    if (row.campaignId !== null) mailingCountByCampaignId.set(row.campaignId, row.count);
    totalMailingsBefore += row.count;
  }
  console.log(`Total mailings across all campaigns: ${totalMailingsBefore} (expect 11433)`);

  console.log('\n=== STEP 3: Group campaigns by normalized canonical name ===');
  const groups = new Map<string, CanonicalGroup>();
  for (const c of existingCampaigns) {
    const canonicalName = normalizeCampaignName(c.name);
    let group = groups.get(canonicalName);
    if (!group) {
      group = { canonicalName, canonicalLink: null, memberCampaignIds: [], mailingCountBefore: 0 };
      groups.set(canonicalName, group);
    }
    group.memberCampaignIds.push(c.id);
    group.mailingCountBefore += mailingCountByCampaignId.get(c.id) || 0;
    if (!group.canonicalLink) {
      const link = cleanSheetLink(c.link);
      if (link) group.canonicalLink = link;
    }
  }

  console.log(`Distinct canonical campaign groups: ${groups.size} (expect ~15-20)`);
  const sortedGroups = [...groups.values()].sort((a, b) => b.mailingCountBefore - a.mailingCountBefore);
  for (const g of sortedGroups) {
    console.log(`  ${g.mailingCountBefore}\tmailings  <-  ${g.memberCampaignIds.length}\tcampaign rows  "${g.canonicalName}"`);
  }

  const totalMailingsInGroups = sortedGroups.reduce((sum, g) => sum + g.mailingCountBefore, 0);
  console.log(`\nConservation check (mailings): ${totalMailingsInGroups} == ${totalMailingsBefore} -- ${totalMailingsInGroups === totalMailingsBefore ? 'OK' : 'MISMATCH'}`);

  // ---- Write report ----
  const modeLabel = APPLY ? 'apply' : 'dry-run';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `consolidate-campaigns-${modeLabel}-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: modeLabel,
    totalCampaignsBefore: existingCampaigns.length,
    totalCanonicalGroups: groups.size,
    totalMailingsBefore,
    groups: sortedGroups.map(g => ({
      canonicalName: g.canonicalName,
      canonicalLink: g.canonicalLink,
      memberCampaignCount: g.memberCampaignIds.length,
      mailingCountBefore: g.mailingCountBefore,
    })),
  }, null, 2));
  console.log(`\nReport written: ${reportPath}`);

  if (!APPLY) {
    await pool.end();
    console.log('\n=== DRY RUN COMPLETE. No database writes were made. ===');
    return;
  }

  console.log('\n=== STEP 4: APPLY — consolidating in a single transaction ===');

  await db.transaction(async (tx) => {
    let mailingsUpdated = 0;
    let campaignsDeleted = 0;

    for (const group of sortedGroups) {
      // Find-or-create the canonical campaign row for this group. Prefer
      // reusing an existing row (the one with the lowest id) as the
      // canonical survivor so campaign ids stay stable where possible.
      const survivorId = Math.min(...group.memberCampaignIds);

      await tx.update(campaigns)
        .set({ name: group.canonicalName, link: group.canonicalLink })
        .where(eq(campaigns.id, survivorId));

      const idsToRetire = group.memberCampaignIds.filter(id => id !== survivorId);

      if (idsToRetire.length > 0) {
        const result = await tx.update(mailings)
          .set({ campaignId: survivorId })
          .where(inArray(mailings.campaignId, idsToRetire))
          .returning({ id: mailings.id });
        mailingsUpdated += result.length;

        const deleted = await tx.delete(campaigns)
          .where(inArray(campaigns.id, idsToRetire))
          .returning({ id: campaigns.id });
        campaignsDeleted += deleted.length;
      }
    }

    console.log(`Mailings re-pointed to canonical campaign: ${mailingsUpdated}`);
    console.log(`Redundant campaign rows deleted: ${campaignsDeleted}`);
  });

  console.log('\n=== APPLY COMPLETE ===');

  console.log('\n=== STEP 5: Post-apply verification ===');
  const postMailingCount = await db.select({ count: sql<number>`count(*)::int` }).from(mailings);
  const postCampaignCount = await db.select({ count: sql<number>`count(*)::int` }).from(campaigns);
  const postNullCampaignId = await db.select({ count: sql<number>`count(*)::int` }).from(mailings).where(sql`campaign_id IS NULL`);
  console.log(`Post-apply mailings total: ${postMailingCount[0].count} (expect 11433)`);
  console.log(`Post-apply campaigns total: ${postCampaignCount[0].count} (expect ~15-20)`);
  console.log(`Post-apply mailings with NULL campaign_id: ${postNullCampaignId[0].count} (expect 0)`);

  if (postMailingCount[0].count !== 11433) {
    console.error('VERIFICATION FAILED: mailing count changed!');
    process.exitCode = 1;
  }
  if (postNullCampaignId[0].count !== 0) {
    console.error('VERIFICATION FAILED: some mailings have a null campaign_id!');
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
