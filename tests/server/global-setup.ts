import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';

// Creates (if needed) and migrates the throwaway test database before any
// server test runs. Refuses to run against anything not named *_test.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/elw_mailing_list_test';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run server tests against non-test database "${dbName}"`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../migrations') });
  await pool.end();
}
