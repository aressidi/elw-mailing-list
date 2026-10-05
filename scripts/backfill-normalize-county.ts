// One-off backfill: rewrite properties.county to its canonical form
// (canonicalCounty in shared/property-location.ts - Title Case, trailing
// "County" removed), so "Benton" / "Benton County" / "BENTON COUNTY" stop
// counting as different counties in reports. The importers and the bulk API
// endpoints already write the canonical form; this fixes the rows stored
// before that.
//
// Data only (UPDATE properties SET county = ...); no schema change.
//
// LOCAL DATABASE BY DEFAULT: refuses any non-localhost DATABASE_URL unless
// --allow-remote is passed explicitly.
//
// Usage:
//   npx tsx scripts/backfill-normalize-county.ts --dry-run   # report only, writes nothing
//   npx tsx scripts/backfill-normalize-county.ts             # apply, in one transaction
//     --allow-remote  allow a non-local (e.g. production) DATABASE_URL
//
// The unique index properties_apn_location_idx keys on normalizeCounty(county),
// which already ignores case and the "County" suffix, so a rewrite normally
// leaves every row's index key as it was. A value whose key WOULD change
// (e.g. trailing whitespace, "X County County") is listed and left alone: it
// could collide with another property and needs a human decision.

import { Pool } from 'pg';
import { canonicalCounty, normalizeCounty } from '../shared/property-location';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_REMOTE = process.argv.includes('--allow-remote');

interface Change { before: string; after: string | null; rows: number }

function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(host)) return;
  if (!ALLOW_REMOTE) {
    throw new Error(`Refusing to run: DATABASE_URL host "${host}" is not local. This backfill is local-only unless --allow-remote is passed.`);
  }
  const banner = '!'.repeat(78);
  console.warn(banner);
  console.warn(`WARNING: --allow-remote set. Connecting to NON-LOCAL database host "${host}". This writes to a remote/production database.`);
  console.warn(banner);
}

const show = (value: string | null) => (value === null ? 'NULL' : JSON.stringify(value));

async function main() {
  assertLocalDatabase(DATABASE_URL);
  console.log(`Connecting to database (${new URL(DATABASE_URL).hostname}${new URL(DATABASE_URL).pathname})${DRY_RUN ? ' [DRY RUN]' : ''}...`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Locked so the report and the update see the same rows.
    await client.query('LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE');

    const totals = async () => (await client.query<{ total: number; with_county: number; distinct_county: number }>(
      'SELECT count(*)::int AS total, count(county)::int AS with_county, count(DISTINCT county)::int AS distinct_county FROM properties',
    )).rows[0];
    const before = await totals();

    const { rows: values } = await client.query<{ county: string; rows: number }>(
      'SELECT county, count(*)::int AS rows FROM properties WHERE county IS NOT NULL GROUP BY county ORDER BY county',
    );

    const changes: Change[] = [];
    const keyChanges: Change[] = [];
    const rowsByCanonical = new Map<string, { rows: number; from: string[] }>();
    for (const { county, rows } of values) {
      const after = canonicalCounty(county);
      const keySafe = normalizeCounty(after) === normalizeCounty(county);
      const stored = keySafe ? after : county;
      if (!keySafe) keyChanges.push({ before: county, after, rows });
      else if (after !== county) changes.push({ before: county, after, rows });
      if (stored !== null) {
        const group = rowsByCanonical.get(stored) ?? { rows: 0, from: [] };
        group.rows += rows;
        group.from.push(county);
        rowsByCanonical.set(stored, group);
      }
    }

    const width = Math.max(6, ...changes.map((c) => show(c.before).length));
    console.log(`\n== COUNTY VALUES TO REWRITE (${changes.length} of ${values.length} distinct values) ==`);
    console.log(`${'before'.padEnd(width)}  ->  ${'after'.padEnd(width)}  rows`);
    for (const c of changes) console.log(`${show(c.before).padEnd(width)}  ->  ${show(c.after).padEnd(width)}  ${String(c.rows).padStart(5)}`);

    const merged = [...rowsByCanonical.entries()].filter(([, g]) => g.from.length > 1).sort((a, b) => b[1].rows - a[1].rows);
    console.log(`\n== VALUES THAT MERGE (${merged.length} counties) ==`);
    for (const [name, g] of merged) console.log(`${String(g.rows).padStart(6)}  ${name}  <=  ${g.from.map(show).join(' + ')}`);

    if (keyChanges.length > 0) {
      console.log(`\n== SKIPPED - rewrite would change the apn+state+county unique-index key (${keyChanges.length} values) ==`);
      for (const c of keyChanges) console.log(`${show(c.before)}  ->  ${show(c.after)}  ${c.rows} rows  (key ${normalizeCounty(c.before)} -> ${normalizeCounty(c.after)})`);
    }

    const rowsToChange = changes.reduce((n, c) => n + c.rows, 0);
    const toNull = changes.filter((c) => c.after === null);
    console.log('\n== SUMMARY ==');
    console.log(`properties:               ${before.total}`);
    console.log(`  with a county:          ${before.with_county}`);
    console.log(`distinct county values:   ${before.distinct_county} -> ${rowsByCanonical.size}`);
    console.log(`rows to change:           ${rowsToChange}`);
    console.log(`blank counties -> NULL:   ${toNull.reduce((n, c) => n + c.rows, 0)} rows`);
    console.log(`skipped (index key):      ${keyChanges.reduce((n, c) => n + c.rows, 0)} rows`);

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN - nothing written. Re-run without --dry-run to apply.');
      return;
    }

    let updated = 0;
    for (const c of changes) {
      const result = await client.query('UPDATE properties SET county = $2 WHERE county = $1', [c.before, c.after]);
      if (result.rowCount !== c.rows) throw new Error(`${show(c.before)}: expected ${c.rows} rows, updated ${result.rowCount}`);
      updated += c.rows;
    }

    const after = await totals();
    const expectedWithCounty = before.with_county - toNull.reduce((n, c) => n + c.rows, 0);
    if (after.total !== before.total) throw new Error(`property count changed: ${before.total} -> ${after.total}`);
    if (after.with_county !== expectedWithCounty) throw new Error(`properties with a county: expected ${expectedWithCounty}, found ${after.with_county}`);
    if (after.distinct_county !== rowsByCanonical.size) throw new Error(`distinct counties: expected ${rowsByCanonical.size}, found ${after.distinct_county}`);

    await client.query('COMMIT');
    console.log(`\nAPPLIED - ${updated} rows updated.`);
    console.log(`properties ${after.total} (unchanged), with a county ${after.with_county}, distinct county values ${after.distinct_county}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
