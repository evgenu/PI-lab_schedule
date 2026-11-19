// `npm run seed`: demo labs + the first admin from ADMIN_EMAIL / ADMIN_PASSWORD.
import { loadConfig, loadDotEnv } from './config.js';
import { createPool } from './db/pool.js';
import { createPostgresRepos } from './repos/postgres.js';
import { seed } from './seedData.js';

loadDotEnv();
const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
try {
  const done = await seed(createPostgresRepos(pool), {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
  });
  console.log(done.length ? `Seeded: ${done.join(', ')}` : 'Nothing to seed.');
} finally {
  await pool.end();
}
