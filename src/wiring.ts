import type { Config } from './config.js';
import { createPool } from './db/pool.js';
import { GeminiClient } from './model/client.js';
import { createMemoryRepos } from './repos/memory.js';
import { createPostgresRepos } from './repos/postgres.js';
import type { Repos } from './repos/types.js';
import { createServices, type Services } from './services/index.js';
import { seed } from './seedData.js';

/**
 * Builds the service layer from configuration. Used by both entry points
 * (the web server and the MCP server), so they share exactly the same rules.
 */
export async function buildServices(config: Config): Promise<{ services: Services; close: () => Promise<void> }> {
  let repos: Repos;
  let close = async () => {};
  if (config.databaseUrl) {
    const pool = createPool(config.databaseUrl);
    repos = createPostgresRepos(pool);
    close = () => pool.end();
  } else {
    console.warn('DATABASE_URL is not set: using an in-memory store with demo data. Data is lost on restart.');
    repos = createMemoryRepos();
    // No password lives in the code: the local admin comes from the environment, if set.
    await seed(repos, { email: process.env.ADMIN_EMAIL ?? '', password: process.env.ADMIN_PASSWORD ?? '' });
  }
  const model = config.gemini ? new GeminiClient(config.gemini.apiKey, config.gemini.model) : null;
  if (!model) console.warn('GEMINI_API_KEY is not set: suggestions use the rule-based fallback.');
  return { services: createServices(repos, { model, modelTimeoutMs: config.modelTimeoutMs }), close };
}
