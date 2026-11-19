import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashToken } from '../src/services/auth.js';
import { hashPassword, verifyPassword } from '../src/services/password.js';
import { makeWorld, NOW, rejectsWith } from './helpers.js';

describe('local sign-in', () => {
  test('AC-1 registering creates a student and stores only a scrypt hash of the password', async () => {
    const { services, repos } = await makeWorld();
    const { user, token } = await services.auth.register({ email: ' New@TU-Sofia.bg ', password: 'secret-pass', name: ' Нова ' });

    assert.equal(user.role, 'student');
    assert.equal(user.email, 'new@tu-sofia.bg', 'e-mail is trimmed and lower-cased');
    assert.equal(user.name, 'Нова');
    const stored = await repos.users.findById(user.id);
    assert.match(stored!.passwordHash!, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.ok(!stored!.passwordHash!.includes('secret-pass'));
    assert.equal(await verifyPassword('secret-pass', stored!.passwordHash!), true);
    assert.equal((await services.auth.userForToken(token))?.id, user.id);
  });

  test('AC-1 the same password hashes differently each time (random salt)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('wrong', a), false);
    assert.equal(await verifyPassword('same password', 'not-a-hash'), false);
    assert.equal(await verifyPassword('same password', 'scrypt$only-salt'), false);
  });

  test('AC-1 registration validates name, e-mail and password length', async () => {
    const { services } = await makeWorld();
    await rejectsWith(services.auth.register({ email: 'x@y.bg', password: 'short', name: 'X' }), 400);
    await rejectsWith(services.auth.register({ email: 'not-an-email', password: 'long enough', name: 'X' }), 400);
    await rejectsWith(services.auth.register({ email: 'x@y.bg', password: 'long enough', name: '  ' }), 400);
    await rejectsWith(services.auth.register({ email: 42, password: 'long enough', name: 'X' }), 400);
    await rejectsWith(services.auth.register({ email: 'x@y.bg', password: 12345678, name: 'X' }), 400);
  });

  test('AC-2 a wrong password and an unknown e-mail get the same 401 message', async () => {
    const { services } = await makeWorld();
    const wrong = await rejectsWith(services.auth.login({ email: 'ana@tu-sofia.bg', password: 'nope' }), 401);
    const unknown = await rejectsWith(services.auth.login({ email: 'nobody@tu-sofia.bg', password: 'nope' }), 401);
    const missing = await rejectsWith(services.auth.login({}), 401);
    assert.equal(wrong.message, unknown.message);
    assert.equal(wrong.message, missing.message);
  });

  test('AC-2 the right password signs in, whatever the e-mail letter case', async () => {
    const { services, users } = await makeWorld();
    const { user } = await services.auth.login({ email: 'ANA@tu-sofia.bg', password: 'correct horse' });
    assert.equal(user.id, users.student.id);
  });

  test('AC-6 registering an existing e-mail is refused with 409', async () => {
    const { services } = await makeWorld();
    await rejectsWith(services.auth.register({ email: 'ana@tu-sofia.bg', password: 'long enough', name: 'Ана 2' }), 409);
  });
});

describe('Google sign-in and account linking', () => {
  const google = (overrides: Partial<{ subject: string; email: string; emailVerified: boolean; name: string }> = {}) => ({
    provider: 'google',
    subject: 'google-sub-1',
    email: 'ana@tu-sofia.bg',
    emailVerified: true,
    name: 'Ana G',
    ...overrides,
  });

  test('AC-3 a verified Google e-mail signs into the existing password account and links it', async () => {
    const { services, repos, users } = await makeWorld();
    // Monday: a booking made after signing in with a password.
    const booking = await services.bookings.create(users.student, { labId: 1, date: '2026-11-20', hour: 9 });

    // Tuesday: Google, with the same verified address.
    const { user } = await services.auth.loginWithProvider(google({ email: 'Ana@TU-Sofia.bg' }));
    assert.equal(user.id, users.student.id, 'same account');
    assert.deepEqual((await services.bookings.listMine(user)).map((b) => b.id), [booking.id], 'same bookings');
    assert.equal((await repos.users.findByIdentity('google', 'google-sub-1'))?.id, users.student.id, 'identity linked');

    // The password still works afterwards.
    assert.equal((await services.auth.login({ email: 'ana@tu-sofia.bg', password: 'correct horse' })).user.id, users.student.id);
  });

  test('AC-3 a linked Google account signs in by its subject even if its e-mail changed', async () => {
    const { services, users } = await makeWorld();
    await services.auth.loginWithProvider(google());
    const { user } = await services.auth.loginWithProvider(google({ email: 'renamed@gmail.com', emailVerified: false }));
    assert.equal(user.id, users.student.id);
  });

  test('AC-3 a verified Google e-mail with no account creates one account without a password', async () => {
    const { services, repos } = await makeWorld();
    const { user, token } = await services.auth.loginWithProvider(
      google({ subject: 'new-sub', email: 'new@gmail.com', name: '  ' }),
    );
    assert.equal(user.passwordHash, null);
    assert.equal(user.name, 'new@gmail.com', 'falls back to the e-mail when Google sends no name');
    assert.equal((await repos.users.findByIdentity('google', 'new-sub'))?.id, user.id);
    assert.equal((await services.auth.userForToken(token))?.id, user.id);
    // A provider-only account cannot be signed into with a password.
    await rejectsWith(services.auth.login({ email: 'new@gmail.com', password: 'anything at all' }), 401);
  });

  test('AC-4 an unverified Google e-mail is refused and neither links nor creates an account', async () => {
    const { services, repos } = await makeWorld();
    await rejectsWith(services.auth.loginWithProvider(google({ emailVerified: false })), 401);
    assert.equal(await repos.users.findByIdentity('google', 'google-sub-1'), null);

    await rejectsWith(services.auth.loginWithProvider(google({ subject: 's2', email: 'fresh@gmail.com', emailVerified: false })), 401);
    assert.equal(await repos.users.findByEmail('fresh@gmail.com'), null);
  });
});

describe('sessions', () => {
  test('AC-5 a session token resolves to its user until it expires or is logged out', async () => {
    let now = NOW;
    const { services, repos, users } = await makeWorld({ now: () => now });
    const { token } = await services.auth.login({ email: 'ana@tu-sofia.bg', password: 'correct horse' });
    assert.equal((await services.auth.userForToken(token))?.id, users.student.id);
    assert.equal(await services.auth.userForToken(undefined), null);
    assert.equal(await services.auth.userForToken('made-up'), null);

    // Only the hash is stored.
    assert.equal(await repos.sessions.findUserId(token, now), null);
    assert.equal(await repos.sessions.findUserId(hashToken(token), now), users.student.id);

    now = new Date(NOW.getTime() + 15 * 86_400_000);
    assert.equal(await services.auth.userForToken(token), null, 'expired after 14 days');

    now = NOW;
    await services.auth.logout(token);
    assert.equal(await services.auth.userForToken(token), null, 'logged out');
    await services.auth.logout(undefined); // no-op
  });

  test('AC-5 issueToken creates an extra ordinary session for the same user (used by MCP)', async () => {
    const { services, users } = await makeWorld();
    const token = await services.auth.issueToken(users.teacher);
    assert.equal((await services.auth.userForToken(token))?.id, users.teacher.id);
  });
});
