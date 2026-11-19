// Command line entry: `npm run migrate` (compiled) or `npm run migrate:dev`.
import { join } from 'node:path';
import { loadConfig, loadDotEnv } from '../config.js';
import { migrate } from './migrations.js';
import { createPool } from './pool.js';

loadDotEnv();
const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set; nothing to migrate.');
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
const client = await pool.connect();
try {
  const applied = await migrate(client, join(process.cwd(), 'migrations'));
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  client.release();
  await pool.end();
}
