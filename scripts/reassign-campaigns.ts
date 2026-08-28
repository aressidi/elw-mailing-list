import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { campaigns, mailings, properties } from '../shared/schema';
import { eq, sql, inArray } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const SHEET_ID = '1SrqwoqPlxmceae5y7DylTvUkVOXjyb58dsjDY3KQ7zA';
const UNASSIGNED_NAME = 'Unassigned / No Sheet';

const APPLY = process.argv.includes('--apply');

interface SheetHit {
  sheetName: string;
  sheetLink: string;
}

interface CampaignPlan {
  name: string;
  link: string | null; // first non-empty link seen across all rows mapping to this name
  existingId: number | null;
  targetMailingCount: number;
}

function fetchAllSheetRows(): any[][] {
  const metadataCmd = `export GOG_ACCOUNT=alex@eastonlandworks.com && gog sheets metadata ${SHEET_ID} --json`;
  const metadata = JSON.parse(execSync(metadataCmd, { encoding: 'utf-8' }));
  const masterSheet = metadata.sheets.find((s: any) => s.properties.title === 'Master');
  const totalRows = masterSheet?.properties.gridProperties.rowCount || 12000;
  const batchSize = 500;
  const numBatches = Math.ceil((totalRows - 1) / batchSize);

  console.log(`Master sheet has ${totalRows} rows, fetching in ${numBatches} batches of ${batchSize}...`);

  const allRows: any[][] = [];
  for (let batch = 0; batch < numBatches; batch++) {
    const startRow = batch * batchSize + 2; // skip header
    const endRow = Math.min(startRow + batchSize - 1, totalRows);
    const cmd = `export GOG_ACCOUNT=alex@eastonlandworks.com && gog sheets get ${SHEET_ID} "'Master'!A${startRow}:AJ${endRow}" --json 2>&1`;
    const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    let data: any;
    try {
      data = JSON.parse(result);
    } catch (e) {
      throw new Error(`Failed to parse gog output for batch ${batch + 1} (rows ${startRow}-${endRow}): ${result.slice(0, 500)}`);
    }
    if (!data.values || data.values.length === 0) {
      continue;
    }
    allRows.push(...data.values);
    console.log(`  batch ${batch + 1}/${numBatches}: +${data.values.length} rows (total ${allRows.length})`);
  }
  return allRows;
}

function buildApnIndex(rawRows: any[][]): {
  apnIndex: Map<string, SheetHit>;
  collisions: Array<{ apn: string; hits: SheetHit[] }>;
  sheetNamesSeen: Set<string>;
} {
  const apnIndex = new Map<string, SheetHit>();
  const apnAllHits = new Map<string, SheetHit[]>();
  const sheetNamesSeen = new Set<string>();

  for (const row of rawRows) {
    if (!row || row.length === 0) continue;
    const rawApn = row[1] || '';
    const apn = rawApn.toString().trim().toUpperCase();
    if (!apn) continue;
    const sheetName = (row[5] || '').toString().trim();
    const sheetLink = (row[6] || '').toString().trim();
    if (sheetName) sheetNamesSeen.add(sheetName);

    const hit: SheetHit = { sheetName, sheetLink };
    if (!apnAllHits.has(apn)) apnAllHits.set(apn, []);
    apnAllHits.get(apn)!.push(hit);
  }

  const collisions: Array<{ apn: string; hits: SheetHit[] }> = [];

  for (const [apn, hits] of apnAllHits.entries()) {
    if (hits.length > 1) {
      // dedupe identical hits before deciding if it's a real collision
      const uniqueKeys = new Set(hits.map(h => `${h.sheetName}|${h.sheetLink}`));
      if (uniqueKeys.size > 1) {
        collisions.push({ apn, hits });
      }
    }
    // deterministic preference: non-empty sheetName + non-empty link first, else first occurrence
    const preferred = hits.find(h => h.sheetName && h.sheetLink) || hits[0];
    apnIndex.set(apn, preferred);
  }

  return { apnIndex, collisions, sheetNamesSeen };
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes DB!)' : 'DRY-RUN (read-only)'}`);

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log('\n=== STEP 1: Fetch sheet data (read-only) ===');
  let rawRows: any[][];
  try {
    rawRows = fetchAllSheetRows();
  } catch (e: any) {
    console.error('FATAL: could not fetch sheet data via gog CLI:', e.message);
    await pool.end();
    process.exit(1);
  }
  console.log(`Fetched ${rawRows.length} total data rows from 'Master' tab.`);

  console.log('\n=== STEP 2: Build APN -> sheet index ===');
  const { apnIndex, collisions, sheetNamesSeen } = buildApnIndex(rawRows);
  console.log(`Indexed ${apnIndex.size} unique APNs across ${sheetNamesSeen.size} distinct sheet names.`);
  console.log(`APN collisions (mapped to >1 distinct sheet/link combo): ${collisions.length}`);

  console.log('\n=== STEP 3: Load mailings joined to property APN ===');
  const mailingRows = await db
    .select({
      mailingId: mailings.id,
      currentCampaignId: mailings.campaignId,
      propertyId: mailings.propertyId,
      apn: properties.apn,
    })
    .from(mailings)
    .leftJoin(properties, eq(mailings.propertyId, properties.id));

  console.log(`Loaded ${mailingRows.length} mailings.`);

  const noPropertyId = mailingRows.filter(m => m.propertyId === null);
  const noApn = mailingRows.filter(m => m.propertyId !== null && !m.apn);
  console.log(`Mailings with null property_id: ${noPropertyId.length}`);
  console.log(`Mailings with property_id but missing/blank APN: ${noApn.length}`);

  console.log('\n=== STEP 4: Load existing campaigns ===');
  const existingCampaigns = await db.select().from(campaigns);
  const campaignByName = new Map<string, typeof existingCampaigns[number]>();
  for (const c of existingCampaigns) {
    // exact-name matching; if duplicate names already exist today (should be 0 per verified facts), keep first
    if (!campaignByName.has(c.name)) campaignByName.set(c.name, c);
  }
  console.log(`Loaded ${existingCampaigns.length} existing campaigns (${campaignByName.size} distinct names).`);

  console.log('\n=== STEP 5: Compute target campaign per mailing ===');

  // campaignPlans keyed by exact name
  const campaignPlans = new Map<string, CampaignPlan>();
  function getOrInitPlan(name: string): CampaignPlan {
    let plan = campaignPlans.get(name);
    if (!plan) {
      const existing = campaignByName.get(name) || null;
      plan = {
        name,
        link: existing?.link || null,
        existingId: existing?.id ?? null,
        targetMailingCount: 0,
      };
      campaignPlans.set(name, plan);
    }
    return plan;
  }

  // ensure Unassigned bucket always exists in the plan
  getOrInitPlan(UNASSIGNED_NAME);

  let resolvedToSheet = 0;
  let resolvedToUnassigned = 0;

  const mailingTargets: Array<{
    mailingId: number;
    currentCampaignId: number | null;
    targetCampaignName: string;
  }> = [];

  const multiMappedApnsHit = new Set<string>();

  for (const m of mailingRows) {
    const apn = m.apn ? m.apn.trim().toUpperCase() : '';
    let targetName: string;

    if (apn && apnIndex.has(apn)) {
      const hit = apnIndex.get(apn)!;
      if (hit.sheetName) {
        targetName = hit.sheetName;
        resolvedToSheet++;
        if (collisions.some(c => c.apn === apn)) multiMappedApnsHit.add(apn);
      } else {
        // APN present in sheet but sheetName column blank
        targetName = UNASSIGNED_NAME;
        resolvedToUnassigned++;
      }
    } else {
      targetName = UNASSIGNED_NAME;
      resolvedToUnassigned++;
    }

    const plan = getOrInitPlan(targetName);
    plan.targetMailingCount++;

    if (apn && apnIndex.has(apn)) {
      const hit = apnIndex.get(apn)!;
      if (hit.sheetLink && !plan.link) {
        plan.link = hit.sheetLink;
      }
    }

    mailingTargets.push({
      mailingId: m.mailingId,
      currentCampaignId: m.currentCampaignId,
      targetCampaignName: targetName,
    });
  }

  console.log(`Mailings resolved to a sheet-name campaign: ${resolvedToSheet}`);
  console.log(`Mailings resolved to '${UNASSIGNED_NAME}': ${resolvedToUnassigned}`);
  console.log(`Total mailings processed: ${mailingTargets.length} (expect 11433)`);

  // ---- Conservation check ----
  if (mailingTargets.length !== mailingRows.length) {
    console.error('QUALITY CHECK FAILED: mailing target count does not match source mailing count.');
  }

  console.log('\n=== STEP 6: Determine campaigns to create / delete / backfill ===');

  const campaignsToCreate: CampaignPlan[] = [];
  const campaignsToBackfillLink: Array<{ id: number; name: string; oldLink: string | null; newLink: string }> = [];

  for (const plan of campaignPlans.values()) {
    if (plan.existingId === null) {
      campaignsToCreate.push(plan);
    } else {
      const existing = existingCampaigns.find(c => c.id === plan.existingId)!;
      if (!existing.link && plan.link) {
        campaignsToBackfillLink.push({ id: existing.id, name: existing.name, oldLink: existing.link, newLink: plan.link });
      }
    }
  }

  // Campaigns that will end up with zero mailings after remap (shells to delete)
  const namesWithMailingsAfter = new Set(
    [...campaignPlans.values()].filter(p => p.targetMailingCount > 0).map(p => p.name)
  );
  const campaignsToDelete = existingCampaigns.filter(
    c => !namesWithMailingsAfter.has(c.name) && c.name !== UNASSIGNED_NAME
  );

  // Campaigns that will be emptied (had mailings before, have zero after) - subset check
  const beforeCounts = new Map<number, number>();
  for (const m of mailingRows) {
    if (m.currentCampaignId !== null) {
      beforeCounts.set(m.currentCampaignId, (beforeCounts.get(m.currentCampaignId) || 0) + 1);
    }
  }
  const campaignsEmptied = existingCampaigns.filter(c => {
    const before = beforeCounts.get(c.id) || 0;
    return before > 0 && !namesWithMailingsAfter.has(c.name);
  });

  console.log(`Campaigns to CREATE: ${campaignsToCreate.length}`);
  console.log(`Campaigns to DELETE (zero mailings after remap, excluding '${UNASSIGNED_NAME}'): ${campaignsToDelete.length}`);
  console.log(`Campaigns with link to BACKFILL: ${campaignsToBackfillLink.length}`);
  console.log(`Campaigns emptied by this remap (had mailings, now zero): ${campaignsEmptied.length}`);

  console.log('\n=== STEP 7: Quality checks ===');

  // duplicate name check post-remap (existing kept + new created, one row per name by construction)
  const allFinalNames = new Set(campaignPlans.keys());
  console.log(`Distinct campaign names post-remap: ${allFinalNames.size} (each maps to exactly 1 campaign row by construction)`);

  // The 3 requested names are shorthand/paraphrases, not exact sheet-tab names, so match fuzzily
  // (substring, case-insensitive, ignoring punctuation) against actual plan names for the eyeball check.
  const sampleQueries = ['Milam Texas June 2026', 'Lamar County GA Feb 2026', 'Zamplo Georgia Henry'];
  function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function fuzzyMatches(query: string, candidate: string): boolean {
    const qTokens = normalize(query).split(' ').filter(t => t.length > 2);
    const cNorm = normalize(candidate);
    return qTokens.every(t => cNorm.includes(t));
  }
  console.log('\nSample campaign matches (fuzzy, for eyeballing — exact names in the sheet differ from these shorthand queries):');
  const sampleMatches: Record<string, Array<{ name: string; targetMailingCount: number; existingId: number | null; link: string | null }>> = {};
  for (const query of sampleQueries) {
    const matches = [...campaignPlans.values()].filter(p => fuzzyMatches(query, p.name));
    sampleMatches[query] = matches.map(p => ({ name: p.name, targetMailingCount: p.targetMailingCount, existingId: p.existingId, link: p.link }));
    if (matches.length === 0) {
      console.log(`  "${query}": NO fuzzy match found among ${campaignPlans.size} campaign names`);
    } else {
      console.log(`  "${query}": ${matches.length} fuzzy match(es):`);
      for (const m of matches.slice(0, 10)) {
        console.log(`      - "${m.name}": ${m.targetMailingCount} mailings, existing id = ${m.existingId ?? '(new)'}, link = ${m.link || '(none)'}`);
      }
      if (matches.length > 10) console.log(`      ... and ${matches.length - 10} more`);
    }
  }

  const conservedOk = mailingTargets.length === 11433;
  console.log(`\nConservation check (11433 in == out): ${mailingTargets.length} -- ${conservedOk ? 'OK' : 'MISMATCH'}`);

  // ---- Write report ----
  const modeLabel = APPLY ? 'apply' : 'dry-run';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const perCampaignDeltas = [...campaignPlans.values()].map(plan => {
    const before = plan.existingId !== null ? (beforeCounts.get(plan.existingId) || 0) : 0;
    return {
      name: plan.name,
      existingId: plan.existingId,
      before,
      after: plan.targetMailingCount,
      delta: plan.targetMailingCount - before,
      link: plan.link,
      isNew: plan.existingId === null,
    };
  }).sort((a, b) => b.after - a.after);

  const jsonReport = {
    generatedAt: new Date().toISOString(),
    mode: modeLabel,
    totals: {
      mailingsProcessed: mailingTargets.length,
      resolvedToSheet,
      resolvedToUnassigned,
      mailingsWithNullPropertyId: noPropertyId.length,
      mailingsWithMissingApn: noApn.length,
      distinctApnsIndexedFromSheet: apnIndex.size,
      distinctSheetNames: sheetNamesSeen.size,
      apnCollisions: collisions.length,
      campaignsToCreate: campaignsToCreate.length,
      campaignsToDelete: campaignsToDelete.length,
      campaignsToBackfillLink: campaignsToBackfillLink.length,
      campaignsEmptied: campaignsEmptied.length,
      conservationCheckOk: conservedOk,
    },
    campaignsToCreate: campaignsToCreate.map(p => ({ name: p.name, link: p.link, targetMailingCount: p.targetMailingCount })),
    campaignsToDelete: campaignsToDelete.map(c => ({ id: c.id, name: c.name, link: c.link })),
    campaignsToBackfillLink,
    campaignsEmptied: campaignsEmptied.map(c => ({ id: c.id, name: c.name, before: beforeCounts.get(c.id) || 0 })),
    sampleMatches,
    perCampaignDeltas,
    apnCollisions: collisions.map(c => ({ apn: c.apn, hits: c.hits })),
    unassignedCandidates: mailingTargets
      .filter(m => m.targetCampaignName === UNASSIGNED_NAME)
      .map(m => ({ mailingId: m.mailingId, currentCampaignId: m.currentCampaignId })),
  };

  const jsonPath = path.join(reportsDir, `campaign-reassign-${modeLabel}-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  const mdLines: string[] = [];
  mdLines.push(`# Campaign Reassignment ${APPLY ? 'Apply' : 'Dry-Run'} Report`);
  mdLines.push(``);
  mdLines.push(`Generated: ${jsonReport.generatedAt}`);
  mdLines.push(``);
  mdLines.push(`## Summary`);
  mdLines.push(``);
  mdLines.push(`- Mailings processed: ${jsonReport.totals.mailingsProcessed} (expect 11433)`);
  mdLines.push(`- Resolved to a sheet-name campaign: ${jsonReport.totals.resolvedToSheet}`);
  mdLines.push(`- Resolved to '${UNASSIGNED_NAME}': ${jsonReport.totals.resolvedToUnassigned}`);
  mdLines.push(`- Mailings with null property_id: ${jsonReport.totals.mailingsWithNullPropertyId}`);
  mdLines.push(`- Mailings with property but missing/blank APN: ${jsonReport.totals.mailingsWithMissingApn}`);
  mdLines.push(`- Distinct APNs indexed from sheet: ${jsonReport.totals.distinctApnsIndexedFromSheet}`);
  mdLines.push(`- Distinct sheet names seen: ${jsonReport.totals.distinctSheetNames}`);
  mdLines.push(`- APN -> multiple distinct sheet/link collisions: ${jsonReport.totals.apnCollisions}`);
  mdLines.push(`- Campaigns to CREATE: ${jsonReport.totals.campaignsToCreate}`);
  mdLines.push(`- Campaigns to DELETE (become empty shells): ${jsonReport.totals.campaignsToDelete}`);
  mdLines.push(`- Campaigns to backfill link: ${jsonReport.totals.campaignsToBackfillLink}`);
  mdLines.push(`- Campaigns emptied by remap: ${jsonReport.totals.campaignsEmptied}`);
  mdLines.push(`- Conservation check OK: ${jsonReport.totals.conservationCheckOk}`);
  mdLines.push(``);
  mdLines.push(`## Sample campaigns (fuzzy match against requested names)`);
  mdLines.push(``);
  for (const query of sampleQueries) {
    const matches = sampleMatches[query];
    if (matches.length === 0) {
      mdLines.push(`- **${query}**: NO fuzzy match found`);
    } else {
      mdLines.push(`- **${query}**:`);
      for (const m of matches) {
        mdLines.push(`  - "${m.name}": ${m.targetMailingCount} mailings, existing id = ${m.existingId ?? '(new)'}, link = ${m.link || '(none)'}`);
      }
    }
  }
  mdLines.push(``);
  mdLines.push(`## Campaigns to create (${campaignsToCreate.length})`);
  mdLines.push(``);
  mdLines.push(`| name | mailings | link |`);
  mdLines.push(`|---|---|---|`);
  for (const c of campaignsToCreate.slice(0, 200)) {
    mdLines.push(`| ${c.name} | ${c.targetMailingCount} | ${c.link || ''} |`);
  }
  if (campaignsToCreate.length > 200) mdLines.push(`... and ${campaignsToCreate.length - 200} more (see JSON report)`);
  mdLines.push(``);
  mdLines.push(`## Campaigns to delete — empty shells (${campaignsToDelete.length})`);
  mdLines.push(``);
  mdLines.push(`| id | name |`);
  mdLines.push(`|---|---|`);
  for (const c of campaignsToDelete.slice(0, 200)) {
    mdLines.push(`| ${c.id} | ${c.name} |`);
  }
  if (campaignsToDelete.length > 200) mdLines.push(`... and ${campaignsToDelete.length - 200} more (see JSON report)`);
  mdLines.push(``);
  mdLines.push(`## Campaigns emptied by remap (${campaignsEmptied.length})`);
  mdLines.push(``);
  for (const c of campaignsEmptied) {
    mdLines.push(`- id ${c.id} "${c.name}": ${beforeCounts.get(c.id) || 0} -> 0`);
  }
  mdLines.push(``);
  mdLines.push(`## Campaigns to backfill link (${campaignsToBackfillLink.length})`);
  mdLines.push(``);
  for (const c of campaignsToBackfillLink) {
    mdLines.push(`- id ${c.id} "${c.name}": (empty) -> ${c.newLink}`);
  }
  mdLines.push(``);
  mdLines.push(`## APN collisions (${collisions.length})`);
  mdLines.push(``);
  mdLines.push(`APNs that map to more than one distinct (sheetName, sheetLink) pair in the sheet. Preferred hit chosen deterministically (non-empty name+link first, else first occurrence).`);
  mdLines.push(``);
  for (const c of collisions.slice(0, 100)) {
    mdLines.push(`- APN ${c.apn}: ${c.hits.map(h => `"${h.sheetName || '(blank)'}"`).join(', ')}`);
  }
  if (collisions.length > 100) mdLines.push(`... and ${collisions.length - 100} more (see JSON report)`);
  mdLines.push(``);
  mdLines.push(`## '${UNASSIGNED_NAME}' candidates (${jsonReport.unassignedCandidates.length})`);
  mdLines.push(``);
  mdLines.push(`These mailings' property APN was not found in the current 'Master' sheet (or had a blank sheet name). They will land in '${UNASSIGNED_NAME}' for manual remapping by a human — this script does NOT guess a sheet for them.`);
  mdLines.push(``);
  mdLines.push(`Full list of mailing IDs is in the JSON report (\`unassignedCandidates\`). Count: ${jsonReport.unassignedCandidates.length}.`);
  mdLines.push(``);
  mdLines.push(`## How to apply`);
  mdLines.push(``);
  mdLines.push('```');
  mdLines.push('npx tsx scripts/reassign-campaigns.ts --apply');
  mdLines.push('```');

  const mdPath = path.join(reportsDir, `campaign-reassign-${modeLabel}-${timestamp}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\nReports written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);

  if (!APPLY) {
    await pool.end();
    console.log('\n=== DRY RUN COMPLETE. No database writes were made. ===');
    return;
  }

  console.log('\n=== STEP 8: APPLY — writing changes in a single transaction ===');

  await db.transaction(async (tx) => {
    // (a) find-or-create campaigns for every planned name, in a stable order
    const nameToId = new Map<string, number>();
    for (const plan of campaignPlans.values()) {
      if (plan.existingId !== null) {
        nameToId.set(plan.name, plan.existingId);
        continue;
      }
      // idempotency guard: another process (or a prior partial run) may have created it already
      const existingRows = await tx.select().from(campaigns).where(eq(campaigns.name, plan.name));
      if (existingRows.length > 0) {
        nameToId.set(plan.name, existingRows[0].id);
        continue;
      }
      const inserted = await tx.insert(campaigns).values({
        name: plan.name,
        link: plan.link || null,
      }).returning();
      nameToId.set(plan.name, inserted[0].id);
    }

    // (b) backfill links for existing campaigns that had none
    for (const b of campaignsToBackfillLink) {
      await tx.update(campaigns)
        .set({ link: b.newLink })
        .where(eq(campaigns.id, b.id));
    }

    // (c) reassign every mailing to its target campaign id (idempotent: no-op if already correct)
    const idToMailingIds = new Map<number, number[]>();
    for (const mt of mailingTargets) {
      const targetId = nameToId.get(mt.targetCampaignName)!;
      if (mt.currentCampaignId === targetId) continue; // already correct
      if (!idToMailingIds.has(targetId)) idToMailingIds.set(targetId, []);
      idToMailingIds.get(targetId)!.push(mt.mailingId);
    }
    let updatedMailings = 0;
    for (const [targetId, mailingIds] of idToMailingIds.entries()) {
      if (mailingIds.length === 0) continue;
      await tx.update(mailings)
        .set({ campaignId: targetId })
        .where(inArray(mailings.id, mailingIds));
      updatedMailings += mailingIds.length;
    }
    console.log(`Mailings updated: ${updatedMailings} (of ${mailingTargets.length} total; rest already correct)`);

    // (d) delete campaigns that end with zero mailings, except the Unassigned bucket.
    // Guard: re-verify zero-mailing status inside the transaction right before deleting.
    let deletedCount = 0;
    for (const c of campaignsToDelete) {
      if (c.name === UNASSIGNED_NAME) continue; // never delete the unassigned bucket
      const stillHasMailings = await tx.select({ id: mailings.id }).from(mailings).where(eq(mailings.campaignId, c.id)).limit(1);
      if (stillHasMailings.length > 0) {
        console.warn(`  Skipping delete of campaign ${c.id} "${c.name}" — unexpectedly has mailings at delete time.`);
        continue;
      }
      await tx.delete(campaigns).where(eq(campaigns.id, c.id));
      deletedCount++;
    }
    console.log(`Campaigns deleted: ${deletedCount}`);
  });

  console.log('\n=== APPLY COMPLETE ===');

  // Post-apply verification stats
  const postMailingCount = await db.select({ count: sql<number>`count(*)::int` }).from(mailings);
  const postCampaignCount = await db.select({ count: sql<number>`count(*)::int` }).from(campaigns);
  console.log(`Post-apply mailings total: ${postMailingCount[0].count} (expect 11433)`);
  console.log(`Post-apply campaigns total: ${postCampaignCount[0].count}`);

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
