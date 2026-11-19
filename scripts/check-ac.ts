// `npm run check:ac`: every [AC-n] in SPEC.md must appear in the title of at least one test.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const spec = await readFile('SPEC.md', 'utf8');
const criteria = [...new Set([...spec.matchAll(/^- \[(AC-\d+)\]/gm)].map((m) => m[1]!))];

const titles: string[] = [];
for (const name of await readdir('test')) {
  if (!name.endsWith('.test.ts')) continue;
  const source = await readFile(join('test', name), 'utf8');
  // test('AC-7 …') / test("AC-7 …") / test(`AC-7 …`)
  for (const m of source.matchAll(/\btest\(\s*(['"`])(.*?)\1/g)) titles.push(m[2]!);
}

const missing = criteria.filter((id) => !titles.some((t) => new RegExp(`\\b${id}\\b`).test(t)));
for (const id of criteria) {
  const count = titles.filter((t) => new RegExp(`\\b${id}\\b`).test(t)).length;
  console.log(`${count ? '✔' : '✘'} ${id}  ${count} test(s)`);
}
if (criteria.length === 0) {
  console.error('No acceptance criteria found in SPEC.md');
  process.exit(1);
}
if (missing.length) {
  console.error(`\nNo test for: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${criteria.length} acceptance criteria are traced to tests.`);
