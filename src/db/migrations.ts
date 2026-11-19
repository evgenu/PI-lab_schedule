import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The smallest thing a migration needs: one connection that can run SQL. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MigrationFile {
  version: number;
  name: string;
}

const FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Numbered files in order; anything else in the folder is a mistake worth stopping for. */
export function parseMigrationFiles(fileNames: string[]): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const name of fileNames) {
    const match = FILE_PATTERN.exec(name);
    if (!match) throw new Error(`Unexpected file in migrations/: ${name}`);
    files.push({ version: Number(match[1]), name });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`Two migrations share number ${files[i]!.version}`);
    }
  }
  return files;
}

export function pendingMigrations(files: MigrationFile[], applied: Set<number>): MigrationFile[] {
  return files.filter((f) => !applied.has(f.version));
}

/**
 * Applies every migration that has not run yet, each in its own transaction,
 * and records it in schema_migrations so it never runs twice.
 */
export async function migrate(
  client: SqlClient,
  dir: string,
  readSql: (path: string) => Promise<string> = (p) => readFile(p, 'utf8'),
  listDir: (path: string) => Promise<string[]> = (p) => readdir(p),
): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => Number(r.version)));
  const todo = pendingMigrations(parseMigrationFiles(await listDir(dir)), applied);

  const done: string[] = [];
  for (const file of todo) {
    const sql = await readSql(join(dir, file.name));
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        file.version,
        file.name,
      ]);
      await client.query('COMMIT');
      done.push(file.name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file.name} failed: ${(error as Error).message}`);
    }
  }
  return done;
}
