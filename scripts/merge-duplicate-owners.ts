// Owner dedupe/merge tool.
//
// Root cause (the "Robert Lee" collision found in a manual dig): the
// Rocketmail importer only matched existing owners with a plain
// `lower(owner_name) = exact` comparison, so variant spellings from the CSV
// ("Robert Lee, Jr.", "ROBERT LEE") or Sheet enrichment slipped past and
// inserted a parallel owner row for the same real person, splitting their
// mail/offer history across two owner ids. See owner-normalize.ts and the
// companion importer fix (import_rocketmail.py) for the forward-looking fix
// that stops new duplicates from being created; this tool cleans up the
// ones that already exist.
//
// Duplicate-candidate detection (documented per the task spec):
//   (a) normalized-name exact match (see owner-normalize.ts) -- high
//       confidence, always active.
//   (b) same parcel (distinct owner_ids linked to the same property_id via
//       property_owners) -- used ONLY as corroboration: two owners sharing a
//       parcel are unioned into a cluster only when their normalized names
//       also share a last token (last name) or one name is a prefix of the
//       other (>=4 chars). This deliberately avoids merging genuine
//       co-owners (e.g. spouses/partners/trustees with different names) who
//       happen to share a parcel -- that is common and NOT a duplicate.
//   (c) same mailing address pair -- OFF by default (weakest signal: PO
//       boxes, property managers, and multiple family members legitimately
//       share an address). Opt in with --use-address-signal.
//
// Canonical selection rule (documented per the task spec): within a cluster,
// score each owner by data completeness (first_name, last_name, and --
// where the columns exist on the live DB, since they're not yet part of
// shared/schema.ts -- phone, email, raw_data) and pick the highest score;
// ties broken by lowest id (earliest-created row wins).
//
// Dependent rows (property_owners, mailing_addresses, mailings, deals,
// mailing_suppression) are repointed from every non-canonical ("loser")
// owner to the canonical owner. Losers are never hard-deleted: they are
// soft-archived (owners.archived_at set, owners.merged_into_id set to the
// canonical id) so their raw_data/history stays queryable for audit and the
// merge is fully re-runnable (a second pass finds nothing left to merge).
//
// Usage:
//   npx tsx scripts/merge-duplicate-owners.ts                        # dry-run (read-only, default)
//   npx tsx scripts/merge-duplicate-owners.ts --dry-run              # same, explicit
//   npx tsx scripts/merge-duplicate-owners.ts --apply                # writes DB, all clusters
//   npx tsx scripts/merge-duplicate-owners.ts --apply --limit 3      # writes DB, first 3 clusters only
//   npx tsx scripts/merge-duplicate-owners.ts --apply --use-address-signal

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import { normalizeOwnerName } from './owner-normalize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const APPLY = process.argv.includes('--apply');
const USE_ADDRESS_SIGNAL = process.argv.includes('--use-address-signal');
const limitArgIdx = process.argv.indexOf('--limit');
const LIMIT = limitArgIdx !== -1 ? parseInt(process.argv[limitArgIdx + 1], 10) : null;

interface OwnerRow {
  id: number;
  ownerName: string;
  firstName: string | null;
  lastName: string | null;
  archivedAt: string | null;
}

interface Cluster {
  ownerIds: number[];
  reasons: Set<string>;
}

// ---- Union-find ----
class UnionFind {
  parent = new Map<number, number>();
  add(id: number) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: number): number {
    this.add(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function lastToken(normalizedName: string): string {
  const parts = normalizedName.split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function isPrefixMatch(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes DB!)' : 'DRY-RUN (read-only)'}${LIMIT !== null ? `, limit=${LIMIT} clusters` : ''}${USE_ADDRESS_SIGNAL ? ', address-signal=ON' : ''}`);

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log('\n=== STEP 0: Discover optional columns on the live DB ===');
  const colRows = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('owners', 'phone'), ('owners', 'email'), ('owners', 'raw_data'),
        ('owners', 'archived_at'), ('owners', 'merged_into_id')
      )
  `);
  const existingCols = new Set(colRows.rows.map(r => `${r.table_name}.${r.column_name}`));
  const hasPhone = existingCols.has('owners.phone');
  const hasEmail = existingCols.has('owners.email');
  const hasRawData = existingCols.has('owners.raw_data');
  const hasArchivedAt = existingCols.has('owners.archived_at');
  const hasMergedInto = existingCols.has('owners.merged_into_id');
  console.log(`  phone=${hasPhone} email=${hasEmail} raw_data=${hasRawData} archived_at=${hasArchivedAt} merged_into_id=${hasMergedInto}`);
  if (!hasArchivedAt || !hasMergedInto) {
    console.log('  NOTE: owners.archived_at / owners.merged_into_id not present yet.');
    console.log('  Run `npm run db:generate` + `npm run db:migrate` (or apply migrations/0001_*.sql)');
    console.log('  before using --apply. Dry-run reporting works regardless.');
  }

  console.log('\n=== STEP 1: Load owners ===');
  const ownerRows = await pool.query<{ id: number; owner_name: string; first_name: string | null; last_name: string | null; archived_at: string | null }>(
    hasArchivedAt
      ? `SELECT id, owner_name, first_name, last_name, archived_at FROM owners`
      : `SELECT id, owner_name, first_name, last_name, NULL::timestamptz AS archived_at FROM owners`
  );
  const owners: OwnerRow[] = ownerRows.rows.map(r => ({
    id: r.id, ownerName: r.owner_name, firstName: r.first_name, lastName: r.last_name, archivedAt: r.archived_at,
  }));
  const activeOwners = owners.filter(o => !o.archivedAt);
  console.log(`Loaded ${owners.length} owner(s) total (${activeOwners.length} active, ${owners.length - activeOwners.length} already archived).`);

  const normalizedById = new Map<number, string>();
  for (const o of activeOwners) normalizedById.set(o.id, normalizeOwnerName(o.ownerName));

  console.log('\n=== STEP 2: Build candidate clusters ===');
  const uf = new UnionFind();
  const reasonsByPair: Array<{ a: number; b: number; reason: string }> = [];

  // (a) normalized-name exact match
  const byNormalizedName = new Map<string, number[]>();
  for (const o of activeOwners) {
    const norm = normalizedById.get(o.id)!;
    if (!norm) continue;
    if (!byNormalizedName.has(norm)) byNormalizedName.set(norm, []);
    byNormalizedName.get(norm)!.push(o.id);
  }
  for (const [, ids] of byNormalizedName) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[0], ids[i]);
      reasonsByPair.push({ a: ids[0], b: ids[i], reason: 'normalized-name' });
    }
  }

  // (b) same parcel, corroborated by name similarity
  const parcelRows = await pool.query<{ property_id: number; owner_id: number }>(`
    SELECT property_id, owner_id FROM property_owners
  `);
  const ownerIdsByProperty = new Map<number, number[]>();
  for (const r of parcelRows.rows) {
    if (!ownerIdsByProperty.has(r.property_id)) ownerIdsByProperty.set(r.property_id, []);
    ownerIdsByProperty.get(r.property_id)!.push(r.owner_id);
  }
  for (const [, ownerIds] of ownerIdsByProperty) {
    const distinct = [...new Set(ownerIds)].filter(id => normalizedById.has(id));
    if (distinct.length < 2) continue;
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const a = distinct[i], b = distinct[j];
        const na = normalizedById.get(a)!, nb = normalizedById.get(b)!;
        if (!na || !nb) continue;
        const sameLast = lastToken(na) && lastToken(na) === lastToken(nb);
        const prefix = isPrefixMatch(na, nb);
        if (sameLast || prefix) {
          uf.union(a, b);
          reasonsByPair.push({ a, b, reason: 'same-parcel+name-similarity' });
        }
      }
    }
  }

  // (c) same mailing address pair -- opt-in only
  if (USE_ADDRESS_SIGNAL) {
    const addrRows = await pool.query<{ owner_id: number; key: string }>(`
      SELECT owner_id,
             lower(coalesce(address_line1,'')) || '|' || lower(coalesce(city,'')) || '|' ||
             lower(coalesce(state,'')) || '|' || lower(coalesce(zip,'')) AS key
      FROM mailing_addresses
      WHERE address_line1 IS NOT NULL AND address_line1 != ''
    `);
    const ownerIdsByAddr = new Map<string, Set<number>>();
    for (const r of addrRows.rows) {
      if (!ownerIdsByAddr.has(r.key)) ownerIdsByAddr.set(r.key, new Set());
      ownerIdsByAddr.get(r.key)!.add(r.owner_id);
    }
    for (const [, idSet] of ownerIdsByAddr) {
      const ids = [...idSet].filter(id => normalizedById.has(id));
      if (ids.length < 2) continue;
      for (let i = 1; i < ids.length; i++) {
        uf.union(ids[0], ids[i]);
        reasonsByPair.push({ a: ids[0], b: ids[i], reason: 'same-mailing-address' });
      }
    }
  }

  // Materialize clusters
  const clusterMap = new Map<number, Cluster>();
  for (const o of activeOwners) {
    const root = uf.find(o.id);
    if (!clusterMap.has(root)) clusterMap.set(root, { ownerIds: [], reasons: new Set() });
    clusterMap.get(root)!.ownerIds.push(o.id);
  }
  for (const { a, b, reason } of reasonsByPair) {
    const root = uf.find(a);
    clusterMap.get(root)?.reasons.add(reason);
    void b;
  }
  const clusters = [...clusterMap.values()].filter(c => c.ownerIds.length > 1);
  clusters.sort((a, b) => b.ownerIds.length - a.ownerIds.length);

  console.log(`Found ${clusters.length} duplicate-owner cluster(s) covering ${clusters.reduce((s, c) => s + c.ownerIds.length, 0)} owner rows.`);
  for (const c of clusters.slice(0, 20)) {
    const names = c.ownerIds.map(id => `${id}:"${owners.find(o => o.id === id)!.ownerName}"`).join(', ');
    console.log(`  [${[...c.reasons].join('+')}] ${names}`);
  }
  if (clusters.length > 20) console.log(`  ... and ${clusters.length - 20} more (see report file)`);

  // ---- Canonical selection ----
  async function completenessScore(id: number): Promise<number> {
    const o = owners.find(x => x.id === id)!;
    let score = 0;
    if (o.firstName) score += 1;
    if (o.lastName) score += 1;
    if (hasPhone || hasEmail || hasRawData) {
      const cols = ['id'];
      if (hasPhone) cols.push('phone');
      if (hasEmail) cols.push('email');
      if (hasRawData) cols.push('raw_data');
      const r = await pool.query(`SELECT ${cols.join(', ')} FROM owners WHERE id = $1`, [id]);
      const row = r.rows[0];
      if (hasPhone && row.phone) score += 1;
      if (hasEmail && row.email) score += 1;
      if (hasRawData && row.raw_data) score += 1;
    }
    return score;
  }

  const plan: Array<{ canonicalId: number; loserIds: number[]; reasons: string[] }> = [];
  for (const c of clusters) {
    const scored = await Promise.all(c.ownerIds.map(async id => ({ id, score: await completenessScore(id) })));
    scored.sort((x, y) => (y.score - x.score) || (x.id - y.id));
    const canonicalId = scored[0].id;
    const loserIds = c.ownerIds.filter(id => id !== canonicalId);
    plan.push({ canonicalId, loserIds, reasons: [...c.reasons] });
  }

  // ---- Report ----
  const modeLabel = APPLY ? 'apply' : 'dry-run';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `merge-duplicate-owners-${modeLabel}-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: modeLabel,
    limit: LIMIT,
    useAddressSignal: USE_ADDRESS_SIGNAL,
    totalOwnersBefore: owners.length,
    activeOwnersBefore: activeOwners.length,
    clustersFound: clusters.length,
    plan: plan.map(p => ({
      canonicalId: p.canonicalId,
      canonicalName: owners.find(o => o.id === p.canonicalId)!.ownerName,
      loserIds: p.loserIds,
      loserNames: p.loserIds.map(id => owners.find(o => o.id === id)!.ownerName),
      reasons: p.reasons,
    })),
  }, null, 2));
  console.log(`\nReport written: ${reportPath}`);

  if (!APPLY) {
    await pool.end();
    console.log('\n=== DRY RUN COMPLETE. No database writes were made. ===');
    return;
  }

  if (!hasArchivedAt || !hasMergedInto) {
    console.error('\nABORT: owners.archived_at / owners.merged_into_id missing on the live DB.');
    console.error('Run the drizzle migration (npm run db:migrate) before using --apply.');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  const toApply = LIMIT !== null ? plan.slice(0, LIMIT) : plan;
  console.log(`\n=== STEP 3: APPLY -- merging ${toApply.length} of ${plan.length} cluster(s) ===`);

  let propertyOwnersRepointed = 0, propertyOwnersDropped = 0;
  let mailingAddressesRepointed = 0, mailingsRepointed = 0, dealsRepointed = 0;
  let suppressionRepointed = 0, suppressionDropped = 0;
  let ownersArchived = 0;

  for (const { canonicalId, loserIds } of toApply) {
    await db.transaction(async (tx) => {
      for (const loserId of loserIds) {
        // property_owners: repoint, but drop the loser's link where the
        // canonical already owns the same parcel (would violate the PK).
        const dup = await tx.execute(sql`
          DELETE FROM property_owners po_loser
          USING property_owners po_canonical
          WHERE po_loser.owner_id = ${loserId}
            AND po_canonical.owner_id = ${canonicalId}
            AND po_canonical.property_id = po_loser.property_id
        `);
        propertyOwnersDropped += dup.rowCount ?? 0;

        const repointedPO = await tx.execute(sql`
          UPDATE property_owners SET owner_id = ${canonicalId} WHERE owner_id = ${loserId}
        `);
        propertyOwnersRepointed += repointedPO.rowCount ?? 0;

        const repointedAddr = await tx.execute(sql`
          UPDATE mailing_addresses SET owner_id = ${canonicalId} WHERE owner_id = ${loserId}
        `);
        mailingAddressesRepointed += repointedAddr.rowCount ?? 0;

        const repointedMailings = await tx.execute(sql`
          UPDATE mailings SET owner_id = ${canonicalId} WHERE owner_id = ${loserId}
        `);
        mailingsRepointed += repointedMailings.rowCount ?? 0;

        const repointedDeals = await tx.execute(sql`
          UPDATE deals SET owner_id = ${canonicalId} WHERE owner_id = ${loserId}
        `);
        dealsRepointed += repointedDeals.rowCount ?? 0;

        // mailing_suppression: unique on (owner_id, property_id); drop the
        // loser's row where the canonical already has an identical
        // suppression entry (including the NULL-property_id "all parcels"
        // case), else repoint.
        const dupSupp = await tx.execute(sql`
          DELETE FROM mailing_suppression ms_loser
          USING mailing_suppression ms_canonical
          WHERE ms_loser.owner_id = ${loserId}
            AND ms_canonical.owner_id = ${canonicalId}
            AND ms_canonical.property_id IS NOT DISTINCT FROM ms_loser.property_id
        `);
        suppressionDropped += dupSupp.rowCount ?? 0;

        const repointedSupp = await tx.execute(sql`
          UPDATE mailing_suppression SET owner_id = ${canonicalId} WHERE owner_id = ${loserId}
        `);
        suppressionRepointed += repointedSupp.rowCount ?? 0;

        // Gap-fill canonical's phone/email if empty (CSV/email is source of
        // truth elsewhere; this is a same-person merge, not enrichment, so
        // backfilling from the loser is safe -- but never clobber a
        // non-empty canonical value).
        if (hasPhone) {
          await tx.execute(sql`
            UPDATE owners SET phone = loser.phone
            FROM owners loser
            WHERE owners.id = ${canonicalId} AND loser.id = ${loserId}
              AND (owners.phone IS NULL OR owners.phone = '')
              AND loser.phone IS NOT NULL AND loser.phone != ''
          `);
        }
        if (hasEmail) {
          await tx.execute(sql`
            UPDATE owners SET email = loser.email
            FROM owners loser
            WHERE owners.id = ${canonicalId} AND loser.id = ${loserId}
              AND (owners.email IS NULL OR owners.email = '')
              AND loser.email IS NOT NULL AND loser.email != ''
          `);
        }
        // raw_data is intentionally NOT clobbered or merged in-place: the
        // loser row is soft-archived (not deleted) below, so its raw_data
        // stays queryable for audit via merged_into_id.

        await tx.execute(sql`
          UPDATE owners SET archived_at = now(), merged_into_id = ${canonicalId} WHERE id = ${loserId}
        `);
        ownersArchived += 1;
      }
    });
  }

  console.log('\n=== APPLY COMPLETE ===');
  console.log(`  property_owners repointed: ${propertyOwnersRepointed} (dropped as redundant: ${propertyOwnersDropped})`);
  console.log(`  mailing_addresses repointed: ${mailingAddressesRepointed}`);
  console.log(`  mailings repointed: ${mailingsRepointed}`);
  console.log(`  deals repointed: ${dealsRepointed}`);
  console.log(`  mailing_suppression repointed: ${suppressionRepointed} (dropped as redundant: ${suppressionDropped})`);
  console.log(`  owners archived (merge losers): ${ownersArchived}`);

  console.log('\n=== STEP 4: Post-apply verification ===');
  const postActive = await pool.query(`SELECT count(*)::int AS n FROM owners WHERE archived_at IS NULL`);
  const postArchived = await pool.query(`SELECT count(*)::int AS n FROM owners WHERE archived_at IS NOT NULL`);
  const orphanCheck = await pool.query(`
    SELECT count(*)::int AS n FROM property_owners po JOIN owners o ON o.id = po.owner_id WHERE o.archived_at IS NOT NULL
  `);
  console.log(`  Active owners: ${postActive.rows[0].n} (was ${activeOwners.length})`);
  console.log(`  Archived owners: ${postArchived.rows[0].n}`);
  console.log(`  property_owners rows still pointing at an archived owner: ${orphanCheck.rows[0].n} (expect 0)`);
  if (orphanCheck.rows[0].n !== 0) {
    console.error('VERIFICATION FAILED: dependent rows still point at an archived owner!');
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
