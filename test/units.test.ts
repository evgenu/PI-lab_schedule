import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig, loadDotEnv } from '../src/config.js';
import { addDays, daysBetween, isSlotInPast, isValidDate, isValidHour, localNow } from '../src/domain/time.js';
import { toPublicUser } from '../src/domain/types.js';
import { parseCookies, serializeCookie } from '../src/http/cookies.js';
import { GoogleOAuth } from '../src/http/googleOAuth.js';
import { Router } from '../src/http/router.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { DEMO_LABS, seed } from '../src/seedData.js';
import { buildServices } from '../src/wiring.js';
import { NOW } from './helpers.js';

describe('time', () => {
  test('AC-11 dates and hours are validated strictly', () => {
    assert.equal(isValidDate('2026-11-20'), true);
    assert.equal(isValidDate('2028-02-29'), true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', 20261120, null]) assert.equal(isValidDate(bad), false, String(bad));
    assert.equal(isValidHour(8), true);
    assert.equal(isValidHour(19), true);
    for (const bad of [7, 20, 8.5, '9']) assert.equal(isValidHour(bad), false, String(bad));
  });

  test('AC-11 "now" is the wall clock in Sofia, across the date line and DST', () => {
    assert.deepEqual(localNow(NOW), { date: '2026-11-19', hour: 10 });
    assert.deepEqual(localNow(new Date('2026-11-19T22:30:00Z')), { date: '2026-11-20', hour: 0 }, 'already tomorrow in Sofia');
    assert.deepEqual(localNow(new Date('2026-07-01T09:00:00Z')), { date: '2026-07-01', hour: 12 }, 'summer time is UTC+3');
    assert.equal(isSlotInPast('2026-11-19', 10, NOW), true);
    assert.equal(isSlotInPast('2026-11-19', 11, NOW), false);
    assert.equal(isSlotInPast('2026-11-18', 19, NOW), true);
    assert.equal(daysBetween('2026-11-19', '2026-12-19'), 30);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});

describe('small HTTP pieces', () => {
  test('AC-28 the router captures params and tells 404 from 405', () => {
    const router = new Router<string>().add('GET', '/api/bookings/:id', 'one').add('POST', '/api/bookings/:id/cancel', 'cancel');
    assert.deepEqual(router.match('GET', '/api/bookings/42'), { kind: 'found', handler: 'one', params: { id: '42' } });
    assert.equal(router.match('DELETE', '/api/bookings/42').kind, 'method-not-allowed');
    assert.equal(router.match('GET', '/api/bookings/42/extra').kind, 'not-found');
    assert.equal(new Router<string>().add('GET', '/a.b', 'dot').match('GET', '/aXb').kind, 'not-found', 'dots are literal');
  });

  test('AC-5 cookies are parsed defensively and written HttpOnly + SameSite', () => {
    assert.deepEqual(parseCookies('sid=abc; theme=dark; broken; =x; bad=%E0%A4%A'), { sid: 'abc', theme: 'dark' });
    assert.deepEqual(parseCookies(undefined), {});
    assert.equal(
      serializeCookie('sid', 'a b', { maxAgeSeconds: 60, secure: false }),
      'sid=a%20b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax',
    );
    assert.match(serializeCookie('x', '1', { maxAgeSeconds: 1, secure: true, path: '/api' }), /Path=\/api; .*; Secure$/);
  });
});

describe('Google OAuth client', () => {
  const redirect = 'https://lab.example/api/auth/google/callback';

  test('AC-3 builds the consent URL and turns a code into a verified profile', async () => {
    const calls: string[] = [];
    const oauth = new GoogleOAuth('client-id', 'client-secret', redirect, async (url, init) => {
      calls.push(url);
      if (url.includes('/token')) {
        const body = String(init?.body);
        assert.match(body, /grant_type=authorization_code/);
        assert.match(body, /code=the-code/);
        return Response.json({ access_token: 'at' });
      }
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer at');
      return Response.json({ sub: '123', email: 'a@gmail.com', email_verified: true, name: 'A' });
    });
    const url = new URL(oauth.authUrl('st'));
    assert.equal(url.searchParams.get('state'), 'st');
    assert.equal(url.searchParams.get('redirect_uri'), redirect);
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.deepEqual(await oauth.profileFromCode('the-code'), {
      provider: 'google', subject: '123', email: 'a@gmail.com', emailVerified: true, name: 'A',
    });
    assert.equal(calls.length, 2);
  });

  test('AC-4 anything but email_verified === true counts as unverified; failures are 401', async () => {
    // Each call builds fresh Responses: a body can be read only once.
    const respond = (token: () => Response, info: () => Response) =>
      new GoogleOAuth('i', 's', redirect, async (url) => (url.includes('/token') ? token() : info()));
    const ok = () => Response.json({ access_token: 'a' });
    const notVerified = respond(ok, () => Response.json({ sub: '1', email: 'a@b.bg', email_verified: 'true' }));
    const profile = await notVerified.profileFromCode('c');
    assert.equal(profile.emailVerified, false, 'the string "true" is not the boolean true');
    assert.equal(profile.name, '');
    await assert.rejects(respond(() => new Response('', { status: 400 }), () => Response.json({})).profileFromCode('c'), { status: 401 });
    await assert.rejects(respond(ok, () => new Response('', { status: 401 })).profileFromCode('c'), { status: 401 });
    await assert.rejects(respond(ok, () => Response.json({ sub: '1' })).profileFromCode('c'), { status: 401 });
  });
});

describe('configuration and wiring', () => {
  test('AC-29 configuration comes from the environment only', () => {
    const empty = loadConfig({});
    assert.equal(empty.port, 3000);
    assert.equal(empty.baseUrl, 'http://localhost:3000');
    assert.equal(empty.databaseUrl, null);
    assert.equal(empty.google, null);
    assert.equal(empty.gemini, null);
    assert.equal(empty.modelTimeoutMs, 8000);
    assert.equal(empty.secureCookies, false);

    const full = loadConfig({
      PORT: '8080', BASE_URL: 'https://lab.onrender.com/', DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 's', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x', MODEL_TIMEOUT_MS: '2500',
    });
    assert.equal(full.baseUrl, 'https://lab.onrender.com');
    assert.equal(full.secureCookies, true);
    assert.deepEqual(full.google, { clientId: 'id', clientSecret: 's' });
    assert.deepEqual(full.gemini, { apiKey: 'k', model: 'gemini-x' });
    assert.equal(full.modelTimeoutMs, 2500);
    assert.equal(loadConfig({ GEMINI_API_KEY: 'k', MODEL_TIMEOUT_MS: '-1' }).gemini?.model, 'gemini-2.5-flash');
    assert.equal(loadConfig({ MODEL_TIMEOUT_MS: '-1' }).modelTimeoutMs, 8000);
    loadDotEnv('/definitely/not/here/.env'); // no file: nothing happens
  });

  test('AC-27 seeding is idempotent and promotes an existing admin e-mail', async () => {
    const repos = createMemoryRepos();
    assert.deepEqual(await seed(repos, { email: 'Boss@TU.bg', password: 'long password' }), [`${DEMO_LABS.length} labs`, 'admin Boss@TU.bg']);
    assert.deepEqual(await seed(repos), []);
    assert.equal((await repos.users.findByEmail('boss@tu.bg'))?.role, 'admin');
    const someone = await repos.users.create({ email: 'x@tu.bg', name: 'X', passwordHash: null });
    await seed(repos, { email: 'x@tu.bg', password: 'p' });
    assert.equal((await repos.users.findById(someone.id))?.role, 'admin');
    assert.deepEqual(toPublicUser(someone), { id: someone.id, email: 'x@tu.bg', name: 'X', role: 'student' });
  });

  test('AC-18 without DATABASE_URL and GEMINI_API_KEY the app still starts (memory store, fallback)', async () => {
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (m: string) => warnings.push(m);
    try {
      const { services, close } = await buildServices(loadConfig({}));
      assert.equal((await services.labs.listLabs()).length, DEMO_LABS.length);
      await close();
      const withKey = await buildServices(loadConfig({ GEMINI_API_KEY: 'k' }));
      assert.ok(withKey.services.suggestions);
    } finally {
      console.warn = warn;
    }
    assert.ok(warnings.some((w) => w.includes('in-memory')));
    assert.ok(warnings.some((w) => w.includes('fallback')));
  });
});
