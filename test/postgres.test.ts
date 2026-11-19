import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createPostgresRepos, type Queryable } from '../src/repos/postgres.js';

/** A fake connection: answers each query with the next scripted result and records SQL + params. */
class ScriptedDb implements Queryable {
  calls: { sql: string; params: unknown[] }[] = [];
  constructor(private readonly answers: (unknown[] | Error)[]) {}
  async query(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    const next = this.answers.shift() ?? [];
    if (next instanceof Error) throw next;
    return { rows: next as any[] };
  }
}

const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
const otherError = Object.assign(new Error('connection lost'), { code: '08006' });
const userRow = { id: 1, email: 'a@b.bg', name: 'A', role: 'student', password_hash: 'h', created_at: new Date(0) };
const bookingRow = { id: 5, lab_id: 2, user_id: 1, date: '2026-11-20', hour: 9, purpose: '', status: 'pending', decided_by: null, created_at: new Date(0) };

describe('Postgres repositories', () => {
  test('AC-1 users: rows map to the domain, unique e-mail becomes 409, other errors pass through', async () => {
    const db = new ScriptedDb([[userRow], [], [userRow], uniqueViolation, otherError, [], [userRow], [], []]);
    const { users } = createPostgresRepos(db);
    assert.deepEqual(await users.findById(1), { id: 1, email: 'a@b.bg', name: 'A', role: 'student', passwordHash: 'h', createdAt: new Date(0) });
    assert.equal(await users.findByEmail('x@y.bg'), null);
    assert.equal((await users.create({ email: 'a@b.bg', name: 'A', passwordHash: 'h' })).id, 1);
    await assert.rejects(users.create({ email: 'a@b.bg', name: 'A', passwordHash: null }), { status: 409 });
    await assert.rejects(users.create({ email: 'a@b.bg', name: 'A', passwordHash: null }), /connection lost/);
    await users.setRole(1, 'teacher');
    assert.equal((await users.findByIdentity('google', 's'))?.id, 1);
    assert.equal(await users.findByIdentity('google', 'x'), null);
    await users.linkIdentity(1, 'google', 's');

    assert.match(db.calls[1]!.sql, /lower\(email\) = lower\(\$1\)/);
    assert.deepEqual(db.calls[2]!.params, ['a@b.bg', 'A', 'h', 'student']);
    assert.match(db.calls.at(-1)!.sql, /ON CONFLICT \(provider, subject\) DO NOTHING/);
    for (const call of db.calls) assert.ok(!call.sql.includes('a@b.bg'), 'values are parameters, never SQL text');
  });

  test('AC-5 sessions store and look up by hash and expiry', async () => {
    const db = new ScriptedDb([[], [{ user_id: 7 }], [], []]);
    const { sessions } = createPostgresRepos(db);
    const now = new Date();
    await sessions.create('hash', 7, now);
    assert.equal(await sessions.findUserId('hash', now), 7);
    assert.equal(await sessions.findUserId('nope', now), null);
    await sessions.delete('hash');
    assert.match(db.calls[1]!.sql, /expires_at > \$2/);
  });

  test('AC-16 labs and the supervisors many-to-many', async () => {
    const lab = { id: 2, name: 'L', building: 'B', capacity: 3, description: '' };
    const db = new ScriptedDb([[lab], [lab], [], [lab], uniqueViolation, otherError, [], [{ '?column?': 1 }], [], [{ lab_id: 2 }, { lab_id: 4 }]]);
    const { labs } = createPostgresRepos(db);
    assert.deepEqual(await labs.list(), [lab]);
    assert.deepEqual(await labs.findById(2), lab);
    assert.equal(await labs.findById(3), null);
    assert.deepEqual(await labs.create(lab), lab);
    await assert.rejects(labs.create(lab), { status: 409 });
    await assert.rejects(labs.create(lab), /connection lost/);
    await labs.addSupervisor(2, 1);
    assert.equal(await labs.isSupervisor(2, 1), true);
    assert.equal(await labs.isSupervisor(2, 9), false);
    assert.deepEqual(await labs.supervisedLabIds(1), [2, 4]);
  });

  test('AC-9 bookings: a taken slot (unique index) becomes 409; status change is conditional', async () => {
    const db = new ScriptedDb([
      [bookingRow], uniqueViolation, otherError, [bookingRow], [], [bookingRow], [bookingRow], [bookingRow], [bookingRow], [{ n: 2 }], [{ ...bookingRow, status: 'approved', decided_by: 3 }], [],
    ]);
    const { bookings } = createPostgresRepos(db);
    const input = { labId: 2, userId: 1, date: '2026-11-20', hour: 9, purpose: '' };
    assert.equal((await bookings.create(input)).labId, 2);
    await assert.rejects(bookings.create(input), { status: 409 });
    await assert.rejects(bookings.create(input), /connection lost/);
    assert.equal((await bookings.findById(5))?.date, '2026-11-20');
    assert.equal(await bookings.findById(6), null);
    assert.equal((await bookings.listByUser(1)).length, 1);
    assert.equal((await bookings.listActiveOnDate('2026-11-20')).length, 1);
    assert.equal((await bookings.listPending('all')).length, 1);
    assert.equal((await bookings.listPending([2, 4])).length, 1);
    assert.equal(await bookings.countUpcomingActive(1, '2026-11-19', 10), 2);
    assert.equal((await bookings.setStatus(5, 'approved', 3, ['pending']))?.decidedBy, 3);
    assert.equal(await bookings.setStatus(5, 'approved', 3, ['pending']), null);

    const pendingIn = db.calls.find((c) => c.sql.includes('ANY($1::int[])'))!;
    assert.deepEqual(pendingIn.params, [[2, 4]]);
    const update = db.calls.at(-1)!;
    assert.match(update.sql, /WHERE id = \$1 AND status = ANY\(\$4::text\[\]\)/);
    assert.deepEqual(update.params, [5, 'approved', 3, ['pending']]);
  });
});
