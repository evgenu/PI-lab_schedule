import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { makeWorld, rejectsWith, TODAY, TOMORROW } from './helpers.js';

describe('calendar', () => {
  test('AC-7 every lab and every hour 08–19 has a state, and nobody is identified', async () => {
    const { services, users, labs } = await makeWorld();
    await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9, purpose: 'Курсов проект' });
    const approved = await services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 10 });
    await services.bookings.approve(users.teacher, approved.id);

    const day = await services.labs.availability(TOMORROW);
    assert.equal(day.labs.length, 2);
    assert.deepEqual(day.hours, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const network = day.labs.find((l) => l.lab.id === labs.network.id)!;
    assert.equal(network.slots.length, 12);
    assert.equal(network.slots.find((s) => s.hour === 9)!.state, 'pending');
    assert.equal(network.slots.find((s) => s.hour === 10)!.state, 'approved');
    assert.equal(network.slots.find((s) => s.hour === 11)!.state, 'free');
    const text = JSON.stringify(day);
    for (const secret of ['ana@', 'boris@', 'userId', 'Ана', 'Курсов проект']) {
      assert.ok(!text.includes(secret), `calendar must not reveal ${secret}`);
    }
  });

  test('AC-7 hours that have started today are past', async () => {
    const { services } = await makeWorld();
    const today = await services.labs.availability(TODAY); // it is 10:30
    const states = today.labs[0]!.slots.map((s) => [s.hour, s.state]);
    assert.deepEqual(states.slice(0, 4), [[8, 'past'], [9, 'past'], [10, 'past'], [11, 'free']]);
    await rejectsWith(services.labs.availability('2026-02-31'), 400);
    await rejectsWith(services.labs.availability(undefined), 400);
  });

  test('AC-7 freeSlots lists exactly the free slots of the calendar', async () => {
    const { services, users, labs } = await makeWorld();
    await services.bookings.create(users.student, { labId: labs.robots.id, date: TOMORROW, hour: 8 });
    const free = await services.labs.freeSlots(TOMORROW);
    assert.equal(free.length, 2 * 12 - 1);
    assert.ok(!free.some((f) => f.lab.id === labs.robots.id && f.hour === 8));
  });
});

describe('booking', () => {
  test('AC-8 booking a free slot creates a pending booking with the lab name', async () => {
    const { services, users, labs } = await makeWorld();
    const booking = await services.bookings.create(users.student, {
      labId: labs.network.id,
      date: TOMORROW,
      hour: 14,
      purpose: '  Упражнение по мрежи ',
    });
    assert.equal(booking.status, 'pending');
    assert.equal(booking.userId, users.student.id);
    assert.equal(booking.labName, 'Мрежи');
    assert.equal(booking.purpose, 'Упражнение по мрежи');
  });

  test('AC-9 a slot that is pending or approved is refused with 409', async () => {
    const { services, users, labs } = await makeWorld();
    const first = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await rejectsWith(services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 9 }), 409);
    await services.bookings.approve(users.teacher, first.id);
    await rejectsWith(services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 9 }), 409);
    // The same hour in another lab is fine.
    await services.bookings.create(users.other, { labId: labs.robots.id, date: TOMORROW, hour: 9 });
  });

  test('AC-10 a fourth upcoming active booking is refused with 409', async () => {
    const { services, users, labs } = await makeWorld();
    for (const hour of [8, 9, 10]) {
      await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour });
    }
    const error = await rejectsWith(
      services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 11 }),
      409,
    );
    assert.match(error.message, /3 предстоящи/);
    // Another student is not affected.
    await services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 11 });
  });

  test('AC-10 a cancelled booking no longer counts towards the limit', async () => {
    const { services, users, labs } = await makeWorld();
    const made = [];
    for (const hour of [8, 9, 10]) {
      made.push(await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour }));
    }
    await services.bookings.cancel(users.student, made[0]!.id);
    await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 11 });
  });

  test('AC-11 past slots, hours outside 08–19 and days over 30 ahead are refused with 400', async () => {
    const { services, users, labs } = await makeWorld();
    const book = (input: Record<string, unknown>) =>
      services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9, ...input });
    await rejectsWith(book({ date: TODAY, hour: 10 }), 400); // started at 10:00, it is 10:30
    await rejectsWith(book({ date: '2026-11-18' }), 400);
    await rejectsWith(book({ hour: 7 }), 400);
    await rejectsWith(book({ hour: 20 }), 400);
    await rejectsWith(book({ hour: 9.5 }), 400);
    await rejectsWith(book({ date: '2026-12-20' }), 400); // 31 days ahead
    await rejectsWith(book({ date: '20-11-2026' }), 400);
    await rejectsWith(book({ labId: 'one' }), 400);
    await rejectsWith(book({ purpose: 'x'.repeat(201) }), 400);
    await rejectsWith(book({ labId: 999 }), 404);
    // Boundaries that are allowed: later today, and exactly 30 days ahead.
    await book({ date: TODAY, hour: 11 });
    await book({ date: '2026-12-19', hour: 19 });
  });
});

describe('cancelling and deciding', () => {
  test('AC-12 only the owner may cancel; anyone else, even an admin, gets 403', async () => {
    const { services, users, labs } = await makeWorld();
    const booking = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await rejectsWith(services.bookings.cancel(users.other, booking.id), 403);
    await rejectsWith(services.bookings.cancel(users.teacher, booking.id), 403);
    await rejectsWith(services.bookings.cancel(users.admin, booking.id), 403);
    const cancelled = await services.bookings.cancel(users.student, booking.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.labName, 'Мрежи');
  });

  test('AC-12 cancelling twice, a missing booking or a started booking is refused', async () => {
    let now = new Date('2026-11-19T08:30:00Z');
    const { services, users, labs } = await makeWorld({ now: () => now });
    const booking = await services.bookings.create(users.student, { labId: labs.network.id, date: TODAY, hour: 12 });
    const later = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await services.bookings.cancel(users.student, later.id);
    await rejectsWith(services.bookings.cancel(users.student, later.id), 409);
    await rejectsWith(services.bookings.cancel(users.student, 12345), 404);
    await rejectsWith(services.bookings.cancel(users.student, 'abc'), 404);
    now = new Date('2026-11-19T10:15:00Z'); // 12:15 in Sofia: the 12:00 slot has started
    await rejectsWith(services.bookings.cancel(users.student, booking.id), 409);
  });

  test('AC-13 only a supervisor of that lab, or an admin, may approve or reject', async () => {
    const { services, users, labs } = await makeWorld();
    const a = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    const b = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 10 });
    await rejectsWith(services.bookings.approve(users.student, a.id), 403);
    await rejectsWith(services.bookings.approve(users.otherTeacher, a.id), 403);
    await rejectsWith(services.bookings.reject(users.otherTeacher, a.id), 403);
    assert.equal((await services.bookings.approve(users.teacher, a.id)).status, 'approved');
    const rejected = await services.bookings.reject(users.admin, b.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.decidedBy, users.admin.id);
  });

  test('AC-13 the approval queue shows each teacher only their labs, and students none', async () => {
    const { services, users, labs } = await makeWorld();
    await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await services.bookings.create(users.student, { labId: labs.robots.id, date: TOMORROW, hour: 9 });
    await services.bookings.create(users.other, { labId: labs.network.id, date: TODAY, hour: 11 });
    assert.deepEqual((await services.bookings.listPending(users.teacher)).map((b) => b.labName), ['Мрежи', 'Мрежи']);
    assert.deepEqual((await services.bookings.listPending(users.otherTeacher)).map((b) => b.labName), ['Роботика']);
    assert.equal((await services.bookings.listPending(users.admin)).length, 3);
    await rejectsWith(services.bookings.listPending(users.student), 403);
  });

  test('AC-13 the approval queue hides pending requests whose hour has passed', async () => {
    let now = new Date('2026-11-19T08:30:00Z');
    const { services, users, labs } = await makeWorld({ now: () => now });
    await services.bookings.create(users.student, { labId: labs.network.id, date: TODAY, hour: 11 });
    assert.equal((await services.bookings.listPending(users.teacher)).length, 1);
    now = new Date('2026-11-19T09:30:00Z'); // 11:30 in Sofia
    assert.equal((await services.bookings.listPending(users.teacher)).length, 0);
  });

  test('AC-14 only a pending booking can be decided; deciding again is refused with 409', async () => {
    const { services, users, labs } = await makeWorld();
    const booking = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await services.bookings.approve(users.teacher, booking.id);
    await rejectsWith(services.bookings.approve(users.teacher, booking.id), 409);
    await rejectsWith(services.bookings.reject(users.teacher, booking.id), 409);
    const cancelled = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 10 });
    await services.bookings.cancel(users.student, cancelled.id);
    await rejectsWith(services.bookings.approve(users.teacher, cancelled.id), 409);
  });

  test('AC-14 two decisions racing on the same booking: the second loses with 409', async () => {
    const { services, repos, users, labs } = await makeWorld();
    const booking = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    // Simulate the other teacher's decision landing between our read and our write.
    const original = repos.bookings.setStatus.bind(repos.bookings);
    repos.bookings.setStatus = async (...args) => {
      await original(booking.id, 'rejected', users.admin.id, ['pending']);
      return original(...args);
    };
    await rejectsWith(services.bookings.approve(users.teacher, booking.id), 409);
  });

  test('AC-14 a cancel racing with a decision: the loser gets 409', async () => {
    const { services, repos, users, labs } = await makeWorld();
    const booking = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    repos.bookings.setStatus = async () => null;
    await rejectsWith(services.bookings.cancel(users.student, booking.id), 409);
  });

  test('AC-15 a rejected or cancelled booking frees its slot', async () => {
    const { services, users, labs } = await makeWorld();
    const rejected = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 9 });
    await services.bookings.reject(users.teacher, rejected.id);
    const cancelled = await services.bookings.create(users.student, { labId: labs.network.id, date: TOMORROW, hour: 10 });
    await services.bookings.cancel(users.student, cancelled.id);

    const day = await services.labs.availability(TOMORROW);
    const slots = day.labs.find((l) => l.lab.id === labs.network.id)!.slots;
    assert.equal(slots.find((s) => s.hour === 9)!.state, 'free');
    assert.equal(slots.find((s) => s.hour === 10)!.state, 'free');
    await services.bookings.create(users.other, { labId: labs.network.id, date: TOMORROW, hour: 9 });

    const mine = await services.bookings.listMine(users.student);
    assert.deepEqual(mine.map((b) => b.status), ['rejected', 'cancelled']);
  });
});

describe('labs administration', () => {
  test('AC-16 only an admin may create labs; input is validated', async () => {
    const { services, users } = await makeWorld();
    const input = { name: 'Нова', building: 'Блок 3', capacity: 10, description: 'Тиха' };
    await rejectsWith(services.labs.createLab(users.teacher, input), 403);
    await rejectsWith(services.labs.createLab(users.student, input), 403);
    const admin = users.admin;
    const lab = await services.labs.createLab(admin, input);
    assert.equal(lab.name, 'Нова');
    await rejectsWith(services.labs.createLab(admin, input), 409); // duplicate name
    await rejectsWith(services.labs.createLab(admin, { ...input, name: '' }), 400);
    await rejectsWith(services.labs.createLab(admin, { ...input, building: undefined }), 400);
    await rejectsWith(services.labs.createLab(admin, { ...input, capacity: 0 }), 400);
    await rejectsWith(services.labs.createLab(admin, { ...input, capacity: 'many' }), 400);
    await rejectsWith(services.labs.createLab(admin, { ...input, name: 'Друга', description: 'x'.repeat(301) }), 400);
    const noDescription = await services.labs.createLab(admin, { ...input, name: 'Трета', description: undefined });
    assert.equal(noDescription.description, '');
    assert.equal((await services.labs.listLabs()).length, 4);
  });

  test('AC-16 assigning a supervisor makes a student a teacher who can then approve', async () => {
    const { services, repos, users, labs } = await makeWorld();
    await rejectsWith(services.labs.assignSupervisor(users.teacher, labs.robots.id, users.other.email), 403);
    await rejectsWith(services.labs.assignSupervisor(users.admin, 999, users.other.email), 404);
    await rejectsWith(services.labs.assignSupervisor(users.admin, labs.robots.id, 'nobody@x.bg'), 404);
    await rejectsWith(services.labs.assignSupervisor(users.admin, labs.robots.id, 7), 404);

    await services.labs.assignSupervisor(users.admin, labs.robots.id, ` ${users.other.email} `);
    const promoted = (await repos.users.findById(users.other.id))!;
    assert.equal(promoted.role, 'teacher');
    assert.deepEqual(await repos.labs.supervisedLabIds(promoted.id), [labs.robots.id]);

    // An admin stays an admin when assigned.
    await services.labs.assignSupervisor(users.admin, labs.robots.id, users.admin.email);
    assert.equal((await repos.users.findById(users.admin.id))!.role, 'admin');

    const booking = await services.bookings.create(users.student, { labId: labs.robots.id, date: TOMORROW, hour: 9 });
    assert.equal((await services.bookings.approve(promoted, booking.id)).status, 'approved');
  });
});
