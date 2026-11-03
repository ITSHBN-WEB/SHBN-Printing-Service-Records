// Creates tables and loads suppliers / services into your Neon database.
// Usage:  DATABASE_URL="postgresql://..." npm run db:setup
// (Or paste db/schema.sql then db/seed.sql into the Neon SQL Editor instead.)
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
for (const f of ['schema.sql', 'seed.sql']) {
  await pool.query(readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8'));
  console.log('ran', f);
}
const { rows } = await pool.query('select (select count(*) from suppliers) s, (select count(*) from services) v');
console.log(`suppliers: ${rows[0].s}, services: ${rows[0].v}`);
await pool.end();
