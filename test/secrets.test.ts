import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', 'js']);

/** The obvious shapes of real secrets. A safety net, not a policy: secrets live in the host's settings. */
const PATTERNS: [string, RegExp][] = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth client secret', /GOCSPX-[0-9A-Za-z_-]{20,}/],
  ['private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z]{36}/],
  ['Postgres URL with password', /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@[a-z0-9.-]+\.[a-z]{2,}/i],
];

async function* files(dir: string): AsyncGenerator<string> {
  for (const name of await readdir(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) yield* files(path);
    else yield path;
  }
}

test('AC-29 no secret-shaped string is committed to the repository', async () => {
  const found: string[] = [];
  let scanned = 0;
  for await (const path of files(process.cwd())) {
    if (path.endsWith('secrets.test.ts')) continue; // this file holds the patterns themselves
    if (/(^|\/)\.env$/.test(path)) continue; // git-ignored local file, never committed
    const text = await readFile(path, 'utf8');
    scanned++;
    for (const [name, pattern] of PATTERNS) if (pattern.test(text)) found.push(`${name} in ${path}`);
  }
  assert.ok(scanned > 20, 'the scan actually looked at the repository');
  assert.deepEqual(found, []);
});

test('AC-29 .env files are ignored by git and .env.example holds no values for secrets', async () => {
  const ignore = await readFile('.gitignore', 'utf8');
  assert.match(ignore, /^\.env$/m);
  const example = await readFile('.env.example', 'utf8');
  for (const key of ['GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY', 'DATABASE_URL', 'ADMIN_PASSWORD', 'LAB_SESSION_TOKEN']) {
    assert.match(example, new RegExp(`^${key}=$`, 'm'), `${key} must be empty in .env.example`);
  }
});
