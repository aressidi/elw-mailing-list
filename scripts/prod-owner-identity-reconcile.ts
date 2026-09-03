// Additive reconcile for the owner-identity fix (see scripts/owner-identity.ts):
// splits owners that were wrongly merged by the old name-only dedup logic
// into one owner row per distinct (name + zip + full mailing address), and
// re-points property_owners / mailings / deals / mailing_suppression to the
// correct split owner. Never deletes an owner row or a mailing history row --
// purely additive (new owner rows) plus foreign-key repoints.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/prod-owner-identity-reconcile.ts            (dry-run, default)
//   DATABASE_URL=... npx tsx scripts/prod-owner-identity-reconcile.ts --apply    (commits)
//
// Algorithm, per owner with 2+ distinct mailing addresses:
//   1. Group the owner's mailing_addresses rows by normalized full address.
//   2. Rank groups by (# distinct properties reached via mailings, desc),
//      then (most recent mail_date, desc). The top-ranked group is the
//      "primary" group and keeps the original owner_id -- nothing moves for
//      it.
//   3. Every other group gets a brand-new owner row (same name/type), and:
//        - its mailing_addresses rows move to the new owner_id
//        - its mailings rows move to the new owner_id
//        - property_owners moves too, UNLESS the property is "ambiguous"
//          (mailed to 2+ real distinct addresses under this owner -- e.g. the
//          owner's address changed between campaigns). Ambiguous properties
//          keep their property_owners link on the primary owner and are
//          printed for manual review; their non-primary mailings still get
//          reattributed to the new owner (correct historical record), but the
//          single property_owners relationship isn't touched automatically.
//        - deals / mailing_suppression move only for non-ambiguous,
//          fully-moved properties (property_id + owner_id keyed, no address
//          link of their own).
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { normalizeAddressPart } from './owner-identity';

const envFileArgIdx = process.argv.indexOf('--env-file');
const envFile = envFileArgIdx !== -1 ? process.argv[envFileArgIdx + 1] : undefined;
dotenv.config(envFile ? { path: envFile, override: true } : undefined);

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY = process.argv.includes('--apply');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required -- set it in .env, or pass --env-file <path> (e.g. --env-file .env.production).');
  process.exit(1);
}

interface AddrRow {
  id: number;
  owner_id: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}
interface MailingRow {
  id: number;
  owner_id: number;
  property_id: number;
  mailing_address_id: number | null;
  mail_date: Date | null;
}
interface OwnerRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  owner_name: string;
  owner_type: string | null;
}

function addressGroupKey(a: { address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; zip: string | null }): string {
  return [
    normalizeAddressPart(a.address_line1),
    normalizeAddressPart(a.address_line2),
    normalizeAddressPart(a.city),
    normalizeAddressPart(a.state),
    normalizeAddressPart(a.zip),
  ].join('|');
}

async function main() {
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL!).hostname);
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    console.log(`Mode: ${APPLY ? 'APPLY (writes will commit)' : 'DRY RUN (no writes)'}`);

    const overMergedResult = await client.query<{ owner_id: number }>(`
      select owner_id
      from (select distinct owner_id, coalesce(address_line1,''), coalesce(address_line2,''), coalesce(city,''), coalesce(state,''), coalesce(zip,'') from mailing_addresses) t
      group by owner_id having count(*) > 1
    `);
    const overMergedOwnerIds = overMergedResult.rows.map((r) => r.owner_id);
    console.log(`Found ${overMergedOwnerIds.length} owners with 2+ distinct mailing addresses.`);
    if (overMergedOwnerIds.length === 0) {
      console.log('Nothing to reconcile.');
      return;
    }

    const owners = new Map<number, OwnerRow>();
    const ownersResult = await client.query<OwnerRow>(
      `select id, first_name, last_name, owner_name, owner_type from owners where id = ANY($1::int[])`,
      [overMergedOwnerIds]
    );
    for (const o of ownersResult.rows) owners.set(o.id, o);

    const addrResult = await client.query<AddrRow>(
      `select id, owner_id, address_line1, address_line2, city, state, zip from mailing_addresses where owner_id = ANY($1::int[])`,
      [overMergedOwnerIds]
    );
    const mailingResult = await client.query<MailingRow>(
      `select id, owner_id, property_id, mailing_address_id, mail_date from mailings where owner_id = ANY($1::int[])`,
      [overMergedOwnerIds]
    );

    // owner_id -> groupKey -> address ids
    const groupsByOwner = new Map<number, Map<string, number[]>>();
    const addrIdToGroupKey = new Map<number, string>();
    for (const a of addrResult.rows) {
      const key = addressGroupKey(a);
      addrIdToGroupKey.set(a.id, key);
      if (!groupsByOwner.has(a.owner_id)) groupsByOwner.set(a.owner_id, new Map());
      const m = groupsByOwner.get(a.owner_id)!;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a.id);
    }

    // owner_id -> groupKey -> { properties: Set<number>, latestMailDate: Date|null }
    const groupStatsByOwner = new Map<number, Map<string, { properties: Set<number>; latestMailDate: Date | null }>>();
    // owner_id -> property_id -> Set<groupKey> (to detect ambiguous properties)
    const propGroupsByOwner = new Map<number, Map<number, Set<string>>>();
    for (const m of mailingResult.rows) {
      if (!m.mailing_address_id) continue;
      const key = addrIdToGroupKey.get(m.mailing_address_id);
      if (!key) continue;

      if (!groupStatsByOwner.has(m.owner_id)) groupStatsByOwner.set(m.owner_id, new Map());
      const gs = groupStatsByOwner.get(m.owner_id)!;
      if (!gs.has(key)) gs.set(key, { properties: new Set(), latestMailDate: null });
      const stat = gs.get(key)!;
      stat.properties.add(m.property_id);
      if (m.mail_date && (!stat.latestMailDate || m.mail_date > stat.latestMailDate)) stat.latestMailDate = m.mail_date;

      if (!propGroupsByOwner.has(m.owner_id)) propGroupsByOwner.set(m.owner_id, new Map());
      const pm = propGroupsByOwner.get(m.owner_id)!;
      if (!pm.has(m.property_id)) pm.set(m.property_id, new Set());
      pm.get(m.property_id)!.add(key);
    }

    let ownersToCreate = 0;
    let propertyOwnersToMove = 0;
    let mailingsToMove = 0;
    let mailingAddressesToMove = 0;
    let dealsToMove = 0;
    let suppressionToMove = 0;
    const ambiguousProperties: { ownerId: number; propertyId: number; groups: string[] }[] = [];

    if (APPLY) await client.query('BEGIN');

    for (const [ownerId, groups] of groupsByOwner) {
      if (groups.size < 2) continue; // shouldn't happen given the pre-filter, but guard anyway
      const owner = owners.get(ownerId)!;
      const stats = groupStatsByOwner.get(ownerId) ?? new Map();

      const ranked = [...groups.keys()].sort((a, b) => {
        const sa = stats.get(a);
        const sb = stats.get(b);
        const na = sa?.properties.size ?? 0;
        const nb = sb?.properties.size ?? 0;
        if (nb !== na) return nb - na;
        const da = sa?.latestMailDate?.getTime() ?? 0;
        const db = sb?.latestMailDate?.getTime() ?? 0;
        return db - da;
      });
      const primaryKey = ranked[0];
      const nonPrimaryKeys = ranked.slice(1);

      const propGroups = propGroupsByOwner.get(ownerId) ?? new Map();

      for (const groupKey of nonPrimaryKeys) {
        const addrIds = groups.get(groupKey)!;
        ownersToCreate++;
        mailingAddressesToMove += addrIds.length;

        let newOwnerId: number | null = null;
        if (APPLY) {
          const insertResult = await client.query<{ id: number }>(
            `insert into owners (first_name, last_name, owner_name, owner_type) values ($1, $2, $3, $4) returning id`,
            [owner.first_name, owner.last_name, owner.owner_name, owner.owner_type]
          );
          newOwnerId = insertResult.rows[0].id;
          await client.query(`update mailing_addresses set owner_id = $1 where id = ANY($2::int[])`, [newOwnerId, addrIds]);
        }

        // Mailings whose address falls in this group all move (correct
        // historical attribution), regardless of the property's ambiguity.
        const groupMailingIds = mailingResult.rows
          .filter((m) => m.owner_id === ownerId && m.mailing_address_id && addrIdToGroupKey.get(m.mailing_address_id) === groupKey)
          .map((m) => m.id);
        mailingsToMove += groupMailingIds.length;
        if (APPLY && groupMailingIds.length > 0) {
          await client.query(`update mailings set owner_id = $1 where id = ANY($2::int[])`, [newOwnerId, groupMailingIds]);
        }

        // Properties reached via this group, excluding ambiguous ones
        // (mailed to 2+ real distinct addresses under this owner).
        const groupProperties = stats.get(groupKey)?.properties ?? new Set<number>();
        const movableProperties: number[] = [];
        for (const propertyId of groupProperties) {
          const propGroupSet = propGroups.get(propertyId);
          if (propGroupSet && propGroupSet.size > 1) {
            ambiguousProperties.push({ ownerId, propertyId, groups: [...propGroupSet] });
            continue;
          }
          movableProperties.push(propertyId);
        }

        propertyOwnersToMove += movableProperties.length;
        if (APPLY && movableProperties.length > 0) {
          await client.query(`delete from property_owners where owner_id = $1 and property_id = ANY($2::int[])`, [ownerId, movableProperties]);
          await client.query(
            `insert into property_owners (property_id, owner_id) select unnest($1::int[]), $2 on conflict do nothing`,
            [movableProperties, newOwnerId]
          );

          const dealsResult = await client.query<{ id: number }>(
            `update deals set owner_id = $1 where owner_id = $2 and property_id = ANY($3::int[]) returning id`,
            [newOwnerId, ownerId, movableProperties]
          );
          dealsToMove += dealsResult.rowCount ?? 0;

          const suppResult = await client.query<{ id: number }>(
            `update mailing_suppression set owner_id = $1 where owner_id = $2 and property_id = ANY($3::int[]) returning id`,
            [newOwnerId, ownerId, movableProperties]
          );
          suppressionToMove += suppResult.rowCount ?? 0;
        } else if (!APPLY) {
          // Dry-run counts for deals/suppression (read-only, no mutation).
          const dealsResult = await client.query<{ n: string }>(
            `select count(*)::text as n from deals where owner_id = $1 and property_id = ANY($2::int[])`,
            [ownerId, movableProperties]
          );
          dealsToMove += Number(dealsResult.rows[0]?.n ?? 0);
          const suppResult = await client.query<{ n: string }>(
            `select count(*)::text as n from mailing_suppression where owner_id = $1 and property_id = ANY($2::int[])`,
            [ownerId, movableProperties]
          );
          suppressionToMove += Number(suppResult.rows[0]?.n ?? 0);
        }
      }
      void primaryKey; // primary group intentionally left untouched
    }

    console.log('\n=== RECONCILE PLAN ===');
    console.log(`Owners over-merged (splitting): ${groupsByOwner.size}`);
    console.log(`New owner rows to create: ${ownersToCreate}`);
    console.log(`mailing_addresses rows to repoint: ${mailingAddressesToMove}`);
    console.log(`mailings rows to repoint: ${mailingsToMove}`);
    console.log(`property_owners rows to move: ${propertyOwnersToMove}`);
    console.log(`deals rows to repoint: ${dealsToMove}`);
    console.log(`mailing_suppression rows to repoint: ${suppressionToMove}`);
    console.log(`Ambiguous properties (left on original/primary owner, flagged for manual review): ${ambiguousProperties.length}`);
    if (ambiguousProperties.length > 0) {
      console.log(JSON.stringify(ambiguousProperties, null, 2));
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      console.log('\nDry run only -- no writes made. Re-run with --apply to commit.');
    }
  } catch (e) {
    if (APPLY) {
      await client.query('ROLLBACK');
      console.error('Rolled back due to error.');
    }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
