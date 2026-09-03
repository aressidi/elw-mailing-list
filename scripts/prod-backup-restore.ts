// Self-contained JSON backup/restore for the tables touched by
// prod-owner-identity-reconcile.ts. pg_dump can't be used here (local
// pg_dump is v15, Neon prod is Postgres 18, and pg_dump refuses to talk to a
// newer server) -- this dumps full table contents as JSON via the same `pg`
// driver the app already uses, and can restore by truncating and
// re-inserting exactly those rows (safe because the reconcile only touches
// these 6 tables and is otherwise additive/repoint-only, so a restore here
// fully undoes it).
//
// Usage:
//   npx tsx scripts/prod-backup-restore.ts backup --env-file .env.production --out backups/foo.json
//   npx tsx scripts/prod-backup-restore.ts restore --env-file .env.production --in backups/foo.json --apply
import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

// Insert order matters: each table must come after every table it has a
// foreign key into (mailings references mailing_addresses, property_owners
// and mailings both reference owners, etc). Delete order is this reversed.
const TABLES = ['owners', 'mailing_addresses', 'property_owners', 'mailings', 'deals', 'mailing_suppression'] as const;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  const envFile = argValue('--env-file');
  dotenv.config(envFile ? { path: envFile, override: true } : undefined);
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required -- set it in .env, or pass --env-file <path>.');
    process.exit(1);
  }
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL).hostname);
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    if (mode === 'backup') {
      const outPath = argValue('--out');
      if (!outPath) { console.error('--out <path> is required for backup'); process.exit(1); }
      const snapshot: Record<string, any[]> = {};
      for (const table of TABLES) {
        const result = await client.query(`select * from ${table}`);
        snapshot[table] = result.rows;
        console.log(`Backed up ${table}: ${result.rows.length} rows`);
      }
      fs.writeFileSync(outPath, JSON.stringify({ takenAt: new Date().toISOString(), databaseHost: new URL(DATABASE_URL).hostname, tables: snapshot }, null, 2));
      console.log(`Wrote ${outPath}`);
    } else if (mode === 'restore') {
      const inPath = argValue('--in');
      const apply = process.argv.includes('--apply');
      if (!inPath) { console.error('--in <path> is required for restore'); process.exit(1); }
      const data = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
      console.log(`Restoring snapshot taken at ${data.takenAt} from host ${data.databaseHost}`);
      console.log(`Mode: ${apply ? 'APPLY (writes will commit)' : 'DRY RUN (no writes)'}`);

      if (apply) await client.query('BEGIN');
      try {
        // Delete children before parents, restore parents before children.
        const deleteOrder = [...TABLES].reverse();
        const insertOrder = TABLES;

        for (const table of deleteOrder) {
          const countResult = await client.query(`select count(*)::int as n from ${table}`);
          console.log(`${table}: currently ${countResult.rows[0].n} rows, will restore to ${data.tables[table].length} rows`);
          if (apply) await client.query(`delete from ${table}`);
        }
        for (const table of insertOrder) {
          const rows: any[] = data.tables[table];
          if (rows.length === 0) continue;
          const columns = Object.keys(rows[0]);
          if (apply) {
            for (const row of rows) {
              const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
              const values = columns.map((c) => row[c]);
              await client.query(`insert into ${table} (${columns.join(', ')}) values (${placeholders})`, values);
            }
          }
          console.log(`${table}: ${apply ? 'restored' : 'would restore'} ${rows.length} rows`);
        }
        // Reset serial sequences to max(id)+1 so future inserts don't collide.
        // property_owners has no serial id column (composite PK) -- skip it.
        if (apply) {
          for (const table of TABLES) {
            if (table === 'property_owners') continue;
            await client.query(`select setval(pg_get_serial_sequence('${table}', 'id'), coalesce((select max(id) from ${table}), 1), (select max(id) is not null from ${table}))`);
          }
        }
        if (apply) {
          const commitResult = await client.query('COMMIT');
          if (commitResult.command !== 'COMMIT') {
            throw new Error(`Expected COMMIT, server returned ${commitResult.command} -- transaction was aborted server-side.`);
          }
          console.log('Committed.');
        } else {
          console.log('Dry run only -- no writes made. Re-run with --apply to commit.');
        }
      } catch (e) {
        if (apply) await client.query('ROLLBACK');
        throw e;
      }
    } else {
      console.error('Usage: prod-backup-restore.ts <backup|restore> --env-file <path> [--out <path> | --in <path> --apply]');
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
