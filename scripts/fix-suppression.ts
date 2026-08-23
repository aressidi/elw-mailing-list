import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { execSync } from 'child_process';
import * as schema from './shared/schema';

const DATABASE_URL = 'postgresql://localhost:5432/elw_mailing_list';
const SHEET_ID = '1SrqwoqPlxmceae5y7DylTvUkVOXjyb58dsjDY3KQ7zA';

async function main() {
  console.log('='.repeat(60));
  console.log('FIXING: Using column AI (not AJ) for Do Not Mail');
  console.log('='.repeat(60));

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  // Get current count
  const currentResult = await db.select({ count: sql<number>`count(*)` }).from(schema.mailingSuppression);
  const oldCount = currentResult[0]?.count || 0;
  console.log(`\nCurrent suppression records: ${oldCount}`);

  // Clear the table
  await db.delete(schema.mailingSuppression);
  console.log('Cleared mailing_suppression table.');

  console.log('\n' + '='.repeat(60));
  console.log('Re-importing from column AI (Do Not Mail)');
  console.log('='.repeat(60));

  const BATCH_SIZE = 1000;
  let totalRows = 0;
  const suppressionRecords: Array<{
    row: number;
    apn: string | null;
    firstName: string | null;
    lastName: string | null;
  }> = [];

  for (let start = 2; start <= 11952; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, 11952);
    
    const cmd = `gog sheets get ${SHEET_ID} "Master!A${start}:AK${end}" --json 2>/dev/null`;
    
    try {
      const result = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      const data = JSON.parse(result);
      const rows = data.values || [];
      
      for (let i = 0; i < rows.length; i++) {
        totalRows++;
        const row = rows[i];
        // Column AI is index 34 (0-indexed)
        if (row.length > 34) {
          const doNotMail = (row[34] || '').toString().trim().toLowerCase();
          if (['yes', 'true', 'y', '1'].includes(doNotMail)) {
            suppressionRecords.push({
              row: start + i,
              apn: row[1] || null,
              firstName: row[7] || null,
              lastName: row[8] || null,
            });
          }
        }
      }
    } catch (e) {
      console.log(`Batch ${start}-${end} error: ${e}`);
    }
    
    if (start % 5000 === 0) {
      console.log(`Processed ${totalRows} rows...`);
    }
  }

  console.log(`\nFound ${suppressionRecords.length} Do Not Mail records in column AI`);

  console.log('\n' + '='.repeat(60));
  console.log('Matching to database records');
  console.log('='.repeat(60));

  let importedCount = 0;
  const notFound: typeof suppressionRecords = [];

  for (const record of suppressionRecords) {
    if (record.firstName && record.lastName) {
      // Find owner by name
      const owners = await db.query.owners.findMany({
        where: sql`LOWER(first_name) = LOWER(${record.firstName}) AND LOWER(last_name) = LOWER(${record.lastName})`,
        limit: 1,
      });

      if (owners.length > 0) {
        const owner = owners[0];
        
        // Find associated property
        const propertyOwners = await db.query.propertyOwners.findMany({
          where: eq(schema.propertyOwners.ownerId, owner.id),
          limit: 1,
        });

        if (propertyOwners.length > 0) {
          await db.insert(schema.mailingSuppression).values({
            ownerId: owner.id,
            propertyId: propertyOwners[0].propertyId,
            reason: 'do_not_mail',
          }).onConflictDoNothing();
          importedCount++;
        }
      } else {
        notFound.push(record);
      }
    }
  }

  console.log(`Successfully imported: ${importedCount} records`);
  console.log(`Could not match to database: ${notFound.length} records`);

  if (notFound.length > 0) {
    console.log('\nUnmatched records:');
    notFound.slice(0, 10).forEach(r => {
      console.log(`  Row ${r.row}: ${r.firstName} ${r.lastName} (APN: ${r.apn})`);
    });
  }

  // Get final count
  const finalResult = await db.select({ count: sql<number>`count(*)` }).from(schema.mailingSuppression);
  const finalCount = finalResult[0]?.count || 0;

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY:');
  console.log(`  Previous count: ${oldCount}`);
  console.log(`  New count: ${finalCount}`);
  console.log(`  Difference: ${finalCount - oldCount}`);
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
