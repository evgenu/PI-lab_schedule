import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { migrate, parseMigrationFiles, pendingMigrations, type SqlClient } from '../src/db/migrations.js';

/** Records every statement; remembers which versions were "applied". */
class RecordingClient implements SqlClient {
  statements: string[] = [];
  applied = new Set<number>();
  failOn: string | null = null;
  async query(sql: string, params?: unknown[]) {
    this.statements.push(sql.trim().split('\n')[0]!);
    if (this.failOn && sql.includes(this.failOn)) throw new Error('syntax error');
    if (sql.startsWith('SELECT version')) return { rows: [...this.applied].map((version) => ({ version })) };
    if (sql.startsWith('INSERT INTO schema_migrations')) this.applied.add(params![0] as number);
    return { rows: [] };
  }
}

const files = ['002_b.sql', '001_a.sql', '010_c.sql'];
const read = async (path: string) => `-- ${path}\nCREATE TABLE x ();`;
const list = async () => files;

describe('migrations', () => {
  test('AC-27 the repository folder holds only numbered migrations, in order', async () => {
    const names = await readdir(join(process.cwd(), 'migrations'));
    const parsed = parseMigrationFiles(names);
    assert.deepEqual(parsed.map((f) => f.version), [1, 2, 3, 4]);
  });

  test('AC-27 migrations apply in numeric order, each in a transaction, and only once', async () => {
    const client = new RecordingClient();
    assert.deepEqual(await migrate(client, '/m', read, list), ['001_a.sql', '002_b.sql', '010_c.sql']);
    const order = client.statements.filter((s) => s.startsWith('-- '));
    assert.deepEqual(order, ['-- /m/001_a.sql', '-- /m/002_b.sql', '-- /m/010_c.sql']);
    assert.equal(client.statements.filter((s) => s === 'BEGIN').length, 3);
    assert.equal(client.statements.filter((s) => s === 'COMMIT').length, 3);

    client.statements = [];
    assert.deepEqual(await migrate(client, '/m', read, list), [], 'second run does nothing');
    assert.ok(!client.statements.includes('BEGIN'));
  });

  test('AC-27 a failing migration is rolled back and stops the run', async () => {
    const client = new RecordingClient();
    client.failOn = '002_b';
    await assert.rejects(migrate(client, '/m', read, list), /Migration 002_b.sql failed: syntax error/);
    assert.ok(client.statements.includes('ROLLBACK'));
    assert.deepEqual([...client.applied], [1], 'only the first one is recorded');
  });

  test('AC-27 stray files and duplicate numbers are refused', () => {
    assert.throws(() => parseMigrationFiles(['001_a.sql', 'notes.txt']), /Unexpected file/);
    assert.throws(() => parseMigrationFiles(['001_a.sql', '001_b.sql']), /share number 1/);
    assert.deepEqual(pendingMigrations(parseMigrationFiles(files), new Set([1, 10])).map((f) => f.name), ['002_b.sql']);
  });

  test('AC-27 the default file readers read the real folder', async () => {
    const client = new RecordingClient();
    const applied = await migrate(client, join(process.cwd(), 'migrations'));
    assert.equal(applied.length, 4);
    assert.ok(client.statements.some((s) => s.startsWith('-- People who can sign in')));
  });
});
